# Schema

## Table of Contents

- [Records](#records)
- [Construction](#construction)
- [Decode and Validate](#decode-and-validate)
- [Assert (runtime validation)](#assert-runtime-validation)
- [Encode](#encode)
- [JSON Boundary](#json-boundary)
- [Boundary Cookbook](#boundary-cookbook)
- [Let Schema Own Wire Encoding](#let-schema-own-wire-encoding)
- [Optionality and Defaults](#optionality-and-defaults)
- [Transformations](#transformations)
- [Schema constraints and wrappers](#schema-constraints-and-wrappers)
- [Filters (Constraints)](#filters-constraints)
- [Field and Contract Reuse](#field-and-contract-reuse)
- [Optional Field Defaults](#optional-field-defaults)
- [Brands](#brands)
- [Variants](#variants)
- [Class Schema](#class-schema)
- [Error Handling](#error-handling)
- [Tagged Error Classes (Schema.TaggedError)](#tagged-error-classes-schemataggederror)
- [Codec Operations](#codec-operations)
- [Schema Representation and Codegen](#schema-representation-and-codegen)

Effect Schema describes data shapes, validates

unknown input, and transforms values between formats. Use this reference when touching data models,
DTOs, row schemas, wire contracts, brands, variants, optional fields, decoders, or typed errors.

## Records

Default to `Schema.Struct(...)` plus a same-name `interface`. Reach for `Schema.Class` only when you
need the class ergonomics it provides (see [Class Schema](#class-schema)); avoid it for new data
models.

```ts
import { Schema } from "effect";

export const User = Schema.Struct({
  id: UserId,
  name: Schema.NonEmptyString,
  email: Schema.optionalKey(Schema.String),
});

export interface User extends Schema.Schema.Type<typeof User> {}

const UserArray = Schema.Array(User);
const IdOrEmail = Schema.Union([Schema.Number, Schema.String]);
```

**Type derivation (house rule):**

- For exported **object** models, declare a same-name `interface` that extends `Schema.Schema.Type`:
  `export interface User extends Schema.Schema.Type<typeof User> {}`. The interface name and the
  schema value share one identity, and errors/hover render `User` instead of a structural blob.
- For **unions, brands, and other non-object shapes** an interface cannot extend, derive the type
  with `export type X = typeof X.Type`.

Guidance:

- Add `.annotate({ identifier: "User" })` only when tooling consumes it: HTTP API, RPC, OpenAPI/JSON
  Schema, docs, diagnostics, or codegen.
- Give service tags an `"@app/Name"` id, e.g. `Context.Service<UserRepo>()("@app/UserRepo", ...)`.

**Source:** `effect/Schema.ts` - see `~/Developer/effect/packages/effect/src/Schema.ts`

## Construction

- Use `schema.make(...)` when construction is trusted (input already conforms).
- Use `schema.makeEffect(...)` when construction failure should stay in the Effect error channel.
- Use `schema.makeOption(...)` when validation details are intentionally discarded.
- Pass `{ disableChecks: true }` only when the input is already validated and you are deliberately
  skipping `.check(...)` constraints. Never reach for a type cast to bypass validation — decode or
  construct through the schema instead.

```ts
const user = User.make({ id: 1, name: "Arya", email: "a@example.com" });
const userEff = User.makeEffect({ id: 1, name: "Arya", email: "a@example.com" });
```

## Decode and Validate

Decode and encode with Effect or synchronous APIs. `decodeUnknown*` accepts external data (HTTP/DB);
`decode*` accepts already-typed values.

```ts
import { Effect, Schema } from "effect";

// Boundary input (unknown): HTTP/DB/etc.
const decodeUnknownUser = Schema.decodeUnknownEffect(User);
const result1 = await Effect.runPromise(
  decodeUnknownUser({ id: 1, name: "Arya", email: "a@example.com" }),
);

// Internal typed value
const typedUser = User.make({ id: 1, name: "Arya", email: "a@example.com" });
const result2 = await Effect.runPromise(Schema.decodeEffect(User)(typedUser));
```

**Choosing a decode variant:**

- `Schema.decodeUnknownEffect(...)` is the default at runtime boundaries (HTTP, DB rows, queues,
  provider responses) — failures stay in the Effect error channel.
- `Schema.decodeUnknownSync(...)` only in scripts, tests, or startup/config paths where throwing on
  bad input is acceptable.
- `Schema.decodeUnknownOption(...)` only when mismatch details are intentionally discarded.
- `Schema.decodeUnknownResult(...)` for pure code that wants explicit success/failure without
  Effect.
- `Schema.decodeUnknownExit(...)` for non-throwing `Exit.Success | Exit.Failure`.

```ts
const user = Schema.decodeUnknownSync(User)({ id: 1, name: "Arya", email: "a@example.com" });
// throws Schema.SchemaError on failure

const exit = Schema.decodeUnknownExit(User)({ id: 1, name: "Arya", email: "a@example.com" });
// Exit.Success | Exit.Failure

const option = Schema.decodeUnknownOption(User)({ id: 1, name: "Arya", email: "a@example.com" });
// Option<User>
```

## Assert (runtime validation)

Assert a value directly — do not use the removed `Schema.Codec.ToAsserts` helper:

```ts
import { Schema } from "effect";

const assertUser = (input: unknown): asserts input is User => Schema.asserts(User, input);
```

Throws `Schema.SchemaError` on failure (sync).

## Encode

```ts
const encodeUser = Schema.encodeUnknownEffect(User);
const encoded = await Effect.runPromise(
  encodeUser(User.make({ id: 1, name: "Arya", email: "a@example.com" })),
);
// { id: 1, name: "Arya", email: "a@example.com" }
```

Sync: `Schema.encodeUnknownSync`. Exit: `Schema.encodeUnknownExit`.

**Source:** `effect/Schema.ts` - see `~/Developer/effect/packages/effect/src/Schema.ts`

## JSON Boundary

```ts
import { Schema } from "effect";

// Parse JSON string, then decode against schema
const UserFromJson = Schema.fromJsonString(User);
const decodedEffect = Schema.decodeUnknownEffect(UserFromJson)(
  `{"id":1,"name":"Arya","email":"a@example.com"}`,
);
```

Or pipe style:

```ts
const decodedEffect = Schema.decodeUnknownEffect(Schema.fromJsonString(User))(
  `{"id":1,"name":"Arya","email":"a@example.com"}`,
);
```

## Boundary Cookbook

Prefer the Effect variant at runtime boundaries; reserve the sync variant for startup/config paths.

| Boundary                            | Recommended API                                                        |
| ----------------------------------- | ---------------------------------------------------------------------- |
| HTTP JSON payload (string)          | `Schema.decodeUnknownEffect(Schema.fromJsonString(MySchema))(rawJson)` |
| DB row from driver/ORM (runtime)    | `Schema.decodeUnknownEffect(RowSchema)(rawRow)`                        |
| Query params or request body object | `Schema.decodeUnknownEffect(QueryOrBodySchema)(rawInput)`              |
| Env/config object at startup        | `Schema.decodeUnknownSync(ConfigSchema)(rawConfig)`                    |

`Schema.Json` accepts any JSON value. `Schema.JsonObject` is `Record(String, Json)` and rejects
arrays. Vendored Standard Schema V1 types live at `effect/StandardSchema`. Do not add
`@standard-schema/spec`. Compact binary encoding is `SchemaBinary.toCodec` from `effect/encoding`,
not a Schema combinator. Base64 and hex byte helpers are `effect/encoding/Base64`, `Base64Url`, and
`Hex` (root `Encoding` was removed).

## Let Schema Own Wire Encoding

Use Schema codecs at JSON, HTTP, OpenAPI, and persistence boundaries so domain code can keep
semantic runtime types. Schema is the DTO when the only transformation is wire encoding.

Prefer a Date-backed schema over manually converting every row to an ISO string:

```ts
import { Schema } from "effect";

export const ISODateTime = Schema.DateFromString.annotate({
  identifier: "ISODateTime",
});

export const Entry = Schema.Struct({
  id: Schema.String,
  occurredAt: ISODateTime,
  title: Schema.String,
});

type Entry = typeof Entry.Type;
// occurredAt: Date inside the application
// occurredAt: string at the JSON/OpenAPI boundary
```

When a database projection already matches the public schema shape, return that projection directly:

```ts
const rows: ReadonlyArray<Entry> =
  yield *
  db
    .select({
      id: entries.id,
      occurredAt: entries.occurredAt,
      title: entries.title,
    })
    .from(entries);

return { entries: rows };
```

Do not add a DTO mapper whose only job is `date.toISOString()`. Add a mapper only for real
transformation: renaming fields, nesting child rows, deriving values, redacting private data,
extracting typed metadata, or crossing a non-HTTP boundary such as an AI prompt, export file, log
payload, webhook, or third-party SDK.

```ts
const promptInput = {
  ...entry,
  occurredAt: entry.occurredAt.toISOString(),
};
```

## Optionality and Defaults

```ts
import { Schema } from "effect";

const Profile = Schema.Struct({
  bio: Schema.optional(Schema.String), // key may be missing OR explicitly undefined
  nickname: Schema.optionalKey(Schema.String), // key may be missing; undefined is rejected
});
```

Guidance:

- Use `Schema.optionalKey(...)` for absent JSON/storage keys — the common case.
- Use `Schema.optional(...)` only when explicit `undefined` is genuinely part of the contract.
- Use `Schema.NullOr`, `Schema.UndefinedOr`, or `Schema.NullishOr` only when the nullish value is
  truly part of the **encoded** contract, not for construction convenience.
- `Schema.OptionFromNullishOr(Schema.String, null)` converts null/undefined to `Option`.
- Keep normalized defaulted values as **required** fields and apply defaults in constructors or
  decoding (see [Optional Field Defaults](#optional-field-defaults)). Do not make a domain value
  optional merely so it is easier to construct.

**Source:** `effect/Schema.ts` - see `~/Developer/effect/packages/effect/src/Schema.ts`

## Transformations

Transform between schemas with `decodeTo`:

```ts
import { Schema, SchemaTransformation } from "effect";

const BooleanFromString = Schema.Literals(["on", "off"]).pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (literal) => literal === "on",
      encode: (bool) => (bool ? "on" : "off"),
    }),
  ),
);
```

For transformations that can fail, use `Schema.decodeTo` with `SchemaGetter.transformEffect`:

```ts
import { Effect, Number, Option, Schema, SchemaGetter, SchemaIssue } from "effect";

const NumberFromString = Schema.String.pipe(
  Schema.decodeTo(Schema.Number, {
    decode: SchemaGetter.transformEffect((s) => {
      const n = Number.parse(s);
      if (Option.isNone(n)) {
        return Effect.fail(new SchemaIssue.InvalidValue(undefined, s, { reportInput: true }));
      }
      return Effect.succeed(n.value);
    }),
    encode: SchemaGetter.String(),
  }),
);
```

## Schema constraints and wrappers

Many public APIs accept `Schema.Constraint` rather than the full `Schema.Top` protocol when they
only need a parseable schema. Use `Schema.Constraint` in helper signatures that accept arbitrary
user schemas unless your implementation needs full schema methods.

```ts
import { Schema } from "effect";

export const toWireSchema = <S extends Schema.Constraint>(schema: S) => Schema.toCodecJson(schema);
```

Wrapper helpers such as `Schema.toType`, `Schema.toEncoded`, `Schema.toCodecJson`, and
`Schema.toCodecStringTree` retain their source schema on `.schema`. `Schema.Void` now accepts any
present value and decodes it to `undefined`; use `Schema.Undefined` when the input must be exactly
`undefined`.

## Filters (Constraints)

Attach constraints with `.check(...)`. Filter constructors use the `is` prefix:

```ts
import { Schema } from "effect";

const nonEmptyName = Schema.String.check(Schema.isMinLength(1));
const positiveAge = Schema.Number.check(Schema.isGreaterThan(0));
const trimmedNonEmpty = Schema.Trimmed.check(Schema.isNonEmpty());
```

Filters available: `isMinLength`, `isMaxLength`, `isBetweenLength`, `isGreaterThan`, `isLessThan`,
`isBetween({ minimum, maximum })`, `isInt`, `isMultipleOf`, `isFinite`, `isPattern`,
`isStartingWith`, `isEndingWith`, `isIncluding`, `isUUID`, `isULID`.
`isMinLength`/`isMaxLength`/`isBetweenLength` count UTF-16 code units;
`isMinCodePoints`/`isMaxCodePoints`/`isBetweenCodePoints` count Unicode code points. The subject
comes last in range names (`isBetweenLength`, `isBetweenSize`, `isBetweenProperties`).

**Source:** `effect/Schema.ts` - see `~/Developer/effect/packages/effect/src/Schema.ts`

## Field and Contract Reuse

Reuse fields directly when contracts are semantically related, rather than restating shapes or
building one oversized inheritance-by-schema object.

```ts
import { Schema } from "effect";

export const CreateUserInput = Schema.Struct({
  name: User.fields.name,
  email: User.fields.email,
});

export const StoredUser = User.pipe(
  Schema.fieldsAssign({
    createdAt: Schema.DateTimeUtcFromString,
  }),
);
```

Guidance:

- Use `.fields`, `Schema.fieldsAssign(...)`, and `.mapFields(...)` when contracts are genuinely
  related; keep explicit mapping when behavior, joins, validation, or domain translation is
  involved.
- Use `Schema.encodeKeys(...)` when decoded TypeScript names differ from encoded wire/storage keys
  and renaming is the **only** difference.
- Use `Schema.extendTo(...)` sparingly for decoded-only derived fields (stripped on encode).
- Prefer several small related contracts over one oversized inheritance-by-schema object.

```ts
import { Option, Schema, Struct } from "effect";

// Wire-key rename only: decoded `name` <-> encoded `full_name`
const Wire = User.pipe(Schema.encodeKeys({ name: "full_name" }));

// Structural field maps
const picked = Schema.Struct({ a: Schema.String, b: Schema.Number }).mapFields(Struct.pick(["a"]));
const omitted = Schema.Struct({ a: Schema.String, b: Schema.Number }).mapFields(Struct.omit(["b"]));
const partial = Schema.Struct({ a: Schema.String }).mapFields(Struct.map(Schema.optionalKey));

// Decoded-only derived field
const Person = Schema.Struct({ first: Schema.String, last: Schema.String });
const WithFullName = Person.pipe(
  Schema.extendTo(
    { fullName: Schema.String },
    { fullName: (p) => Option.some(`${p.first} ${p.last}`) },
  ),
);
```

## Optional Field Defaults

```ts
import { Schema } from "effect";

// Default for non-optional fields (decoding only)
const withDefault = Schema.Struct({
  name: Schema.String.pipe(Schema.withDecodingDefault(() => "Anonymous")),
});

// Default for exact optional fields
const withDefaultKey = Schema.Struct({
  name: Schema.optionalKey(Schema.String).pipe(Schema.withDecodingDefaultKey(() => "Anonymous")),
});
```

### Defaults that need services or fail parse

Decoding/constructor defaults accept `Effect.Effect<_, Schema.SchemaError, R>` — not only sync
thunks. A failing default propagates as a normal parse issue on the field path.

```ts
import { Context, Effect, Layer, Schema } from "effect";

class IdGen extends Context.Service<IdGen, { readonly next: () => string }>()("@app/IdGen") {}

const IdGenLive = Layer.succeed(IdGen, { next: () => crypto.randomUUID() });

const Row = Schema.Struct({
  id: Schema.String.pipe(
    Schema.withDecodingDefaultKey(
      Effect.gen(function* () {
        const gen = yield* IdGen;
        return gen.next();
      }),
    ),
  ),
});

// decodeUnknown* now requires R when defaults do
await Effect.runPromise(Schema.decodeUnknownEffect(Row)({}).pipe(Effect.provide(IdGenLive)));
```

Use `withDecodingDefault` when the key may be absent **or** `undefined`; `withDecodingDefaultType*`
when the default is already in decoded `Type` form.

## Brands

- Use constrained branded schemas for scalar IDs and value objects.
- Apply normal schema constraints **before** `Schema.brand(...)` for most code.
- `Schema.brand` is type-only and takes a single concrete string literal (not a union or a widened
  `string`). It adds no runtime check, is not stored in the AST, and is dropped by
  `SchemaRepresentation`; reapply it after rebuilding a schema from a representation. Compose
  distinct brands by applying it repeatedly.

```ts
import { Schema } from "effect";

export const UserId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;
```

- Reach for `Schema.fromBrand(...)` only when the project already models brands with `Brand`
  constructors, or wants the check packaged with the brand constructor.

## Variants

Split by ownership: a `Data.TaggedEnum` for internal control-flow algebras, a Schema-backed variant
at boundaries where the union is decoded, encoded, or persisted.

**Internal control flow — `Data.TaggedEnum`** (constructors, `$is`, exhaustive `$match`; do not add
a Schema solely to obtain these utilities):

```ts
import { Data } from "effect";

type Step = Data.TaggedEnum<{
  Continue: { readonly cursor: number };
  Finished: { readonly count: number };
}>;

export const Step = Data.taggedEnum<Step>();

const next = Step.Continue({ cursor: 10 });
const label = Step.$match(next, {
  Continue: ({ cursor }) => `continue at ${cursor}`,
  Finished: ({ count }) => `finished ${count}`,
});
```

**Boundary variant — `Schema.TaggedUnion`** (when the union needs decoding, encoding, persistence,
wire validation, JSON Schema derivation, or schema composition):

```ts
import { Schema } from "effect";

export const Event = Schema.TaggedUnion({
  Started: { runId: RunId },
  Finished: { runId: RunId, result: Schema.Json },
});

export type Event = typeof Event.Type;

const event = Event.cases.Started.make({ runId });
const label = Event.match(event, {
  Started: ({ runId }) => `started ${runId}`,
  Finished: ({ runId }) => `finished ${runId}`,
});
```

Guidance:

- Use `Schema.TaggedStruct(...)` for an ordinary Effect-owned `_tag` variant (single case, or a
  building block for a union).
- Use `Schema.TaggedUnion(...)` to build a `_tag` discriminated union from scratch; it exposes
  `.cases`, `.guards`, `.isAnyOf`, and `.match`.
- Use `Schema.tag(...)` when an external contract has a custom discriminator field such as `type` or
  `kind`; combine those structs with `Schema.Union([...]).pipe(Schema.toTaggedUnion("type"))` when
  union helpers are needed.
- Use `Schema.tagDefaultOmit(...)` deliberately when the encoded contract omits the discriminant
  (filled on decode/construct, stripped on encode).
- Avoid `Schema.Class` and `Schema.TaggedClass` for new data models.

```ts
import { Schema } from "effect";

// External discriminator on `type`, with union helpers
const Circle = Schema.Struct({ type: Schema.tag("circle"), radius: Schema.Number });
const Square = Schema.Struct({ type: Schema.tag("square"), side: Schema.Number });

export const Shape = Schema.Union([Circle, Square]).pipe(Schema.toTaggedUnion("type"));
export type Shape = typeof Shape.Type;

const area = Shape.match(
  { type: "circle", radius: 5 },
  {
    circle: (c) => Math.PI * c.radius ** 2,
    square: (s) => s.side ** 2,
  },
);
```

## Class Schema

`Schema.Class` and `Schema.TaggedClass` remain available, but prefer `Schema.Struct` + a same-name
interface for new data models (see [Records](#records)). Use a class when you specifically want the
class ergonomics: instance methods/getters, nominal identity, or an existing class hierarchy.

```ts
import { Schema } from "effect";

class User extends Schema.Class<User>("User")({
  id: Schema.Number,
  name: Schema.String.check(Schema.isMinLength(1)),
  email: Schema.String,
  createdAt: Schema.optionalKey(Schema.Date),
}) {}

// Constructor: validates by default
const user = User.make({ id: 1, name: "Arya", email: "a@example.com" });

// Skip validation by passing `disableChecks: true` (use only when input is already trusted)
const raw = User.make({ id: 1, name: "Arya", email: "a@example.com" }, { disableChecks: true });

// Option / Effect variants
const userOpt = User.makeOption({ id: 1, name: "Arya", email: "a@example.com" });
const userEff = User.makeEffect({ id: 1, name: "Arya", email: "a@example.com" });
```

**Source:** `effect/Schema.ts` - see `~/Developer/effect/packages/effect/src/Schema.ts`

## Error Handling

```ts
import { Schema, SchemaIssue } from "effect";

const decode = Schema.decodeUnknownSync(User);

try {
  decode({});
} catch (error) {
  if (Schema.isSchemaError(error) && SchemaIssue.isIssue(error.issue)) {
    const issues = SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues;
    console.error(issues);
  }
}
```

## Tagged Error Classes (Schema.TaggedError)

`Schema.TaggedError` is the explicit class exception for typed Effect errors — use it when errors
need serialization, transport, persistence, or generated API contracts. Map infrastructure failures
into domain-specific tagged errors at service boundaries.

```ts
import { Effect, Schema } from "effect";

export class PersistenceError extends Schema.TaggedError<PersistenceError>()(
  "UserRepo.PersistenceError",
  { cause: Schema.Defect() },
) {}

export class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  userId: UserId,
}) {}
```

Guidance:

- Errors carry domain data: the id or value that failed and the upstream `cause`. Do not add an
  `operation` label; the `Effect.fn("Module.operation")` span already records where it happened.
- Use `Schema.Defect()` for defect-like payloads (`Schema.Defect` is a constructor — call it).
- Use schema unions for public API or transport error surfaces.
- Preserve interruption when catching broad causes at ingress, worker, or stream boundaries.

```ts
import { Effect } from "effect";

const loadUser = Effect.fn("UserRepo.loadUser")(function* (id: UserId) {
  const row = yield* Effect.tryPromise({
    try: () => db.users.find(id),
    catch: (cause) => new PersistenceError({ cause }),
  });
  if (row === undefined) return yield* new UserNotFound({ userId: id });
  return row;
});
```

**Comparison with Data.TaggedError** (still valid for internal errors that never cross a wire):

```ts
// Internal-only tagged error
import { Data } from "effect";
class MyError extends Data.TaggedError("MyError")<{ message: string }> {}

// Schema-backed: validated, serializable, matchable as a tagged union member
import { Schema } from "effect";
class MySchemaError extends Schema.TaggedError<MySchemaError>()("MySchemaError", {
  message: Schema.String,
}) {}
```

**Source:** `effect/Schema.ts` - see `~/Developer/effect/packages/effect/src/Schema.ts`

## Codec Operations

| Operation                      | API                                                      |
| ------------------------------ | -------------------------------------------------------- |
| Decode unknown input           | `Schema.decodeUnknownEffect`, `Schema.decodeUnknownExit` |
| Decode typed input             | `Schema.decodeEffect`, `Schema.decodeExit`               |
| Encode unknown input           | `Schema.encodeUnknownEffect`                             |
| Encode typed input             | `Schema.encodeEffect`                                    |
| Validate the decoded type      | Decode with `Schema.toType(schema)`                      |
| Reveal codec types             | `Schema.revealCodec`                                     |
| Extract type or encoded schema | `Schema.toType`, `Schema.toEncoded`                      |

## Schema Representation and Codegen

`SchemaRepresentation` converts schemas to and from shareable representation documents for code
generation, OpenAPI pipelines, and cross-language contracts. `toRepresentation` and
`toRepresentations` take ASTs (`schema.ast`), not schemas. Convert related schemas together —
`toRepresentations([A.ast, B.ast])` — so shared reference identity survives. They lower the encoded
side by default; pass `SchemaAST.toType(schema.ast)` for the decoded (`Type`) representation.

```ts
import { SchemaAST, SchemaRepresentation } from "effect";

const encoded = SchemaRepresentation.toRepresentations([User.ast, UserArray.ast]);
const decoded = SchemaRepresentation.toRepresentations([
  SchemaAST.toType(User.ast),
  SchemaAST.toType(UserArray.ast),
]);
```

Use `fromJsonSchemaDocument` / `fromJsonSchemaMultiDocument` to import JSON Schema and
`toCodeDocument(...)` to emit TypeScript. JSON Schema import is strict: unsupported keywords throw
instead of being dropped, and references inside a subschema with its own `$id` are rejected. Since
rc.113 the built-in revivers live here, named `SchemaRepresentation.makeReviverDeclaration`,
`makeReviverFilter`, and `makeReviverFilterGroup` (they moved off `Schema`). Persisted
representation documents serialize `Union` settings as `{ options: { mode: "oneOf" | "anyOf" } }`
rather than a top-level `mode`, so migrate stored documents when crossing rc.112.

Partial tagged-union matching is `Schema.TaggedUnion(members).matchOrElse(cases, fallback)`; use it
when only some cases need handling and the fallback receives the narrowed remainder.

</content>
