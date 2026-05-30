# Observability

Use Effect logging and tracing operators.

## Logging

```ts
import { Effect } from "effect"

const logProgram = Effect.logInfo("starting").pipe(
  Effect.zipRight(Effect.logDebug("debug details")),
  Effect.annotateLogs({ module: "billing", requestId: "req-1" }),
  Effect.withLogSpan("billing_request")
)
```

## Tracing Spans

```ts
import { Effect } from "effect"

const traced = Effect.succeed("ok").pipe(
  Effect.withSpan("my-span")
)

const tracedScoped = Effect.useSpan("work-span", (span) =>
  Effect.annotateCurrentSpan({ spanName: span.name })
)
```

Use `Effect.withSpan` to wrap an existing effect and `Effect.useSpan` when you need span access in a callback.

## v4 Logging Changes

In v4, `FiberRef` is replaced by `Context.Reference`. Built-in references like `currentLogLevel`, `currentLogAnnotations`, and `currentLogSpan` are now accessed via `References.*`:

```ts
import { Effect, References } from "effect"

const program = Effect.gen(function*() {
  const logLevel = yield* References.CurrentLogLevel
  const annotations = yield* References.CurrentLogAnnotations
})
```

## v4 FiberRef → Reference Changes

| v3 | v4 |
|----|----|
| `FiberRef.currentLogLevel` | `References.CurrentLogLevel` |
| `FiberRef.currentLogAnnotations` | `References.CurrentLogAnnotations` |
| `FiberRef.currentLogSpan` | `References.CurrentLogSpans` |
| `FiberRef.currentTracerEnabled` | `References.TracerEnabled` |
| `FiberRef.currentConcurrency` | `References.CurrentConcurrency` |

---

**Source:** `effect/Logger.ts` - see `~/Developer/effect/packages/effect/src/Logger.ts`

**Source:** `effect/Tracer.ts` - see `~/Developer/effect/packages/effect/src/Tracer.ts`

**Source:** `effect/References.ts` - see `~/Developer/effect/packages/effect/src/References.ts`

**Source:** `effect/Effect.ts` - see `~/Developer/effect/packages/effect/src/Effect.ts` (for `logInfo`, `logDebug`, `annotateLogs`, `withLogSpan`, `withSpan`, `useSpan`, `annotateCurrentSpan`)
