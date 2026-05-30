# Real-World Effect Patterns

Production patterns adapted for Effect v4.

**Source:** `effect/Data.ts` - see `~/Developer/effect/packages/effect/src/Data.ts`
**Source:** `effect/Effect.ts` - see `~/Developer/effect/packages/effect/src/Effect.ts`
**Source:** `effect/Schema.ts` - see `~/Developer/effect/packages/effect/src/Schema.ts`
**Source:** `effect/Context.ts` - see `~/Developer/effect/packages/effect/src/Context.ts`
**Source:** `effect/Layer.ts` - see `~/Developer/effect/packages/effect/src/Layer.ts`
**Source:** `effect/Cache.ts` - see `~/Developer/effect/packages/effect/src/Cache.ts`
**Source:** `effect/Exit.ts` - see `~/Developer/effect/packages/effect/src/Exit.ts`

> Rule: use `Effect.tryPromise` only when the Promise cannot reject. If it can reject, use `Effect.tryPromise({ try, catch })`.
> Illustrative examples in this guide are pseudocode unless explicitly noted.

## Typed Errors with Data.TaggedError

Better than string-based error types with discriminated unions.

### Basic Tagged Error

```typescript
import { Data } from "effect"

class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly resource: string
  readonly id: string
}> {}

class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string
  readonly message: string
}> {}

// Type is automatically: NotFoundError | ValidationError
const handleError = (error: NotFoundError | ValidationError) => {
  switch (error._tag) {
    case "NotFoundError":
      return `Missing: ${error.resource}`
    case "ValidationError":
      return `${error.field}: ${error.message}`
  }
}
```

### With Context

```typescript
import { Data, Effect } from "effect"

class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly cause: string
  readonly query: string
}> {
  static because(query: string, cause: string) {
    return new DatabaseError({ cause, query })
  }
}

const safeQuery = Effect.tryPromise({
  try: () => db.query("SELECT * FROM users"),
  catch: (cause: unknown) =>
    DatabaseError.because("SELECT * FROM users", String(cause))
})
```

### Error Stacks

```typescript
import { Effect } from "effect"

class ApiError extends Data.TaggedError("ApiError")<{
  readonly status: number
  readonly response: unknown
}> {}

class RateLimitError extends Data.TaggedError("RateLimitError")<{
  readonly status: number
  readonly response: unknown
  readonly retryAfter: number
}> {}

const handleRateLimit = Effect.gen(function*() {
  yield* retry().pipe(Effect.catchTag("RateLimitError", (e) =>
    Effect.sleep(e.retryAfter).pipe(Effect.flatMap(() => retry()))
  ))
})
```

## Access Proofs Pattern

Dependency injection for permissions/authorization using proofs.

> Illustrative pseudocode: snippets in this section use placeholder app functions and domain types.

### Basic Access Proof

```typescript
import { Effect, Context } from "effect"

// Define tags for different access levels
class RepoReadAccess extends Context.Service<RepoReadAccess, {
  readonly repoId: number
  readonly userId: string
}>()("@app/RepoReadAccess") {}

class RepoWriteAccess extends Context.Service<RepoWriteAccess, {
  readonly repoId: number
  readonly userId: string
}>()("@app/RepoWriteAccess") {}

// Verification function that returns a proof
const requireReadAccess = (repoId: number, userId: string) =>
  Effect.gen(function*() {
    const hasPermission = yield* checkRepoPermission(userId, repoId, "read")
    if (!hasPermission) {
      return yield* Effect.fail(new PermissionDeniedError({ userId, repoId }))
    }
    // Return proof - can be passed to other functions
    return { repoId, userId } as const
  })

// Using the proof
const getSecretData = (proof: { repoId: number }) =>
  Effect.gen(function*() {
    // Only runs if proof was obtained
    const data = yield* fetchSecret(proof.repoId)
    return data
  })

// Compose in a handler
const handler = Effect.gen(function*() {
  const proof = yield* requireReadAccess(123, "user-1")
  const data = yield* getSecretData(proof)
  return data
})
```

### Scoped Access with Layer

```typescript
import { Effect, Layer, Context } from "effect"

class CurrentUser extends Context.Service<CurrentUser, User>()("@app/CurrentUser") {}

const withUser = Layer.effect(
  CurrentUser,
  Effect.gen(function*() {
    const session = yield* getSession()
    return session.user
  })
)

const requireRole = (role: Role) =>
  Effect.gen(function*() {
    const user = yield* CurrentUser
    if (!user.roles.includes(role)) {
      return yield* Effect.fail(new ForbiddenError())
    }
    return user
  })

// In handler - Layer provides CurrentUser
Effect.gen(function*() {
  const user = yield* requireRole("admin")
  // ...
}).pipe(Effect.provide(withUser))
```

## Schema Validation at Boundaries

### HTTP Request Validation

```typescript
import { Effect, Schema } from "effect"

// Define API input schema
const CreateUserSchema = Schema.Struct({
  name: Schema.String.check(Schema.isNonEmpty()),
  email: Schema.String
})

// Validate in request handler
const createUser = (request: unknown) =>
  Effect.gen(function*() {
    const input = Schema.decodeUnknownSync(CreateUserSchema)(request)
    // input is now typed as { name: string; email: string }
    return yield* createUserInDb(input)
  })
```

### Config Schema with Defaults

```typescript
import { Schema } from "effect"

const AppConfig = Schema.Struct({
  port: Schema.Number.pipe(Schema.withDecodingDefault(() => 3000)),
  host: Schema.String.pipe(Schema.withDecodingDefault(() => "0.0.0.0")),
  dbUrl: Schema.String
})

// Decode from environment
const config = Schema.decodeUnknownSync(AppConfig)({
  DB_URL: process.env.DATABASE_URL  // only dbUrl is required
})
```

### JSON API Responses

```typescript
import { Effect, Schema } from "effect"

const UserResponseSchema = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.Number,
    name: Schema.String,
    email: Schema.String
  })
)

const fetchUser = (id: number) =>
  Effect.gen(function*() {
    const response = yield* Effect.tryPromise({
      try: () => fetch(`https://api.example.com/users/${id}`),
      catch: (cause: unknown) => new Error(String(cause))
    })
    const json = yield* Effect.tryPromise({
      try: () => response.json() as Promise<string>,
      catch: (cause: unknown) => new Error(String(cause))
    })
    return yield* Schema.decodeUnknownEffect(UserResponseSchema)(json)
  })
```

## Service Layer Patterns

### Runtime Configuration

```typescript
import { Effect, Layer, Context } from "effect"

class AppConfig extends Context.Service<AppConfig, {
  readonly databaseUrl: string
  readonly apiKey: string
}>()("@app/AppConfig") {}

const baseLayer = Layer.effect(
  AppConfig,
  Effect.gen(function*() {
    const config = yield* Effect.tryPromise({
      try: () => loadConfig(),
      catch: (cause: unknown) => new Error(String(cause))
    })
    return config
  })
)

// Compose with other services
const fullLayer = Layer.provide(
  Database.layer,
  baseLayer
)
```

### Override in Tests

```typescript
import { Effect, Layer } from "effect"

const testLayer = Layer.succeed(AppConfig, {
  databaseUrl: "sqlite::memory:",
  apiKey: "test-key"
})

Effect.runPromise(
  handler.pipe(Effect.provide(testLayer))
)
```

## Effect Cache for Deduplication

```typescript
import { Cache, Duration, Effect } from "effect"

const queryCache = yield* Cache.make({
  capacity: 100,
  timeToLive: Duration.minutes(5),
  lookup: (key: string) =>
    Effect.tryPromise({
      try: () => fetchQuery(key),
      catch: (cause: unknown) => new Error(String(cause))
    })
})

const cachedQuery = (key: string) =>
  Effect.gen(function*() {
    const cache = yield* queryCache
    return yield* Cache.get(cache, key)
  })
```

## Exit Pattern for Result Handling

Convert Effect results for cross-boundary passing.

### Exit Encoding

```typescript
import { Effect, Exit } from "effect"

// Wrap effect result
const toExitEncoded = <A, E>(
  effect: Effect.Effect<A, E>
): Promise<Exit.Exit<A, E>> =>
  Effect.runPromiseExit(effect)

// If an effect is guaranteed sync-only, `Effect.runSyncExit(effect)` is also valid.

// Decode on other side
const fromExitEncoded = <A, E>(exit: Exit.Exit<A, E>): Effect.Effect<A, E> => {
  switch (exit._tag) {
    case "Success": return Effect.succeed(exit.value)
    case "Failure": return Effect.failCause(exit.cause)
  }
}
```

### Result from Exit

```typescript
import { Exit } from "effect"

type Result<A, E> = { _tag: "success"; value: A } | { _tag: "failure"; cause: E }

const toResult = <A, E>(exit: Exit.Exit<A, E>): Result<A, E> => {
  switch (exit._tag) {
    case "Success": return { _tag: "success", value: exit.value }
    case "Failure": return { _tag: "failure", cause: exit.cause }
  }
}
```

## Common Pitfalls

### Forgetting to Handle Errors

```typescript
// Wrong - rejected Promise becomes an untyped defect
const wrongUserAtom = runtime.atom(
  Effect.promise(() => fetchUser(userId))
)

// Right - keep failures in the Effect error channel
const rightUserAtom = runtime.atom(
  Effect.tryPromise({
    try: () => fetchUser(userId),
    catch: (cause: unknown) => new Error(String(cause))
  })
)
```

### Circular Dependencies in Services

```typescript
// Wrong - circular in Layer
class ServiceBWrong extends Context.Service<ServiceBWrong, { readonly name: string }>()("B") {}
class ServiceAWrong extends Context.Service<ServiceAWrong, { readonly b: { readonly name: string } }>()("A") {}

const wrongLayerA = Layer.effect(ServiceAWrong, Effect.gen(function*() {
  const b = yield* ServiceBWrong // Needs B at layer construction time
  return { b }
}))
```

```typescript
// Right - use Effect.suspend to break cycle
class ServiceB extends Context.Service<ServiceB, { readonly name: string }>()("B") {}
class ServiceA extends Context.Service<ServiceA, { readonly b: { readonly name: string } }>()("A") {}

const layerA = Layer.effect(
  ServiceA,
  Effect.suspend(() =>
    Effect.gen(function*() {
      const b = yield* ServiceB // Defer resolution to runtime
      return { b }
    })
  )
)
```

## v3 to v4 Pattern Changes

### Schema Validation

v3:
```ts
const decodeUser = Schema.decodeUnknown(User)
const userFromBoundary = decodeUser({ id: 1, name: "Arya" })
```

v4:
```ts
const decodeUser = Schema.decodeUnknownEffect(User)
const userFromBoundary = await decodeUser({ id: 1, name: "Arya" })
// or sync: Schema.decodeUnknownSync(User)({ id: 1, name: "Arya" })
```

### ParseJson

v3:
```ts
const UserFromJson = Schema.parseJson(User)
```

v4:
```ts
const UserFromJson = Schema.fromJsonString(User)
```

### Optional Fields

v3:
```ts
const Profile = Schema.Struct({
  bio: Schema.optional(Schema.String),
  nickname: Schema.OptionFromNullishOr(Schema.String, null)
})
```

v4:
```ts
const Profile = Schema.Struct({
  bio: Schema.optional(Schema.String),
  nickname: Schema.optionalKey(Schema.String)  // exact optional
})
```

### Transform

v3:
```ts
const BooleanFromString = Schema.transform(Schema.Literal("on", "off"), Schema.Boolean, {
  decode: (literal) => literal === "on",
  encode: (bool) => (bool ? "on" : "off")
})
```

v4:
```ts
import { SchemaTransformation } from "effect"

const BooleanFromString = Schema.Literals(["on", "off"]).pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (literal) => literal === "on",
      encode: (bool) => (bool ? "on" : "off")
    })
  )
)
```
