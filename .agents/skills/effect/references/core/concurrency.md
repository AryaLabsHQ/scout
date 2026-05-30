# Concurrency

Core Effect concurrency primitives: fibers, deferred values, and refs.

## Fibers

```ts
import { Effect, Fiber } from "effect"

const program = Effect.gen(function*() {
  const fiber = yield* Effect.forkChild(Effect.sleep("100 millis").pipe(Effect.as("done")))
  return yield* Fiber.join(fiber)
})
```

Note: v4 renamed `Effect.fork` to `Effect.forkChild` and `Effect.forkDaemon` to `Effect.forkDetach`.

## Racing

```ts
import { Effect } from "effect"

const fastest = Effect.race(
  Effect.sleep("1 second").pipe(Effect.as("slow")),
  Effect.sleep("100 millis").pipe(Effect.as("fast"))
)
```

## Deferred

```ts
import { Deferred, Effect } from "effect"

const signal = Effect.gen(function*() {
  const d = yield* Deferred.make<number, never>()
  yield* Deferred.complete(d, Effect.succeed(123))
  return yield* Deferred.await(d)
})
```

`Deferred.complete` takes an `Effect`. Use `Deferred.done` when you already have an `Exit`.

## Ref

```ts
import { Effect, Ref } from "effect"

const counter = Effect.gen(function*() {
  const ref = yield* Ref.make(0)
  yield* Ref.update(ref, (n) => n + 1)
  return yield* Ref.get(ref)
})
```

## v4 Forking Renamings

| v3 | v4 | Description |
|----|----|-------------|
| `Effect.fork` | `Effect.forkChild` | Fork as child of current fiber |
| `Effect.forkDaemon` | `Effect.forkDetach` | Fork detached from parent lifecycle |
| `Effect.forkScoped` | `Effect.forkScoped` | Fork tied to current `Scope` (unchanged) |
| `Effect.forkIn` | `Effect.forkIn` | Fork in specific `Scope` (unchanged) |
| `Effect.forkAll` | Removed | Fork individually with `forkChild` |

## Fork Options (v4)

All fork combinators accept an options object:

```ts
Effect.forkChild(myEffect, { startImmediately: true, uninterruptible: "inherit" })
```

- `startImmediately`: Start immediately vs deferred (default: deferred)
- `uninterruptible`: `true`, `"inherit"`, or `undefined` (default behavior)

## Fiber Keep-Alive (v4)

In v4, fiber keep-alive is automatic. No need for `runMain` from platform packages just to keep the process alive while fibers are suspended.

**Source:** `effect/Effect.ts` - see `~/Developer/effect/packages/effect/src/Effect.ts`
**Source:** `effect/Fiber.ts` - see `~/Developer/effect/packages/effect/src/Fiber.ts`
**Source:** `effect/Deferred.ts` - see `~/Developer/effect/packages/effect/src/Deferred.ts`
**Source:** `effect/Ref.ts` - see `~/Developer/effect/packages/effect/src/Ref.ts`
