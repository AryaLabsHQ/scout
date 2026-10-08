# Effect

## Table of Contents

- [Create Effects](#create-effects)
- [Compose Effects](#compose-effects)
- [Run Effects](#run-effects)
- [Concurrency Basics](#concurrency-basics)
- [Looping](#looping)
- [Services (Context.Service)](#services-contextservice)

Canonical Effect APIs for creating, composing,

and executing programs.

## Create Effects

```ts
import { Effect } from "effect";

const ok = Effect.succeed(123);
const fail = Effect.fail(new Error("boom"));

const fromTry = Effect.try({
  try: () => JSON.parse('{"a":1}'),
  catch: (cause) => new Error(String(cause)),
});

const fromPromise = Effect.tryPromise({
  try: () => fetch("https://example.com"),
  catch: (cause) => new Error(String(cause)),
});
```

## Compose Effects

```ts
import { Effect } from "effect";

const program = Effect.succeed(21).pipe(
  Effect.map((n) => n * 2),
  Effect.flatMap((n) => Effect.succeed(`value=${n}`)),
);

const guarded = Effect.succeed(10).pipe(
  Effect.filterOrFail(
    (n) => n > 0,
    () => new Error("must be positive"),
  ),
);
```

## Run Effects

```ts
import { Effect } from "effect";

Effect.runSync(Effect.succeed("sync"));
await Effect.runPromise(Effect.succeed("async"));
Effect.runSyncExit(Effect.succeed("exit"));
```

`await` at top level requires ESM with top-level await enabled; in CommonJS, wrap this in
`async function main() { ... }` and call `main()`.

## Concurrency Basics

```ts
import { Effect, Fiber } from "effect";

const concurrent = Effect.gen(function* () {
  const fiber = yield* Effect.forkChild(Effect.sleep("100 millis").pipe(Effect.as(1)));
  return yield* Fiber.join(fiber);
});
```

## Looping

Use a generator `while`, `Effect.repeat`, or `Stream.iterate`.

```ts
import { Effect, Stream } from "effect";

const counted = Effect.gen(function* () {
  let n = 0;
  while (n < 3) {
    n = yield* Effect.succeed(n + 1);
  }
  return n;
});

const streamed = Stream.iterate(0, (n) => n + 1).pipe(Stream.take(3), Stream.runCollect);
```

## Services (Context.Service)

Define services with `Context.Service` and access them via `yield*`.

```ts
import { Context, Effect, Layer } from "effect";

// Define a service (function syntax)
const Database = Context.Service<{
  readonly query: (sql: string) => Effect.Effect<string>;
}>("Database");

// Define a service (class syntax)
class Config extends Context.Service<Config, { readonly port: number }>()("Config") {}

// Layer-based service provision
const ConfigLive = Layer.succeed(Config, { port: 8080 });

const program = Effect.gen(function* () {
  const config = yield* Config;
  return config.port;
}).pipe(Effect.provide(ConfigLive));
```

**Source:** `effect/Effect.ts` - see `~/Developer/effect/packages/effect/src/Effect.ts` **Source:**
`effect/Context.ts` - see `~/Developer/effect/packages/effect/src/Context.ts`
