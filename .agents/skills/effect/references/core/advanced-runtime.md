# Advanced Runtime

Advanced core runtime patterns for causes, scoped lifecycles, refreshable resources, and managed runtimes.

## Cause Basics (v4: Flattened)

`Cause<E>` is now flat — no more `Sequential`/`Parallel` variants.

```ts
import { Cause, Effect, Exit } from "effect"

const inspect = (exit: Exit.Exit<unknown, string>) =>
  Exit.match(exit, {
    onSuccess: () => "ok",
    onFailure: (cause) => ({
      failure: Cause.findErrorOption(cause), // Option<E>
      defect: Cause.findDefect(cause), // Option<unknown>
      interrupted: Cause.hasInterrupts(cause),
      interruptedOnly: Cause.hasInterruptsOnly(cause)
    })
  })

const failed = inspect(Effect.runSyncExit(Effect.fail("bad-input")))
const died = inspect(Effect.runSyncExit(Effect.die("bug")))
const interrupted = inspect(Effect.runSyncExit(Effect.interrupt))
```

## v4 Cause Changes

| v3 | v4 |
|----|----|
| `Cause.failureOption(cause)` | `Cause.findErrorOption(cause)` |
| `Cause.dieOption(cause)` | `Cause.findDefect(cause)` |
| `Cause.failures(cause)` | `cause.reasons.filter(Cause.isFailReason)` |
| `Cause.isFailure(cause)` | `Cause.hasFails(cause)` |
| `Cause.isDie(cause)` | `Cause.hasDies(cause)` |
| `Cause.isInterrupted(cause)` | `Cause.hasInterrupts(cause)` |
| `Cause.isInterruptedOnly(cause)` | `Cause.hasInterruptsOnly(cause)` |

## Scope Lifecycle (`acquireRelease` + `scoped`)

Use `Effect.acquireRelease` to register cleanup, then wrap the workflow in `Effect.scoped` to run and close the scope.

```ts
import { Effect } from "effect"

const handle = Effect.acquireRelease(
  Effect.sync(() => {
    console.log("open")
    return { read: () => "payload" }
  }),
  () => Effect.sync(() => console.log("close"))
)

const program = Effect.gen(function*() {
  const h = yield* handle
  yield* Effect.sync(() => console.log(h.read()))
}).pipe(Effect.scoped)

await Effect.runPromise(program)
// open
// payload
// close
```

`await` at top level requires ESM with top-level await enabled; in CommonJS, wrap this in `async function main() { ... }` and call `main()`.

## Resource Module (Intent)

Use `Resource` when a value should stay live and be refreshed (`manual` / `auto`), not for one-shot acquire/use/release.

```ts
import { Effect, Resource } from "effect"

const program = Effect.gen(function*() {
  const cache = yield* Resource.manual(Effect.sync(() => Date.now()))
  const first = yield* Resource.get(cache)
  yield* Effect.sleep("1 millis")
  yield* Resource.refresh(cache)
  const second = yield* Resource.get(cache)
  return { first, second }
}).pipe(Effect.scoped)

const value = await Effect.runPromise(program)
```

`await` at top level requires ESM with top-level await enabled; in CommonJS, wrap this in `async function main() { ... }` and call `main()`.

## ManagedRuntime Basics

`ManagedRuntime.make(layer)` builds a reusable runtime from a `Layer`. Run effects with `runPromise` and always `dispose` when done.

```ts
import { Effect, Layer, ManagedRuntime, Context } from "effect"

class ApiUrl extends Context.Service<ApiUrl>()("ApiUrl") {}
const runtime = ManagedRuntime.make(Layer.succeed(ApiUrl, { url: "https://api.example.com" }))

const program = Effect.gen(function*() {
  const api = yield* ApiUrl
  return `${api.url}/health`
})

try {
  const healthUrl = await runtime.runPromise(program)
  console.log(healthUrl)
} finally {
  await runtime.dispose()
}
```

`await` at top level requires ESM with top-level await enabled; in CommonJS, wrap this in `async function main() { ... }` and call `main()`.

---

**Source:** `effect/Cause.ts` - see `~/Developer/effect/packages/effect/src/Cause.ts`

**Source:** `effect/Resource.ts` - see `~/Developer/effect/packages/effect/src/Resource.ts`

**Source:** `effect/ManagedRuntime.ts` - see `~/Developer/effect/packages/effect/src/ManagedRuntime.ts`

**Source:** `effect/Effect.ts` - see `~/Developer/effect/packages/effect/src/Effect.ts` (for `acquireRelease`, `scoped`)
