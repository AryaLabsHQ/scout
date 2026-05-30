# Layer

`Layer` builds and composes service environments.

## Constructors

```ts
import { Effect, Layer, Context, Clock } from "effect"

class Database extends Context.Service<Database, {
  readonly query: (sql: string) => Promise<Array<{ id: number }>>
}>()("Database") {}

// Sync — succeeds immediately
const DatabaseLive = Layer.succeed(Database, {
  query: async (sql: string) => [{ id: 1 }]
})

// Effect — for effectful construction
const DatabaseLiveEffect = Layer.effect(
  Database,
  Effect.gen(function*() {
    const clock = yield* Clock
    return { query: async (sql: string) => [] }
  })
)

// Scoped — for resource management (using Layer.effect with Scope)
const DatabaseScoped = Layer.effect(
  Database,
  Effect.acquireRelease(
    Effect.succeed({ query: async () => [] }),
    () => Effect.logDebug("Database closed")
  )
)
```

**Source:** `effect/Layer.ts` - see `~/Developer/effect/packages/effect/src/Layer.ts`

## Composition

```ts
const Live = Layer.mergeAll(DatabaseLive, ConfigLive)
```

**Source:** `effect/Layer.ts` - see `~/Developer/effect/packages/effect/src/Layer.ts`

## Provide to Effect

```ts
const program = Effect.gen(function*() {
  const db = yield* Database
  // ...
}).pipe(Effect.provide(Live))
```

**Source:** `effect/Layer.ts` - see `~/Developer/effect/packages/effect/src/Layer.ts`

## Memoization Across Provides (v4 Change)

In v4, layers are automatically memoized across multiple `Effect.provide` calls. The `MemoMap` is shared by the fiber — so the same layer built in one `provide` call is reused in subsequent ones:

```ts
// v4: MyService is built ONCE even though provided twice
const main = program.pipe(
  Effect.provide(MyServiceLayer),
  Effect.provide(MyServiceLayer)
)
```

**Source:** `effect/internal/layer.ts` - see `~/Developer/effect/packages/effect/src/internal/layer.ts` (MemoMap implementation)

## Fresh Layers

When you need a layer built fresh each time:

```ts
import { Effect, Layer } from "effect"

// Layer.fresh bypasses memoization
const main = program.pipe(
  Effect.provide(MyServiceLayer),
  Effect.provide(Layer.fresh(MyServiceLayer))
)

// Or use { local: true } on provide to isolate an entire subtree
const main = program.pipe(
  Effect.provide(MyServiceLayer),
  Effect.provide(MyServiceLayer, { local: true }) // fresh copy
)
```

**Source:** `effect/Layer.ts` - see `~/Developer/effect/packages/effect/src/Layer.ts`
