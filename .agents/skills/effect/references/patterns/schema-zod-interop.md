---
name: schema-zod-interop
description: Effect Schema v4 patterns plus the bridge for incremental Zod→Schema migrations. Covers Schema.Class/TaggedClass/ErrorClass/TaggedErrorClass, withStatics, named refinements, decodeTo/withDecodingDefault/StructWithRest, and the "expose .zod static" pattern for boundaries that still consume Zod.
---

# Schema patterns + Zod interop

When migrating a project from Zod-first to Effect Schema-first, the typical path is:

1. Move domain types, errors, and IDs to Effect Schema.
2. Keep Zod alive at HTTP / tool / CLI boundaries by exposing a derived `.zod` static.
3. Replace those boundaries with Schema-native equivalents (HttpApi, etc.) over time.
4. Delete the bridge once nothing imports `.zod` anymore.

This doc covers the Schema-side patterns plus the bridge pattern.

**Sources:**
- `~/Developer/effect/migration/schema.md` — Schema v4 migration guide
- `~/Developer/effect/packages/effect/src/Schema.ts` — all Schema APIs
- `~/Developer/effect/packages/effect/src/unstable/httpapi/HttpApiError.ts:30` — canonical `Schema.ErrorClass` with `httpApiStatus`
- opencode's `effect-zod` walker (worked example) at `~/Developer/opencode/packages/core/src/effect-zod.ts`

## Data classes — `Schema.Class`

`Schema.Class<Self>("Identifier")(fields)` (Schema.ts:10663) defines a structured value type that's both a schema and a JS class.

```ts
import { Schema } from "effect"

export class User extends Schema.Class<User>("User")({
  id: Schema.String.pipe(Schema.brand("UserID")),
  name: Schema.String,
  email: Schema.String.pipe(Schema.check(Schema.isPattern(/^.+@.+$/))),
  enabled: Schema.Boolean,
}) {}

const u = new User({ id: "abc", name: "Ada", email: "ada@example.com", enabled: true })
//        ^ User instance, validated at construction
```

The class is the schema:

```ts
const decoded: User = yield* Schema.decodeUnknownEffect(User)(rawJson)
```

Note v4 ordering vs v3: identifier is the first call, fields are the second. This differs from v3's `Schema.Class<Self>(struct)` shape.

## Tagged variants — `Schema.TaggedClass` / `TaggedErrorClass`

For tagged unions and tagged errors, use the `Tagged*` variants, which auto-add a `_tag` literal field.

```ts
// Tagged union member (Schema.ts:10718)
export class Circle extends Schema.TaggedClass<Circle>()("Circle", {
  radius: Schema.Number,
}) {}

// Yieldable tagged error (Schema.ts:10829)
export class NotFound extends Schema.TaggedErrorClass<NotFound>()("NotFound", {
  id: Schema.String,
}) {}

// Yields directly into Effect's failure channel
const program = Effect.gen(function* () {
  yield* new NotFound({ id: "user-42" })
})
```

The `_tag: "NotFound"` field is added automatically. The class extends `Cause.YieldableError` so `yield* new NotFound({...})` is equivalent to `Effect.fail(new NotFound({...}))`.

The optional first argument is the schema identifier (defaults to the tag value). Only override it when two error classes share the same `_tag` but live in different namespaces.

## HTTP-aware errors — `Schema.ErrorClass` with `httpApiStatus`

For typed errors that flow through `HttpApi` endpoints, use `Schema.ErrorClass` and tag the schema annotation with `httpApiStatus`. The HttpApi runtime will use this status when the error is the result of an endpoint handler.

```ts
// HttpApiError.ts pattern — built-in errors do exactly this
export class NotFoundError extends Schema.ErrorClass<NotFoundError>("@scope/NotFoundError")(
  {
    _tag: Schema.tag("NotFoundError"),
    message: Schema.String,
  },
  {
    description: "Resource not found",
    httpApiStatus: 404,
  },
) {}
```

When an endpoint declares `error: [NotFoundError]`, an Effect that fails with `new NotFoundError({...})` automatically becomes a 404 response with the error body.

## Two-step `withStatics` for self-referential statics

`Schema.Class` body can't easily reference the class during initialization. When you need a static derived from the schema (`zod`, `make`, etc.), use the two-step pattern:

```ts
import { Schema } from "effect"

const withStatics =
  <S extends object, M extends Record<string, unknown>>(methods: (schema: S) => M) =>
  (schema: S): S & M =>
    Object.assign(schema, methods(schema))

// Useful for non-class schemas
export const ProviderID = Schema.String.pipe(
  Schema.brand("ProviderID"),
  withStatics((s) => ({
    zod: zod(s),
    anthropic: s.make("anthropic"),
    openai: s.make("openai"),
  })),
)

ProviderID.anthropic    // "anthropic" branded as ProviderID
ProviderID.zod          // a derived Zod schema
```

For `Schema.Class`, just put the static in the class body — `this` resolves to the class:

```ts
export class Info extends Schema.Class<Info>("FooInfo")({
  id: FooID,
  name: Schema.String,
}) {
  static readonly zod = zod(this)
}
```

## Named refinements

Don't re-spell the same checks everywhere. Define named refinements once.

```ts
import { Schema } from "effect"

export const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))
export const Slug = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/))
```

V4 changes vs v3:

- **`Schema.Int`** is a pre-composed value (`Schema.Number.check(Schema.isInt())`). It's not a separate refinement type.
- **`Schema.check(...)`** attaches filters; v3's `Schema.filter` is gone.
- Filters live as functions: `Schema.isInt()`, `Schema.isPattern(regex)`, `Schema.isStartsWith("prefix")`, `Schema.isUUID()`, `Schema.isFinite()`, `Schema.isGreaterThan(n)`, `Schema.isGreaterThanOrEqualTo(n)`, `Schema.isLessThan(n)`, `Schema.isMultipleOf(n)`, `Schema.isMinLength(n)`, `Schema.isMaxLength(n)`, `Schema.isLengthBetween(a, b)`, `Schema.isIncludes("substr")`, `Schema.isEndsWith("suffix")`, `Schema.isBase64()`, `Schema.isBase64Url()`, `Schema.isULID()`. (Schema.ts:5100–6000)
- Brand → `Schema.brand("Tag")` chained via `.pipe(...)`.

## v4 transformation idioms

### `Schema.decodeTo` (replaces v3 `Schema.transform`)

```ts
const TimestampMillis = Schema.String.pipe(
  Schema.decodeTo(Schema.Number, {
    decode: SchemaGetter.transform((s: string) => Date.parse(s)),
    encode: SchemaGetter.transform((n: number) => new Date(n).toISOString()),
  }),
)
```

Schema.ts:4084. Takes explicit `{ decode, encode }`. Chained `decodeTo` calls compose into a single transformation pipeline.

### `Schema.withDecodingDefault`

```ts
const Settings = Schema.Struct({
  timeout: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(() => 30_000)),
  retries: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(() => 3)),
})

// Decoding {} → { timeout: 30_000, retries: 3 }
```

Schema.ts:4464. The factory passed to `withDecodingDefault` is invoked when the field is absent during decode.

### `Schema.StructWithRest`

For "object with these fields plus arbitrary extras":

```ts
const PluginConfig = Schema.StructWithRest(
  Schema.Struct({
    name: Schema.String,
    enabled: Schema.Boolean,
  }),
  [Schema.Record(Schema.String, Schema.Unknown)], // extras
)
```

Schema.ts:2902. The Zod equivalent is `.catchall(...)`.

## The Zod-bridge pattern (during migration)

When a Zod-first project moves to Effect Schema, you usually can't flip every boundary at once. Common boundaries that still want Zod:

- HTTP route validators (Hono, oRPC, tRPC, Express middleware)
- AI tool parameters (Zod is the de-facto standard for `function_call` schemas)
- CLI argument parsers (Commander, yargs validators)
- Config-file parsers using `zod-to-json-schema`

The pattern: **Schema is source of truth; `.zod` is a derived view.**

```ts
// Domain — Schema-first
export class Info extends Schema.Class<Info>("MyDomain.Info")({
  id: Schema.String.pipe(Schema.brand("InfoID")),
  count: Schema.Int.check(Schema.isGreaterThan(0)),
  pattern: Schema.String.check(Schema.isPattern(/^abc/)),
}) {
  static readonly zod = zod(this)   // derived
}

// Boundary — still Zod
app.post(
  "/info",
  zValidator("json", Info.zod),     // Hono v4 example
  async (c) => {
    const body = c.req.valid("json")  // typed via the .zod type
    // ...
  },
)
```

The `zod()` function is a walker that traverses the Effect Schema AST and produces a structurally-equivalent Zod schema. opencode publishes one such walker at `@opencode-ai/core/effect-zod` — its key features generalize to any project's bridge:

```ts
// Walker contract
export const zod: <S extends Schema.Top>(schema: S) => z.ZodType<Schema.Schema.Type<S>>
export const zodObject: <S extends Schema.Top>(schema: S) => z.ZodObject<any>
export const toJsonSchema: <S extends Schema.Top>(schema: S) => unknown
```

Implementation considerations if you write your own:

1. **Memoize by AST node identity** — `WeakMap<SchemaAST.AST, z.ZodTypeAny>`. Without this, shared subtrees (e.g. a `Schema.Class` embedded in multiple parents) get re-walked and re-instantiated.
2. **Translate named refinements to native Zod** — `Schema.isInt()` → `z.number().int()`, `Schema.isPattern(re)` → `z.string().regex(re)`, etc. The well-known filters expose `meta._tag` for dispatch.
3. **Don't apply class-construction transforms** — `Schema.Class` registers a Declaration with constructor encoding. The walker must skip that and treat the class as its underlying `Struct` so `zod.parse()` returns plain objects, not class instances.
4. **`Schema.optional` + `withDecodingDefault`** — translate to `.optional().default(v)` to preserve JSON Schema output.
5. **Provide an escape hatch** — a unique symbol annotation (`ZodOverride`) lets a schema attach a hand-crafted Zod schema for nodes the walker can't translate cleanly.

The opencode walker is a good reference for this if you need to write one.

### Compatibility rule

- Effect Schema is the source of truth. Hand-written Zod schemas are temporarily acceptable during migration but should be replaced by `.zod`-derived ones.
- Once a boundary has switched to Schema-native validation (e.g. `HttpApi`), drop `.zod` from the schemas it consumed.
- The walker module itself is "do not migrate" — it stays Zod-importing forever and is deleted only when no `.zod` static remains anywhere.

## Quick decision table

| Need | Schema construct |
|------|------------------|
| Plain data class | `Schema.Class<Self>("Id")(fields)` |
| Discriminated union member | `Schema.TaggedClass<Self>()("Tag", fields)` |
| Yieldable error | `Schema.ErrorClass<Self>("Id")(fields)` |
| Yieldable tagged error | `Schema.TaggedErrorClass<Self>()("Tag", fields)` |
| HttpApi-aware error | `Schema.ErrorClass<Self>("Id")(fields, { httpApiStatus: N })` |
| Branded ID | `Schema.String.pipe(Schema.brand("Tag"))` |
| Refined number | `Schema.Int.check(Schema.isGreaterThan(0))` |
| Pattern-matched string | `Schema.String.check(Schema.isPattern(re))` |
| Optional with default | `Schema.optional(S).pipe(Schema.withDecodingDefault(() => v))` |
| Object + arbitrary extras | `Schema.StructWithRest(struct, [Schema.Record(k, v)])` |
| Bidirectional transform | `S.pipe(Schema.decodeTo(T, { decode, encode }))` |
| Static `make` / `zod` on schema value | `withStatics((s) => ({ ... }))` |

## Pitfalls

### `Schema.Class` instances vs decoded objects

`Schema.decodeUnknownEffect(MyClass)(json)` returns an instance of `MyClass`, not a plain object. Code that does `JSON.stringify(decoded)` is fine, but `Object.keys(decoded)` includes inherited statics on some engines. If you're round-tripping through Zod via the walker, the walker should NOT use Effect's class-construction encoding — Zod must produce plain objects to match what `z.parse()` typically returns.

### Forgetting `<Self>` causes opaque errors

```ts
// ❌ Without the <Self> type param, you get MissingSelfGeneric
class Info extends Schema.Class("Info")({ ... }) {}

// ✅
class Info extends Schema.Class<Info>("Info")({ ... }) {}
```

The same applies to `TaggedClass`, `ErrorClass`, `TaggedErrorClass`.

### `Schema.optional` produces nullable in OpenAPI

When a schema with `Schema.optional(T)` flows through `OpenApi.fromApi`, the output is `anyOf: [T, { type: "null" }]`. Some legacy SDK generators expect bare `T`. If you need to strip the null arm, use an `OpenApi.annotations({ transform })` post-processor at the API root — see the HttpApi reference.

### `Schema.tag` vs `_tag` literal

Inside `Schema.TaggedClass` / `Schema.TaggedErrorClass`, the `_tag` field is added for you. If you're hand-rolling `Schema.ErrorClass`, use `Schema.tag("BadRequest")` instead of `Schema.Literal("BadRequest")` so the field shows up correctly in the discriminated-union machinery.

## Related

- `references/schema/schema.md` — full Schema reference
- `references/data-types/data.md` — `TaggedEnum` / `TaggedClass` / `TaggedError` (the `Data` family is for non-Schema tagged types)
- `references/ecosystem/httpapi.md` — Schema-driven HTTP APIs
- `references/patterns/service-effectification.md` — Schema in service interfaces
