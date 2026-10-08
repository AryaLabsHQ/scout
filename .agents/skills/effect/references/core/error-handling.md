# Error Handling

## Table of Contents

- [Data.TaggedError](#datataggederror)
- [Schema.TaggedError](#schemataggederror)
- [Yieldable Schema Errors](#yieldable-schema-errors)
- [Error Unions](#error-unions)
- [Catching Errors](#catching-errors)
- [Schema.Defect - Wrapping Unknown Errors](#schemadefect---wrapping-unknown-errors)
- [Error Transformation](#error-transformation)
- [Effect.orDie - Converting to Defects](#effectordie---converting-to-defects)
- [Convert Error Channel](#convert-error-channel)
- [Retry](#retry)
- [Defects](#defects)
- [Error Handling APIs](#error-handling-apis)
- [Cause Structure](#cause-structure)

<!-- End table of contents -->

Effect models failures in the error channel (`E`)

and

defects separately. Use `Data.TaggedError` for ordinary in-process domain errors. Use
`Schema.TaggedError` when the error must be schema-backed for serialization, transport, persistence,
or generated API contracts.

## Data.TaggedError

Define ordinary domain errors with `Data.TaggedError`:

```ts
import { Data, Effect } from "effect";

class NotFound extends Data.TaggedError("NotFound")<{
  readonly id: string;
}> {}

const program = Effect.fail(new NotFound({ id: "42" }));
```

## Schema.TaggedError

Use `Schema.TaggedError` for errors that need a runtime schema:

```ts
import { Effect, Schema } from "effect";

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.String }) {}

class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  field: Schema.String,
  message: Schema.String,
}) {}

const program = Effect.fail(new NotFound({ id: "42" }));
```

**Benefits:**

- Serializable (can send over network/save to DB)
- Type-safe with built-in `_tag` for pattern matching
- Custom methods via class
- Sensible default `message` when you don't declare one

## Yieldable Schema Errors

`Schema.TaggedError` values are yieldable; return them directly in generators without wrapping in
`Effect.fail`:

```ts
import { Effect, Random, Schema } from "effect";

class BadLuck extends Schema.TaggedError<BadLuck>()("BadLuck", { roll: Schema.Number }) {}

const rollDie = Effect.gen(function* () {
  const roll = yield* Random.nextIntBetween(1, 6);
  if (roll === 1) {
    // Yield directly; no Effect.fail needed
    yield* new BadLuck({ roll });
  }
  return { roll };
});
```

## Error Unions

Compose multiple error types with `Schema.Union` for hierarchical error handling:

```ts
import { Effect, Schema } from "effect";

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.String }) {}

class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  field: Schema.String,
  message: Schema.String,
}) {}

// Create union type for functions that can fail in multiple ways
const AppError = Schema.Union([NotFound, ValidationError]);
type AppError = typeof AppError.Type;

// Usage: Effect<Success, AppError, never>
declare const loadUser: Effect.Effect<{ name: string }, AppError, never>;
```

## Catching Errors

### catch

Handle all errors by providing a fallback effect:

```ts
import { Effect, Schema } from "effect";

class HttpError extends Schema.TaggedError<HttpError>()("HttpError", {
  statusCode: Schema.Number,
  message: Schema.String,
}) {}

const recovered = program.pipe(
  Effect.catch((error) =>
    Effect.gen(function* () {
      yield* Effect.logError("Error occurred", error);
      return `Recovered from ${error._tag}`;
    }),
  ),
);
```

`catch*` combinators preserve unhandled error types in the inferred error channel (they do not
silently drop tags).

### catchTag

Handle specific errors by their `_tag`:

```ts
import { Effect, Schema } from "effect";

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.String }) {}

class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  message: Schema.String,
}) {}

const program: Effect.Effect<string, NotFound | ValidationError> = Effect.fail(
  new NotFound({ id: "42" }),
);

const recovered = program.pipe(
  Effect.catchTag("NotFound", (e) => Effect.succeed(`missing=${e.id}`)),
);
// Type: Effect<string, ValidationError, never>
```

### catchTags

Handle multiple error types at once:

```ts
import { Effect, Schema } from "effect";

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.String }) {}

class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  message: Schema.String,
}) {}

const recovered = program.pipe(
  Effect.catchTags({
    NotFound: (e) => Effect.succeed(`missing=${e.id}`),
    ValidationError: (e) => Effect.succeed(`invalid: ${e.message}`),
  }),
);
// Type: Effect<string, never, never>
```

### catchIf

Handle errors matching a predicate:

```ts
import { Effect, Schema } from "effect";

class HttpError extends Schema.TaggedError<HttpError>()("HttpError", {
  statusCode: Schema.Number,
  message: Schema.String,
}) {}

const program: Effect.Effect<string, HttpError> = Effect.fail(
  new HttpError({
    statusCode: 500,
    message: "Server error",
  }),
);

// Only catch 5xx errors
const recovered = program.pipe(
  Effect.catchIf(
    (error): error is HttpError => error._tag === "HttpError" && error.statusCode >= 500,
    (error) => Effect.succeed(`recovered from ${error.statusCode}`),
  ),
);
```

## Schema.Defect - Wrapping Unknown Errors

Use `Schema.Defect` to wrap unknown errors from external libraries into a serializable format:

```ts
import { Schema, Effect } from "effect";

class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {
  endpoint: Schema.String,
  statusCode: Schema.Number,
  error: Schema.Defect(), // Wrap the underlying error (Schema.Defect is a constructor — call it)
}) {}

const fetchUser = (id: string) =>
  Effect.tryPromise({
    try: () => fetch(`/api/users/${id}`).then((r) => r.json()),
    catch: (error) =>
      new ApiError({
        endpoint: `/api/users/${id}`,
        statusCode: 500,
        error,
      }),
  });
```

**Schema.Defect handles:**

- JavaScript `Error` instances → `{ name, message }` objects
- Any unknown value → string representation
- Serializable for network/storage

## Error Transformation

Catch one error type and fail with another to transform errors up the call stack:

```ts
import { Effect, Schema } from "effect";

class DatabaseError extends Schema.TaggedError<DatabaseError>()("DatabaseError", {
  message: Schema.String,
}) {}

class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  userId: Schema.String,
}) {}

const getUser = (id: string) =>
  Effect.gen(function* () {
    const user = yield* fetchFromDb(id).pipe(
      Effect.catchTag("DatabaseError", (e) =>
        // Transform database errors to domain error
        Effect.fail(new UserNotFound({ userId: id })),
      ),
    );
    return user;
  });
```

## Effect.orDie - Converting to Defects

Use `Effect.orDie` at system boundaries to convert recoverable errors to defects when recovery is
impossible:

```ts
import { Effect, Schema } from "effect";

class ConfigError extends Schema.TaggedError<ConfigError>()("ConfigError", {
  message: Schema.String,
}) {}

// At app entry: if config fails, nothing can proceed
const main = Effect.gen(function* () {
  const config = yield* loadConfig.pipe(
    Effect.orDie, // ConfigError -> defect (unrecoverable)
  );
  yield* Effect.log(`Starting on port ${config.port}`);
});
```

Use typed errors for domain failures the caller can handle (validation, not found, permissions). Use
defects for unrecoverable situations (bugs, invariant violations, missing critical config).

## Convert Error Channel

```ts
import { Effect } from "effect";

const asResult = Effect.result(Effect.fail("nope"));
const asOption = Effect.option(Effect.fail("nope"));
```

## Retry

```ts
import { Effect, Schedule } from "effect";

const retried = Effect.tryPromise({
  try: () => fetch("https://example.com"),
  catch: (error) => new Error(String(error)),
}).pipe(Effect.retry(Schedule.recurs(3)));
```

## Defects

Use `Effect.catchDefect` for unrecoverable defects (`die`, thrown defects), not typed failures.

**When to catch defects:** Almost never. Only at system boundaries for logging/diagnostics.

## Error Handling APIs

- **`Effect.catchReason(errorTag, reasonTag, handler)`** — catches a specific `reason` within a
  tagged error without removing the parent error from the error channel
- **`Effect.catchReasons(errorTag, cases)`** — like `catchReason` but handles multiple reason tags
  at once
- **`Effect.catchEager(handler)`** — synchronous recovery that evaluates immediately without lazy
  trampolining

## Cause Structure

`Cause<E>` stores a flat list of reasons:

```ts
import { Cause, Effect } from "effect";

const program = Effect.gen(function* () {
  const cause = yield* Effect.sandbox(
    Effect.all([Effect.fail("err1"), Effect.die("defect"), Effect.fail("err2")], {
      concurrency: "unbounded",
    }),
  ).pipe(Effect.flip);

  const errors = cause.reasons.filter(Cause.isFailReason).map((r) => r.error);
});
```

**Source:** `effect/Effect.ts` - see `~/Developer/effect/packages/effect/src/Effect.ts` **Source:**
`effect/Cause.ts` - see `~/Developer/effect/packages/effect/src/Cause.ts` **Source:**
`effect/Schema.ts` - see `~/Developer/effect/packages/effect/src/Schema.ts`
