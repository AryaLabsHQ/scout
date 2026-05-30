# Effect

Canonical Effect APIs for creating, composing, and executing programs.

## Create Effects

```ts
import { Effect } from "effect"

const ok = Effect.succeed(123)
const fail = Effect.fail(new Error("boom"))

const fromTry = Effect.try({
  try: () => JSON.parse('{"a":1}'),
  catch: (cause) => new Error(String(cause))
})

const fromPromise = Effect.tryPromise({
  try: () => fetch("https://example.com"),
  catch: (cause) => new Error(String(cause))
})
```

## Compose Effects

```ts
import { Effect } from "effect"

const program = Effect.succeed(21).pipe(
  Effect.map((n) => n * 2),
  Effect.flatMap((n) => Effect.succeed(`value=${n}`))
)

const guarded = Effect.succeed(10).pipe(
  Effect.filterOrFail((n) => n > 0, () => new Error("must be positive"))
)
```

## Run Effects

```ts
import { Effect } from "effect"

Effect.runSync(Effect.succeed("sync"))
await Effect.runPromise(Effect.succeed("async"))
Effect.runSyncExit(Effect.succeed("exit"))
```

`await` at top level requires ESM with top-level await enabled; in CommonJS, wrap this in `async function main() { ... }` and call `main()`.

## Concurrency Basics

```ts
import { Effect, Fiber } from "effect"

const concurrent = Effect.gen(function*() {
  const fiber = yield* Effect.forkChild(Effect.sleep("100 millis").pipe(Effect.as(1)))
  return yield* Fiber.join(fiber)
})
```

## Looping

```ts
import { Effect } from "effect"

const iterate = Effect.iterate(0, {
  while: (n) => n < 3,
  body: (n) => Effect.succeed(n + 1)
})

const loop = Effect.loop(0, {
  while: (n) => n < 3,
  step: (n) => n + 1,
  body: (n) => Effect.succeed(n)
})
```

## Services (v4: Context.Service)

In v4, `Context.Tag` is replaced by `Context.Service`. Services are accessed via `yield*`.

```ts
import { Context, Effect, Layer } from "effect"

// Define a service (function syntax)
const Database = Context.Service<{
  readonly query: (sql: string) => Effect.Effect<string>
}>("Database")

// Define a service (class syntax)
class Config extends Context.Service<Config, { readonly port: number }>()("Config") {}

// Layer-based service provision
const ConfigLive = Layer.succeed(Config, { port: 8080 })

const program = Effect.gen(function*() {
  const config = yield* Config
  return config.port
}).pipe(Effect.provide(ConfigLive))
```

## Key v4 Changes from v3

| v3 | v4 |
|----|----|
| `Context.Tag` | `Context.Service` |
| `Context.GenericTag` | `Context.Service` |
| `Runtime<R>` removed | Use `Effect.run*`, `Effect.context`, or `ManagedRuntime` directly |
| `Effect.fork` | `Effect.forkChild` |
| `Effect.forkDaemon` | `Effect.forkDetach` |
| `Effect.catchAll` | `Effect.catch` |
| `Effect.catchAllCause` | `Effect.catchCause` |
| `Effect.catchSome` | `Effect.catchFilter` |

**Source:** `effect/Effect.ts` - see `~/Developer/effect/packages/effect/src/Effect.ts`
**Source:** `effect/Context.ts` - see `~/Developer/effect/packages/effect/src/Context.ts`
