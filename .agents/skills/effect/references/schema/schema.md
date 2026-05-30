# Schema

Effect Schema v4 describes data shapes, validates unknown input, and transforms values between formats.

## Define Schemas

```ts
import { Schema } from "effect"

class User extends Schema.Class<User>("User")({
  id: Schema.Number,
  name: Schema.String,
  email: Schema.String
}) {}

const UserArray = Schema.Array(User)
const IdOrEmail = Schema.Union([Schema.Number, Schema.String])
```

**Source:** `effect/Schema.ts` - see `~/Developer/effect/packages/effect/src/Schema.ts`

## Decode and Validate

v4 decodes/encodes via Effect or sync. `decodeUnknown*` accepts external data (HTTP/DB); `decode*` accepts already-typed values.

```ts
import { Effect, Schema } from "effect"

// Boundary input (unknown): HTTP/DB/etc.
const decodeUnknownUser = Schema.decodeUnknownEffect(User)
const result1 = await decodeUnknownUser({ id: 1, name: "Arya", email: "a@example.com" })

// Internal typed value
const typedUser = User.make({ id: 1, name: "Arya", email: "a@example.com" })
const result2 = await Schema.decodeEffect(User)(typedUser)
```

**Sync variants** (throw on failure):

```ts
const user = Schema.decodeUnknownSync(User)({ id: 1, name: "Arya", email: "a@example.com" })
// throws Schema.SchemaError on failure
```

**Exit variants** (non-throwing):

```ts
const exit = Schema.decodeUnknownExit(User)({ id: 1, name: "Arya", email: "a@example.com" })
// Exit.Success | Exit.Failure
```

**Option variants**:

```ts
const option = Schema.decodeUnknownOption(User)({ id: 1, name: "Arya", email: "a@example.com" })
// Option<user>
```

## Assert (runtime validation)

Since beta.68, assert a value directly — do not use the removed `Schema.Codec.ToAsserts` helper:

```ts
import { Schema } from "effect"

const assertUser = (input: unknown): asserts input is User =>
  Schema.asserts(User, input)
```

Throws `Schema.SchemaError` on failure (sync).

## Encode

```ts
const encodeUser = Schema.encodeUnknownEffect(User)
const encoded = await encodeUser(User.make({ id: 1, name: "Arya", email: "a@example.com" }))
// { id: 1, name: "Arya", email: "a@example.com" }
```

Sync: `Schema.encodeUnknownSync`. Exit: `Schema.encodeUnknownExit`.

**Source:** `effect/Schema.ts` - see `~/Developer/effect/packages/effect/src/Schema.ts`

## JSON Boundary

```ts
import { Schema } from "effect"

// Parse JSON string, then decode against schema
const UserFromJson = Schema.fromJsonString(User)
const decodedEffect = Schema.decodeUnknownEffect(UserFromJson)(`{"id":1,"name":"Arya","email":"a@example.com"}`)
```

Or pipe style:

```ts
const decodedEffect = Schema.decodeUnknownEffect(Schema.fromJsonString(User))(
  `{"id":1,"name":"Arya","email":"a@example.com"}`
)
```

## Boundary Cookbook

| Boundary | Recommended API |
|----------|------------------|
| HTTP JSON payload (string) | `Schema.decodeUnknownEffect(Schema.fromJsonString(MySchema))(rawJson)` |
| Env/config object | `Schema.decodeUnknownSync(ConfigSchema)(rawConfig)` |
| DB row from driver/ORM | `Schema.decodeUnknownSync(RowSchema)(rawRow)` |
| Query params or request body object | `Schema.decodeUnknownSync(QueryOrBodySchema)(rawInput)` |

## Option and Optional Fields

```ts
import { Schema } from "effect"

const Profile = Schema.Struct({
  bio: Schema.optional(Schema.String),      // T | undefined
  nickname: Schema.optionalKey(Schema.String)  // exact optional (key can be missing, but not undefined)
})
```

- `Schema.optional(...)` creates `T | undefined` (key can be missing or undefined)
- `Schema.optionalKey(...)` creates exact optional (key can be missing; undefined is rejected)
- `Schema.OptionFromNullishOr(Schema.String, null)` converts null/undefined to `Option`

**Source:** `effect/Schema.ts` - see `~/Developer/effect/packages/effect/src/Schema.ts`

## Transformations

Transform between schemas with `decodeTo`:

```ts
import { Schema, SchemaTransformation } from "effect"

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

For transformations that can fail, use `Schema.decodeTo` with `SchemaGetter.transformOrFail`:

```ts
import { Effect, Number, Option, Schema, SchemaGetter, SchemaIssue } from "effect"

const NumberFromString = Schema.String.pipe(
  Schema.decodeTo(Schema.Number, {
    decode: SchemaGetter.transformOrFail((s) => {
      const n = Number.parse(s)
      if (n === undefined) {
        return Effect.fail(new SchemaIssue.InvalidValue(Option.some(s)))
      }
      return Effect.succeed(n)
    }),
    encode: SchemaGetter.String()
  })
)
```

## Filters (Constraints)

Attach constraints with `.check(...)`. Filters are renamed with `is` prefix in v4:

```ts
import { Schema } from "effect"

const nonEmptyName = Schema.String.check(Schema.isMinLength(1))
const positiveAge = Schema.Number.check(Schema.isGreaterThan(0))
const trimmedNonEmpty = Schema.Trimmed.check(Schema.isNonEmpty())
```

Filters available: `isMinLength`, `isMaxLength`, `isGreaterThan`, `isLessThan`, `isBetween`, `isInt`, `isMultipleOf`, `isFinite`, `isPattern`, `isUUID`, `isULID`.

**Source:** `effect/Schema.ts` - see `~/Developer/effect/packages/effect/src/Schema.ts`

## Struct Transformations

```ts
import { Schema, Struct } from "effect"

// Pick fields
const picked = Schema.Struct({ a: Schema.String, b: Schema.Number }).mapFields(Struct.pick(["a"]))

// Omit fields
const omitted = Schema.Struct({ a: Schema.String, b: Schema.Number }).mapFields(Struct.omit(["b"]))

// Make all fields optional (undefined)
const partial = Schema.Struct({ a: Schema.String, b: Schema.Number }).mapFields(Struct.map(Schema.optional))

// Make all fields exact optional
const exactPartial = Schema.Struct({ a: Schema.String, b: Schema.Number }).mapFields(Struct.map(Schema.optionalKey))

// Assign/extend
const extended = Schema.Struct({ a: Schema.String }).mapFields(Struct.assign({ b: Schema.Number }))
```

## Optional Field Defaults

```ts
import { Schema } from "effect"

// Default for non-optional fields (decoding only)
const withDefault = Schema.Struct({
  name: Schema.String.pipe(Schema.withDecodingDefault(() => "Anonymous"))
})

// Default for exact optional fields
const withDefaultKey = Schema.Struct({
  name: Schema.optionalKey(Schema.String).pipe(Schema.withDecodingDefaultKey(() => "Anonymous"))
})
```

### Defaults that need services or fail parse

Since beta.67, decoding/constructor defaults accept `Effect.Effect<_, Schema.SchemaError, R>` — not only sync thunks. A failing default propagates as a normal parse issue on the field path.

```ts
import { Context, Effect, Schema } from "effect"

class IdGen extends Context.Service<IdGen>()("IdGen", {
  effect: Effect.succeed({ next: () => crypto.randomUUID() })
}) {}

const Row = Schema.Struct({
  id: Schema.String.pipe(
    Schema.withDecodingDefaultKey(
      Effect.gen(function* () {
        const gen = yield* IdGen
        return gen.next()
      })
    )
  )
})

// decodeUnknown* now requires R when defaults do
await Schema.decodeUnknownEffect(Row)({}).pipe(Effect.provide(IdGen.Default))
```

Use `withDecodingDefault` when the key may be absent **or** `undefined`; `withDecodingDefaultType*` when the default is already in decoded `Type` form.

## Class Schema

```ts
import { Schema } from "effect"

class User extends Schema.Class<User>("User")({
  id: Schema.Number,
  name: Schema.String.check(Schema.isMinLength(1)),
  email: Schema.String,
  createdAt: Schema.optionalKey(Schema.Date)
}) {}

// Constructor: validates by default
const user = User.make({ id: 1, name: "Arya", email: "a@example.com" })

// Skip validation by passing `disableChecks: true` (use only when input is already trusted)
const raw = User.make(
  { id: 1, name: "Arya", email: "a@example.com" },
  { disableChecks: true }
)

// Option / Effect variants
const userOpt = User.makeOption({ id: 1, name: "Arya", email: "a@example.com" })
const userEff = User.makeEffect({ id: 1, name: "Arya", email: "a@example.com" })
```

**Source:** `effect/Schema.ts` - see `~/Developer/effect/packages/effect/src/Schema.ts`

## Error Handling

```ts
import { Schema, SchemaIssue } from "effect"

const decode = Schema.decodeUnknownSync(User)

try {
  decode({})
} catch (error) {
  if (Schema.isSchemaError(error) && SchemaIssue.isIssue(error.issue)) {
    const issues = SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues
    console.error(issues)
  }
}
```

## Tagged Error Classes (Schema.TaggedErrorClass)

Create structured, type-safe error classes using Schema when errors need serialization, transport, persistence, or generated API contracts:

```ts
import { Effect, Schema } from "effect"

// Define a tagged error class
export class AccountServiceError extends Schema.TaggedErrorClass<AccountServiceError>()(
  "AccountServiceError", {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
    code: Schema.optional(Schema.String),
  }
) {
  // Custom helper derived from the schema fields
  get displayMessage() {
    return `Account service error: ${this.message}`
  }
}

// Usage in error handling
const fetchAccount = Effect.gen(function* () {
  const response = yield* http.get("/account").pipe(
    Effect.mapError((error) =>
      new AccountServiceError({
        message: "Failed to fetch account", 
        cause: error 
      })
    )
  )
  return response
})
```

**Why use Schema.TaggedErrorClass?**
- Type-safe error definitions with Schema validation
- Tagged unions for exhaustive error handling
- Serializable error payloads (useful for logging/APIs)
- Custom properties and methods on error classes

**Comparison with Data.TaggedError:**
```ts
// Old way (still works)
import { Data } from "effect"
class MyError extends Data.TaggedError("MyError")<{ message: string }>() {}

// New way with Schema
import { Schema } from "effect"
class MyError extends Schema.TaggedErrorClass<MyError>()("MyError", {
  message: Schema.String
}) {}
```

**Source:** `effect/Schema.ts` - see `~/Developer/effect/packages/effect/src/Schema.ts`

## v3 to v4 API Changes

| v3 | v4 |
|----|----|
| `Schema.decodeUnknown` | `Schema.decodeUnknownEffect` |
| `Schema.decode` | `Schema.decodeEffect` |
| `Schema.encodeUnknown` | `Schema.encodeUnknownEffect` |
| `Schema.encode` | `Schema.encodeEffect` |
| `Schema.decodeUnknownEither` | `Schema.decodeUnknownExit` |
| `Schema.decodeEither` | `Schema.decodeExit` |
| `Schema.validate*` | removed (use `decode*` + `toType`) |
| `Schema.parseJson(schema)` | `Schema.fromJsonString(schema)` |
| `Schema.filter(predicate)` | `Schema.check(Schema.makeFilter(predicate))` |
| `Schema.Union(A, B)` | `Schema.Union([A, B])` |
| `Schema.Struct({...}).pipe(Schema.pick("a"))` | `Schema.Struct({...}).mapFields(Struct.pick(["a"]))` |
| `Schema.transform(from, to, { decode, encode })` | `from.pipe(decodeTo(to, SchemaTransformation.transform({ decode, encode })))` |
| `Schema.Literal("a", "b")` | `Schema.Literals(["a", "b"])` |
| `asSchema` | `revealCodec` |
| `typeSchema` | `toType` |
| `encodedSchema` | `toEncoded` |
