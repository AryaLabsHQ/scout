# Runtime Services

These modules are the runtime-facing building blocks for time, randomness, logging, tracing, and fiber-local state in Effect applications.

## Key APIs

| Module | Key APIs | What they are for |
| --- | --- | --- |
| `Clock` | `Clock.sleep`, `Clock.currentTimeMillis`, `Clock.currentTimeNanos`, `Clock.clockWith` | Time access and scheduling through the runtime clock service |
| `Duration` | `Duration.decode`, `Duration.millis`, `Duration.seconds`, `Duration.minutes`, `Duration.toMillis`, `Duration.format` | Typed time values and conversions for delays, schedules, and limits |
| `Random` | `Random.next`, `Random.nextIntBetween`, `Random.nextBoolean`, `Random.shuffle`, `Random.choice` | Deterministic runtime-provided randomness (and testable overrides) |
| `Crypto` | `Crypto.randomUUIDv4`, `Crypto.randomUUIDv7`, secure random bytes / digests | Cryptographic IDs and secure randomness (beta.68+) — **not** `Random.nextUUIDv4` (removed) |
| `Logger` | `Logger.make`, `Logger.consolePretty()`, `Logger.consoleJson`, `References.MinimumLogLevel`, `Effect.logInfo`, `Effect.annotateLogs`, `Effect.withLogSpan` | Structured logs and logger-layer composition |
| `Tracer` | `Effect.withSpan`, `Effect.useSpan`, `Effect.annotateCurrentSpan`, `Tracer.externalSpan` | Distributed tracing spans and span metadata |
| `References` | `References.CurrentLogLevel`, `References.CurrentLogAnnotations`, `References.CurrentConcurrency`, etc. | Fiber-local references (v4: replaces FiberRef) |

## Concise Snippet

```ts
import { Clock, Duration, Effect, Logger, Random, References } from "effect"

const program = Effect.gen(function*() {
  const now = yield* Clock.currentTimeMillis
  const jitterMs = yield* Random.nextIntBetween(10, 25)

  yield* Effect.annotateLogs({ module: "runtime-services" })
  yield* Effect.logInfo(`sleeping for ${jitterMs}ms`)
  yield* Effect.sleep(Duration.millis(jitterMs))

  return now
}).pipe(
  Effect.withSpan("runtime-services.demo"),
  Effect.annotateLogs({ module: "runtime-services" }),
  Effect.withLogSpan("demo"),
  Effect.provide(Logger.consolePretty())
)
```

## v4 FiberRef → References

In v4, `FiberRef` is replaced by `Context.Reference` built-in values exported from `References`:

| v3 FiberRef | v4 Reference |
|-------------|--------------|
| `FiberRef.currentConcurrency` | `References.CurrentConcurrency` |
| `FiberRef.currentLogLevel` | `References.CurrentLogLevel` |
| `FiberRef.currentMinimumLogLevel` | `References.MinimumLogLevel` (also `References.CurrentLogLevel`) |
| `FiberRef.currentLogAnnotations` | `References.CurrentLogAnnotations` |
| `FiberRef.currentLogSpan` | `References.CurrentLogSpans` |
| `FiberRef.currentTracerEnabled` | `References.TracerEnabled` |

## Test-Time Notes

- `TestClock` provides deterministic time control for effects that use `sleep`, timeouts, retries, and schedules.
- Use `TestClock.adjust` to advance time and `TestClock.setTime` to set the current time.
- Provide `TestClock` directly to effects that need deterministic time.

```ts
import { Effect, Fiber, TestClock } from "effect"

const testProgram = Effect.gen(function*() {
  const fiber = yield* Effect.sleep("5 seconds").pipe(Effect.forkChild)
  yield* TestClock.adjust("5 seconds")
  yield* Fiber.join(fiber)
}).pipe(Effect.provide(TestClock))
```

Note: v4 renamed `Effect.fork` to `Effect.forkChild`.

## Use Cases

- Replace wall-clock waiting with deterministic clock control in tests.
- Add request/tenant context to logs and spans with `References.*`.
- Standardize structured logs (human vs JSON output) by swapping logger layers.
- Use runtime randomness without hard-coding global mutable RNG state.

---

**Source:** `effect/Clock.ts` - see `~/Developer/effect/packages/effect/src/Clock.ts`

**Source:** `effect/Random.ts` - see `~/Developer/effect/packages/effect/src/Random.ts`

**Source:** `effect/Logger.ts` - see `~/Developer/effect/packages/effect/src/Logger.ts`

**Source:** `effect/References.ts` - see `~/Developer/effect/packages/effect/src/References.ts`

**Source:** `effect/Duration.ts` - see `~/Developer/effect/packages/effect/src/Duration.ts`

**Source:** `effect/Tracer.ts` - see `~/Developer/effect/packages/effect/src/Tracer.ts`
