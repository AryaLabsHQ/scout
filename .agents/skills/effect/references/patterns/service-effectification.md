---
name: service-effectification
description:
  Service shape, layer DAG, ManagedRuntime composition, and per-tenant state for Effect. Patterns
  drawn from Effect and opencode.
---

## Table of Contents

- [The shape](#the-shape)
- [`Context.Service` signatures](#contextservice-signatures)
- [The `defaultLayer` DAG](#the-defaultlayer-dag)
- [Single `ManagedRuntime` with shared `MemoMap`](#single-managedruntime-with-shared-memomap)
- [Per-tenant state with `ScopedCache`](#per-tenant-state-with-scopedcache)
- [Deduping concurrent computations with `Effect.cached`](#deduping-concurrent-computations-with-effectcached)
- [Background fibers with `Effect.forkScoped`](#background-fibers-with-effectforkscoped)
- [The facade-removal recipe](#the-facade-removal-recipe)
- [Common pitfalls](#common-pitfalls)
- [When to use which scope](#when-to-use-which-scope)
- [Reference checklist](#reference-checklist)
- [Related guides](#related-guides)

# Service Effectification (Effect)

Patterns for converting an existing service module into an Effect `Context.Service`, composing it
into a single `ManagedRuntime`, and migrating away from per-service runtime "facades" once your
layer graph is acyclic.

**Sources:**

- `~/Developer/effect/migration/layer-memoization.md` — auto-memoization across `Effect.provide`
- `~/Developer/effect/packages/effect/src/Context.ts` — `Context.Service`
- `~/Developer/effect/packages/effect/src/Layer.ts` — `effect`, `mergeAll`, `provide`, `fresh`,
  `mock`, `makeMemoMapUnsafe`
- `~/Developer/effect/packages/effect/src/Effect.ts` — `fn`, `cached`, `forkScoped`, `addFinalizer`
- `~/Developer/effect/packages/effect/src/ScopedCache.ts` — `makeWith`
- `~/Developer/effect/packages/effect/src/ManagedRuntime.ts` — `make`

## The shape

Every service is one module: a flat `Interface`, a `Service` class, a `layer`, a `defaultLayer`, and
a self-reexport.

```ts
import { Context, Effect, Layer } from "effect";
import { OtherDep } from "../other-dep";

export interface Interface {
  readonly get: (id: FooID) => Effect.Effect<FooInfo, FooError>;
  readonly stream: (id: FooID) => Stream.Stream<FooEvent>;
}

export class Service extends Context.Service<Service, Interface>()("@scope/Foo") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const dep = yield* OtherDep.Service; // yield deps once, in the layer

    const get = Effect.fn("Foo.get")(function* (id: FooID) {
      return yield* dep.lookup(id); // close over deps in methods
    });

    return Service.of({ get, stream });
  }),
);

export const defaultLayer = layer.pipe(Layer.provide(OtherDep.defaultLayer));

export * as Foo from "./foo";
```

Rules:

1. **One namespace, flat exports.** Don't wrap in `export namespace Foo { ... }` — use the
   `export * as Foo from "./foo"` self-reexport at the bottom.
2. **`Effect.fn("Foo.method")`** for every method. Names appear in fiber dumps and tracing spans.
3. **Yield dependencies once** in the `Layer.effect` body, never inside individual methods.
4. **Always wrap the return value in `Service.of({ ... })`** — the type-erasure trick that pins the
   interface.
5. **Export both `layer` and `defaultLayer`.** `layer` is the bare service; `defaultLayer` chains in
   every direct dependency via `Layer.provide(Dep.defaultLayer)`.

## `Context.Service` signatures

From `Context.ts` (`Context.Service`). Two forms:

```ts
// Function syntax — when you don't need a class
const Database = Context.Service<Database>("Database");

// Class syntax — most common; lets you attach statics
class Database extends Context.Service<
  Database,
  {
    readonly query: (sql: string) => Effect.Effect<Row[]>;
  }
>()("Database") {}
```

Pass type parameters via `Context.Service<Self, Shape>()` and the identifier via the trailing call.

For services with effectful construction, use the `make` option:

```ts
class Database extends Context.Service<Database, Shape>()("Database", {
  make: Effect.gen(function* () {
    // `Config` here is this app's Config service, not the root effect/Config module.
    const config = yield* Config.Service;
    const conn = yield* Effect.acquireRelease(connect(config), close);
    return { query: (sql) => conn.query(sql) };
  }),
}) {}
```

`make` is automatically lifted into a default layer accessible as `Database.layer`.

## The `defaultLayer` DAG

Every service exports two layer bindings:

```ts
export const layer = Layer.effect(Service, ...)         // bare, no transitive deps
export const defaultLayer = layer.pipe(                 // declares every direct dep
  Layer.provide(Dep1.defaultLayer),
  Layer.provide(Dep2.defaultLayer),
  Layer.provide(Dep3.defaultLayer),
)
```

Why both:

- **`layer`** lets test code compose its own dep set (e.g. swap `Storage.defaultLayer` for an
  in-memory mock).
- **`defaultLayer`** lets production code compose with one line: `Layer.provide(Foo.defaultLayer)`.

Compose at the app root:

```ts
const AppLayer = Layer.mergeAll(
  Bus.defaultLayer,
  Config.defaultLayer,
  Storage.defaultLayer,
  Session.defaultLayer,
  // ...one entry per top-level service
);
```

`Layer.mergeAll` deduplicates: every service's transitive dependencies that appear in multiple
`defaultLayer` chains are built once thanks to the shared `MemoMap`.

## Single `ManagedRuntime` with shared `MemoMap`

The whole app shares one `ManagedRuntime`:

```ts
import { Layer, ManagedRuntime } from "effect";

const memoMap = Layer.makeMemoMapUnsafe();
const rt = ManagedRuntime.make(AppLayer, { memoMap });

export const AppRuntime = {
  runPromise: rt.runPromise,
  runFork: rt.runFork,
  runSync: rt.runSync,
};
```

`Layer.makeMemoMapUnsafe()` is the explicit handle to Effect's layer-build cache. If you build a
second `ManagedRuntime` (e.g. a lighter "bootstrap" runtime for startup), pass the same `memoMap` so
layers built by either runtime are reused by the other.

See "The facade-removal recipe" below to consolidate runtimes.

## Per-tenant state with `ScopedCache`

When a service needs **state per (directory | tenant | user | session)** that should be cleaned up
when the tenant goes away, use `ScopedCache.makeWith`:

```ts
import { Effect, Layer, ScopedCache } from "effect";

type State = { db: Db; subscribers: Set<Subscriber> };

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service;

    const cache = yield* ScopedCache.makeWith({
      lookup: (key: TenantKey) =>
        Effect.gen(function* () {
          const db = yield* Effect.acquireRelease(openDb(key), closeDb);
          const state: State = { db, subscribers: new Set() };

          // Background fiber tied to the cache entry's scope
          yield* bus.subscribeAll().pipe(
            Stream.runForEach((event) => Effect.sync(() => handle(state, event))),
            Effect.forkScoped,
          );

          return state;
        }),
      capacity: 64,
    });

    const get = Effect.fn("Foo.get")(function* (key: TenantKey, id: FooID) {
      const state = yield* ScopedCache.get(cache, key);
      return state.db.lookup(id);
    });

    return Service.of({ get });
  }),
);
```

The `lookup` callback runs inside a fresh `Scope`. `Effect.acquireRelease`, `Effect.addFinalizer`,
and `Effect.forkScoped` all hook into that scope and are torn down when the cache entry is
invalidated or the layer scope closes.

**Key insight: don't split init into a separate method with a `started` flag.** Put everything —
resource acquisition, finalizers, background fibers — in the lookup closure. `ScopedCache` handles
the run-once + concurrent-join semantics for free.

opencode wraps this primitive as `InstanceState` keyed by directory; you can either use
`ScopedCache.makeWith` directly or build a similar helper if your codebase has its own tenancy
concept.

## Deduping concurrent computations with `Effect.cached`

Whenever multiple callers might race on the same expensive operation, use `Effect.cached`
(`Effect.cached`):

```ts
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let cachedScan = yield* Effect.cached(scan().pipe(Effect.catchCause(() => Effect.void)));

    const ensure = Effect.fn("File.ensure")(function* () {
      yield* cachedScan;
    });

    const invalidate = Effect.fn("File.invalidate")(function* () {
      cachedScan = yield* Effect.cached(scan().pipe(Effect.catchCause(() => Effect.void)));
    });

    return Service.of({ ensure, invalidate });
  }),
);
```

`Effect.cached(eff)` returns an `Effect` that, when first awaited, runs `eff` and memoizes the
result. Concurrent callers join the in-flight fiber instead of starting a fresh one. To invalidate,
reassign `cachedScan = yield* Effect.cached(...)` — the old memo is dropped.

Use `ScopedCache` to avoid these hand-rolled patterns:

```ts
// ❌ Manual fiber dedup
let fiber: Fiber.Fiber<void> | undefined;
if (!fiber) fiber = yield * scan().pipe(Effect.forkIn(scope));
yield * Fiber.join(fiber);

// ❌ Promise dedup
let task: Promise<void> | undefined;
if (!task) task = scan().pipe(Effect.runPromise);
await task;

// ❌ Lazy variable with race
let cached: Result | undefined;
if (!cached) cached = yield * scan(); // races: two callers can both see undefined
```

For TTL-based caching, use `Effect.cachedWithTTL` or `Effect.cachedInvalidateWithTTL` (6890).

## Background fibers with `Effect.forkScoped`

Long-running subscriptions, watchers, and event loops belong inside a scoped block. Effect ties
their lifetime to the scope:

```ts
yield *
  bus.subscribeAll().pipe(
    Stream.runForEach((event) => Effect.sync(() => handle(event))),
    Effect.forkScoped,
  );
```

When the layer scope (or `ScopedCache` entry scope) closes, the fiber is interrupted. No manual
cleanup needed.

For native resources that need a custom teardown:

```ts
yield *
  Effect.acquireRelease(
    Effect.sync(() => nativeAddon.watch(dir)),
    (watcher) => Effect.sync(() => watcher.close()),
  );
```

## The facade-removal recipe

Many in-progress migrations export a per-service async facade backed by a private `ManagedRuntime`:

```ts
// Legacy pattern — service exposes async functions for non-Effect callers
const { runPromise } = makeRuntime(Service, layer);
export const get = (id: FooID) => runPromise((svc) => svc.get(id));
```

These exist because cyclic imports used to force each service to build its own runtime. Once the
layer DAG is acyclic and one `ManagedRuntime` composes `AppLayer`, the facades are dead weight —
each holds an independent layer build, fragments memoization, and forces every Effect caller to
bridge through `Effect.tryPromise`.

Recipe to remove a facade once everything composes cleanly:

1. **Find callers.** `rg -n "Namespace\.(method|method2)"` across `src/` and `test/`. Skip the
   service file itself.

2. **Migrate effectful production callers.** For each
   `Effect.tryPromise(() => Namespace.method(...))`:
   - Add the service to the caller's R type
   - `yield* Namespace.Service` once at the top of the caller's layer body
   - Replace `Effect.tryPromise(() => Namespace.method(...))` with `yield* ns.method(...)`
   - Add `Layer.provide(Namespace.defaultLayer)` to the caller's `defaultLayer` chain

3. **Fix raw `.layer` test callers.** A test composing `Caller.layer` (not `defaultLayer`) becomes
   under-specified the moment you add a new dependency. The TypeScript error looks like:

   > Type 'Storage.Service' is not assignable to type '... | Service | TestConsole'

   Fix: switch to `Caller.defaultLayer`, or add `Layer.provide(NewDep.defaultLayer)` to the custom
   composition.

4. **Migrate facade tests.** Tests calling `Namespace.method(...)` directly become:

   ```ts
   it.effect("does the thing", () =>
     Effect.gen(function* () {
       const svc = yield* Namespace.Service
       return yield* svc.method(...)
     }).pipe(Effect.provide(Namespace.defaultLayer)),
   )
   ```

   Don't wrap the body in `Effect.promise(async () => {...})`. Do the whole thing in `Effect.gen`.

5. **Delete the facade.** Once `rg` shows zero callers, remove the `export async function` block,
   the `makeRuntime(...)` line, and the now-unused import.

## Common pitfalls

### `Effect.tryPromise` on a service method drops the Promise layer

Old code wrapped the facade because it returned a Promise:

```ts
// Before
const result = yield * Effect.tryPromise(() => Storage.read(id));
```

After the service is effectified, the method already returns an Effect:

```ts
// After
const storage = yield * Storage.Service;
const result = yield * storage.read(id);
```

Don't reach for `Effect.promise` or `Effect.tryPromise` on a service method — if you do, you're
double-wrapping.

### Yielding services inside method bodies

```ts
// ❌ Wrong: yields on every call
const get = Effect.fn("Foo.get")(function* (id) {
  const dep = yield* OtherService;
  return yield* dep.lookup(id);
});

// ✅ Right: yield once in layer, close over
Layer.effect(
  Service,
  Effect.gen(function* () {
    const dep = yield* OtherService;
    const get = Effect.fn("Foo.get")(function* (id) {
      return yield* dep.lookup(id);
    });
    return Service.of({ get });
  }),
);
```

The wrong version still works, but defeats `Effect.fn` tracing (the dep yield shows up in every
span) and prevents the layer's R-type from being inferred correctly.

### Splitting init into a `started` flag

```ts
// ❌ Wrong
let started = false;
const ensure = Effect.fn("Foo.ensure")(function* () {
  if (started) return;
  yield* setup();
  started = true;
});

// ✅ Right — Effect.cached or ScopedCache do this for you
let cached = yield * Effect.cached(setup());
const ensure = Effect.fn("Foo.ensure")(function* () {
  yield* cached;
});
```

### Forgetting `Service.of(...)` in the layer return

`Service.of({ ... })` is the type-erasure cast that turns a plain object into a typed `Service`.
Without it, the layer return type collapses to `unknown`.

## When to use which scope

| Scenario                      | Pattern                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| Global singleton              | Plain `Layer.effect(Service, Effect.gen(function* () { ... return Service.of(...) }))` |
| Per-tenant state              | `ScopedCache.makeWith` keyed by tenant id                                              |
| Per-tenant state with cleanup | `ScopedCache.makeWith` + `Effect.acquireRelease` / `addFinalizer` inside the lookup    |
| Background fibers             | `Effect.forkScoped` inside the layer or cache entry init                               |
| Concurrent dedup              | `Effect.cached` (single-shot) or `Effect.cachedInvalidateWithTTL` (TTL)                |
| Just a value                  | `Layer.succeed(Service, impl)`                                                         |

## Reference checklist

When effectifying an existing async service:

- [ ] Define `Interface` with all methods returning `Effect` / `Stream`
- [ ] Declare `class Service extends Context.Service<Service, Interface>()("@scope/Name") {}`
- [ ] Build `layer = Layer.effect(Service, Effect.gen(...))` yielding deps once
- [ ] Wrap each method with `Effect.fn("Name.method")`
- [ ] Return `Service.of({ ... })` — not a plain object
- [ ] Export `defaultLayer = layer.pipe(Layer.provide(Dep.defaultLayer), ...)`
- [ ] If state is per-tenant, use `ScopedCache.makeWith` not a `Map<key, state>` plus init flags
- [ ] Compose at app root via `Layer.mergeAll(...)` provided to a single `ManagedRuntime`
- [ ] If migrating from a `makeRuntime(...)` facade, follow the 5-step removal recipe above

## Related guides

- [service.md](../dependency-injection/service.md) — `Context.Service` API in depth
- [layer.md](../dependency-injection/layer.md) — Layer composition and lifecycle
- [cache.md](../core/cache.md) — Cache and ScopedCache primitives
- [testing-migration.md](testing-migration.md) — `Layer.mock`, `Layer.fresh`, and the test-time
  memoization pitfall
