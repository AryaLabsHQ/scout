# Layer

## Table of Contents

- [Constructors](#constructors)
- [Long-Lived Work](#long-lived-work)
- [Composition](#composition)
- [Runtime Wiring](#runtime-wiring)
- [Provide to Effect](#provide-to-effect)
- [Memoization Across Provides](#memoization-across-provides)
- [Fresh Layers](#fresh-layers)

`Layer` builds and composes service environments.

## Constructors

Choose the constructor that matches the thing produced:

- `Layer.succeed(Service, impl)` — an already-built value (static config, simple mocks).
- `Layer.sync(Service, () => impl)` — lazy synchronous construction (e.g. mutable test state).
- `Layer.effect(Service, Effect.gen(...))` — the default for real implementations: effectful
  acquisition, dependencies, and resource cleanup via `Effect.acquireRelease`.
- `Layer.effectContext(...)` — one acquisition that intentionally supplies multiple services, such
  as first-class test stubs or one client backing several tags.
- `Layer.unwrap(...)` — when config or runtime discovery chooses or builds the layer.
- `Layer.fresh(...)` / `Effect.provide(layer, { local: true })` — isolated acquisition only (see
  [Fresh Layers](#fresh-layers)).
- `Context.Reference` — rarely, only for ambient/defaultable references where a safe default is
  real.

```ts
import { Effect, Layer, Context, Clock } from "effect";

class Database extends Context.Service<
  Database,
  {
    readonly query: (sql: string) => Effect.Effect<Array<{ id: number }>>;
  }
>()("Database") {}

// Sync — succeeds immediately
const DatabaseLive = Layer.succeed(Database, {
  query: (sql: string) => Effect.succeed([{ id: 1 }]),
});

// Effect — for effectful construction
const DatabaseLiveEffect = Layer.effect(
  Database,
  Effect.gen(function* () {
    const clock = yield* Clock;
    return { query: (sql: string) => Effect.succeed([]) };
  }),
);

// Scoped — for resource management (using Layer.effect with Scope)
const DatabaseScoped = Layer.effect(
  Database,
  Effect.acquireRelease(Effect.succeed({ query: (sql: string) => Effect.succeed([]) }), () =>
    Effect.logDebug("Database closed"),
  ),
);
```

`Layer.effectContext` builds a `Context` directly, so one acquisition can supply several tags —
useful for a shared test stub or a single client backing multiple services:

```ts
import { Context, Effect, Layer } from "effect";

// One acquisition supplying multiple services from shared in-memory state.
const TestLive = Layer.effectContext(
  Effect.gen(function* () {
    const state = yield* makeInMemoryState;
    return Context.empty().pipe(
      Context.add(Users, Users.of({ findById: state.findUser })),
      Context.add(Orders, Orders.of({ place: state.placeOrder })),
    );
  }),
);
```

`Layer.unwrap` defers the choice of layer until an effect (config or runtime discovery) has run:

```ts
const DatabaseLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* Config;
    return config.driver === "postgres" ? PostgresLive : SqliteLive;
  }),
);
```

**Source:** `effect/Layer.ts` - see `~/Developer/effect/packages/effect/src/Layer.ts`

## Long-Lived Work

A layer that starts a stream, listener, worker, subscription, or forever loop must fork that work
into the layer scope. Layer acquisition itself must complete — never run forever-work inline during
construction.

```ts
import { Effect, Layer, Stream } from "effect";

// Fork the background loop into the layer scope; acquisition returns immediately.
const EventProcessorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* Events;
    yield* events.stream.pipe(Stream.runForEach(handleEvent), Effect.forkScoped);
  }),
);
```

Guidance:

- Use `Effect.forkScoped`, `FiberSet`, or `FiberMap` for scoped background work so it is torn down
  with the layer.
- Do not run forever-work inline during layer acquisition — acquisition must complete.
- Do not expose a public `start` method unless the domain explicitly needs manual lifecycle control.

## Composition

```ts
const Live = Layer.mergeAll(DatabaseLive, ConfigLive);
```

**Source:** `effect/Layer.ts` - see `~/Developer/effect/packages/effect/src/Layer.ts`

## Runtime Wiring

The three combinators differ by what stays visible to downstream consumers:

- `Layer.provide(dependency)` — satisfies a dependency and _hides_ it. The dependency is an
  implementation detail of the layer it feeds.
- `Layer.provideMerge(dependency)` — satisfies a dependency and keeps it _exposed_ for downstream
  consumers. Use only when the outer graph genuinely needs that service too.
- `Layer.mergeAll(...)` — combines independent, exposed layers.

Prefer a flat, topologically sorted runtime value with named subgraphs over deep nesting:

```ts
const InfraLive = Layer.mergeAll(ConfigLive, LoggerLive, DatabaseLive);
const DomainLive = Layer.mergeAll(UsersLive, OrdersLive);

const AppLive = DomainLive.pipe(Layer.provide(InfraLive));
```

Guidance:

- Do not reach for `provideMerge` or `mergeAll` as blind make-it-compile tools; each choice is a
  statement about what the graph exposes.
- Do not hide authority or lifecycle dependencies (auth, clients that own connections, background
  workers) behind broad invisible provisioning — keep them deliberate and visible.

## Provide to Effect

```ts
const program = Effect.gen(function* () {
  const db = yield* Database;
  // ...
}).pipe(Effect.provide(Live));
```

**Source:** `effect/Layer.ts` - see `~/Developer/effect/packages/effect/src/Layer.ts`

## Memoization Across Provides

Layers are automatically memoized across multiple `Effect.provide` calls. The `MemoMap` is shared by
the fiber — so the same layer built in one `provide` call is reused in subsequent ones:

```ts
// MyService is built ONCE even though provided twice
const main = program.pipe(Effect.provide(MyServiceLayer), Effect.provide(MyServiceLayer));
```

**Source:** `effect/internal/layer.ts` - see
`~/Developer/effect/packages/effect/src/internal/layer.ts` (MemoMap implementation)

## Fresh Layers

When you need a layer built fresh each time:

```ts
import { Effect, Layer } from "effect";

// Layer.fresh bypasses memoization
const main = program.pipe(
  Effect.provide(MyServiceLayer),
  Effect.provide(Layer.fresh(MyServiceLayer)),
);

// Or use { local: true } on provide to isolate an entire subtree
const main = program.pipe(
  Effect.provide(MyServiceLayer),
  Effect.provide(MyServiceLayer, { local: true }), // fresh copy
);
```

**Source:** `effect/Layer.ts` - see `~/Developer/effect/packages/effect/src/Layer.ts`
