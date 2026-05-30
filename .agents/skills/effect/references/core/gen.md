# Generator Syntax

`Effect.gen` gives direct-style code while staying fully typed.

## When To Use

Use `Effect.gen` when a workflow has dependency access, multiple ordered steps,
branching, early returns, or named intermediate values. It should read like
normal business logic while preserving typed errors and services.

Use `.pipe` outside the generator for error handling, tracing, retries, simple
transforms, and Layer composition.

## Basic Pattern

```ts
import { Effect } from "effect"

const program = Effect.gen(function*() {
  const a = yield* Effect.succeed(1)
  const b = yield* Effect.succeed(2)
  return a + b
})
```

## With Errors

```ts
import { Effect } from "effect"

class NotFound {
  readonly _tag = "NotFound"
}

const read = Effect.gen(function*() {
  const value = yield* Effect.fail(new NotFound()).pipe(
    Effect.catch(() => Effect.succeed("fallback"))
  )
  return value
})
```

Note: v4 renamed `catchAll` to `catch`.

## With Services

```ts
import { Effect, Layer, Context } from "effect"

class Config extends Context.Service<Config, { readonly baseUrl: string }>()("Config") {}

const program = Effect.gen(function*() {
  const config = yield* Config
  return config.baseUrl
}).pipe(
  Effect.provide(Layer.succeed(Config, { baseUrl: "https://api.example.com" }))
)
```

## Scoped Usage

Use `Effect.scoped(...)` when acquiring resources that need finalization (e.g. connections, file handles). In v4, use `Layer.effect` with `Effect.acquireRelease` instead.

## Avoid

Do not turn sequential business logic into long `.pipe(Effect.andThen(...))`
chains. Prefer named `yield*` steps when the operation is a workflow rather than
a single transform.

## Key v4 Changes

- `Context.Tag` replaced by `Context.Service`
- `catchAll` renamed to `catch` (v4)
- `yield*` still works the same way for service access

**Source:** `effect/Effect.ts` - see `~/Developer/effect/packages/effect/src/Effect.ts`
**Source:** `effect/Context.ts` - see `~/Developer/effect/packages/effect/src/Context.ts`
