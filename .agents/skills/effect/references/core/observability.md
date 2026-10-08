# Observability

Use Effect logging and tracing operators.

## Logging

```ts
import { Effect } from "effect";

const logProgram = Effect.logInfo("starting").pipe(
  Effect.zipRight(Effect.logDebug("debug details")),
  Effect.annotateLogs({ module: "billing", requestId: "req-1" }),
  Effect.withLogSpan("billing_request"),
);
```

## Tracing Spans

```ts
import { Effect } from "effect";

const traced = Effect.succeed("ok").pipe(Effect.withSpan("my-span"));

const tracedScoped = Effect.useSpan("work-span", (span) =>
  Effect.annotateCurrentSpan({ spanName: span.name }),
);
```

Use `Effect.withSpan` to wrap an existing effect and `Effect.useSpan` when you need span access in a
callback.

## Logging References

Access built-in logging state through `References.*`:

```ts
import { Effect, References } from "effect";

const program = Effect.gen(function* () {
  const logLevel = yield* References.CurrentLogLevel;
  const annotations = yield* References.CurrentLogAnnotations;
});
```

Use `References.CurrentLogSpans` for log spans and `References.TracerEnabled` for tracing state.

`References.CurrentConcurrency` was removed in beta.102. Pass an explicit `number` or `"unbounded"`.

---

**Source:** `effect/Logger.ts` - see `~/Developer/effect/packages/effect/src/Logger.ts`

**Source:** `effect/Tracer.ts` - see `~/Developer/effect/packages/effect/src/Tracer.ts`

**Source:** `effect/References.ts` - see `~/Developer/effect/packages/effect/src/References.ts`

**Source:** `effect/Effect.ts` - see `~/Developer/effect/packages/effect/src/Effect.ts` (for
`logInfo`, `logDebug`, `annotateLogs`, `withLogSpan`, `withSpan`, `useSpan`, `annotateCurrentSpan`)
