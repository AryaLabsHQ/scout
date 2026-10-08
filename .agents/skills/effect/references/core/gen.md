# Generator Syntax

`Effect.gen` gives direct-style code while staying fully typed.

## When To Use

Use `Effect.gen` when a workflow has dependency access, multiple ordered steps, branching, early
returns, or named intermediate values. It should read like normal business logic while preserving
typed errors and services.

Use `.pipe` outside the generator for error handling, tracing, retries, simple transforms, and Layer
composition.

## Basic Pattern

```ts
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const a = yield* Effect.succeed(1);
  const b = yield* Effect.succeed(2);
  return a + b;
});
```

## With Errors

```ts
import { Effect } from "effect";

class NotFound {
  readonly _tag = "NotFound";
}

const read = Effect.gen(function* () {
  const value = yield* Effect.fail(new NotFound()).pipe(
    Effect.catch(() => Effect.succeed("fallback")),
  );
  return value;
});
```

## With Services

```ts
import { Effect, Layer, Context } from "effect";

class Config extends Context.Service<Config, { readonly baseUrl: string }>()("Config") {}

const program = Effect.gen(function* () {
  const config = yield* Config;
  return config.baseUrl;
}).pipe(Effect.provide(Layer.succeed(Config, { baseUrl: "https://api.example.com" })));
```

## Named Effect Functions

Wrap a generator in `Effect.fn` so its name reaches fiber dumps, stack traces, and tracing tools.
Every public service method and non-trivial internal method should have one.

```
Named effect function?
├─ Basic named function → Effect.fn("name")(function*(args) { ... })
├─ With call-site transformers → Effect.fn("name")(function* (args) { ... }, Effect.retry(schedule))
├─ Untraced for performance → Effect.fnUntraced(function*(args) { ... })
└─ With explicit type arguments → Effect.fn("name")<Args, Ret, Err>(function*(args) { ... })
```

Name the span after the domain operation, not the file:

```ts
const fetchData = Effect.fn("Api.fetchData")(function* (url: string) {
  const response = yield* http.get(url);
  return yield* response.json;
});
```

Reach for `Effect.fnUntraced` only where dropping span metadata is a deliberate decision, not as a
default.

## Scoped Usage

Use `Effect.scoped(...)` when acquiring resources that need finalization (e.g. connections, file
handles). For service layers, use `Layer.effect` with `Effect.acquireRelease`.

## Avoid

Do not turn sequential business logic into long `.pipe(Effect.andThen(...))` chains. Prefer named
`yield*` steps when the operation is a workflow rather than a single transform.

**Source:** `effect/Effect.ts` - see `~/Developer/effect/packages/effect/src/Effect.ts` **Source:**
`effect/Context.ts` - see `~/Developer/effect/packages/effect/src/Context.ts`
