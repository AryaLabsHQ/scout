# Data

## Table of Contents

- [Decision Tree](#decision-tree)
- [`Data.Class` — plain immutable class](#dataclass--plain-immutable-class)
- [`Data.TaggedClass` — auto-tagged class](#datataggedclass--auto-tagged-class)
- [`Data.TaggedEnum` + `Data.taggedEnum` — discriminated unions](#datataggedenum--datataggedenum--discriminated-unions)
- [`Data.Error` — yieldable error class](#dataerror--yieldable-error-class)
- [`Data.TaggedError` — yieldable + tagged](#datataggederror--yieldable--tagged)
- [Common patterns](#common-patterns)
- [When to use which](#when-to-use-which)
- [Pitfalls](#pitfalls)
- [See Also](#see-also)

**Source:** `effect/Data.ts` - see

`~/Developer/effect/packages/effect/src/Data.ts` **Source:** `effect/Cause.ts` (`YieldableError`) -
see `~/Developer/effect/packages/effect/src/Cause.ts`

Immutable value constructors with `_tag` discriminators and structural equality. The module exposes
five primitives:

| Primitive                                         | Purpose                                                                            | Yieldable as Effect failure?                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `Data.Class<A>`                                   | Plain immutable data class                                                         | No                                                     |
| `Data.TaggedClass(tag)`                           | Class with auto-added `_tag` field                                                 | No                                                     |
| `Data.TaggedEnum<{...}>` + `Data.taggedEnum<E>()` | Discriminated union (object-based, not class) with constructors + `$is` + `$match` | No (use `TaggedError` for errors)                      |
| `Data.Error<A>`                                   | Class extending `Cause.YieldableError`                                             | **Yes** — `yield* new MyError(...)` fails the effect   |
| `Data.TaggedError(tag)`                           | `_tag` + yieldable error                                                           | **Yes**, with tag discrimination via `Effect.catchTag` |

> For value equality on plain records use `Data.Class` (or `Schema.Class`); for one-off tagged
> objects, prefer `Data.TaggedClass` or `Data.taggedEnum`.

## Decision Tree

```
What do I need?
├─ Plain immutable data class                    → Data.Class<Shape>
├─ Single tagged class                           → Data.TaggedClass("Tag")<Shape>
├─ Multi-variant discriminated union with        → Data.TaggedEnum<{...}> + Data.taggedEnum<E>()
│  constructors + match + type-guards
├─ Error class (yieldable, no tag)               → Data.Error<Shape>
├─ Error class with _tag (yieldable, catchable)  → Data.TaggedError("Tag")<Shape>
└─ Schema-validated tagged error                 → Schema.TaggedError<Self>()(...)  (different module)
```

## `Data.Class` — plain immutable class

```ts
import { Data, Equal } from "effect";

class User extends Data.Class<{
  readonly id: string;
  readonly name: string;
}> {}

const a = new User({ id: "1", name: "Arya" });
const b = new User({ id: "1", name: "Arya" });

Equal.equals(a, b); // true — structural equality
```

When a class has no fields, the constructor argument is optional:

```ts
class Sentinel extends Data.Class<{}> {}
const s = new Sentinel();
```

Instances are `Pipeable`, so you can `.pipe(...)` on them.

## `Data.TaggedClass` — auto-tagged class

Adds a `readonly _tag: Tag` field; the tag is excluded from constructor args.

```ts
class Click extends Data.TaggedClass("Click")<{
  readonly x: number;
  readonly y: number;
}> {}

const c = new Click({ x: 10, y: 20 });
c._tag; // "Click"
```

Use for single-variant types or ad-hoc discriminators.

## `Data.TaggedEnum` + `Data.taggedEnum` — discriminated unions

The recommended pattern for ADTs. Define the union as a record-of-variants type, then call
`taggedEnum<E>()` to get constructors and helpers.

```ts
import { Data } from "effect";

type Shape = Data.TaggedEnum<{
  Circle: { readonly radius: number };
  Rect: { readonly width: number; readonly height: number };
}>;

const { Circle, Rect, $is, $match } = Data.taggedEnum<Shape>();

const c = Circle({ radius: 5 });
// c: { readonly _tag: "Circle"; readonly radius: number }

// Type guard
$is("Circle")(c); // true

// Pattern match (curried form for reuse)
const area = $match({
  Circle: ({ radius }) => Math.PI * radius ** 2,
  Rect: ({ width, height }) => width * height,
});

area(c); // 78.539...
```

`$match` also has a direct form: `$match(value, { Circle: ..., Rect: ... })`.

**Variants are plain objects, not class instances.** If you need methods or `instanceof` checks, use
`TaggedClass` per variant instead.

**Do not include `_tag` in the variant record** — the key (`Circle`, `Rect`) becomes the tag
automatically.

### Generic tagged enums

`taggedEnum` supports up to 4 generic type parameters via `TaggedEnum.WithGenerics`:

```ts
type MyResult<E, A> = Data.TaggedEnum<{
  Failure: { readonly error: E };
  Success: { readonly value: A };
}>;

interface MyResultDef extends Data.TaggedEnum.WithGenerics<2> {
  readonly taggedEnum: MyResult<this["A"], this["B"]>;
}

const { Failure, Success } = Data.taggedEnum<MyResultDef>();

const ok = Success({ value: 42 });
// ok: { _tag: "Success"; value: number }
```

## `Data.Error` — yieldable error class

Like `Data.Class`, but extends `Cause.YieldableError` so instances can be `yield*`-ed inside
`Effect.gen` to fail the effect.

```ts
import { Data, Effect } from "effect";

class NotFound extends Data.Error<{
  readonly resource: string;
  readonly id: string;
}> {}

const program = Effect.gen(function* () {
  yield* new NotFound({ resource: "user", id: "42" });
});
// program: Effect<never, NotFound>
```

No `_tag`, so `Effect.catchTag` won't work — use `Effect.catch` and a runtime check, or prefer
`TaggedError` below.

## `Data.TaggedError` — yieldable + tagged

The most-used error pattern. Tag-based recovery via `Effect.catchTag`:

```ts
import { Data, Effect } from "effect";

class NotFound extends Data.TaggedError("NotFound")<{
  readonly resource: string;
  readonly id: string;
}> {}

class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string;
}> {}

const program: Effect.Effect<never, NotFound | ValidationError> = Effect.gen(function* () {
  yield* new NotFound({ resource: "user", id: "42" });
});

const recovered = program.pipe(
  Effect.catchTag("NotFound", (e) => Effect.succeed(`missing ${e.resource}: ${e.id}`)),
);
// recovered: Effect<string, ValidationError>
```

Compare with `Schema.TaggedError` (in `Schema.ts`) — that adds runtime schema validation and
serialization on top. Use `Data.TaggedError` for errors that don't need to cross a serialization
boundary.

## Common patterns

### Pair `taggedEnum` with `Match`

```ts
import { Data, Match } from "effect";

type Status = Data.TaggedEnum<{
  Idle: {};
  Loading: { readonly progress: number };
  Done: { readonly result: string };
  Failed: { readonly error: string };
}>;

const { $match } = Data.taggedEnum<Status>();

// Either built-in $match…
const summary = $match({
  Idle: () => "waiting",
  Loading: ({ progress }) => `${progress}%`,
  Done: ({ result }) => `done: ${result}`,
  Failed: ({ error }) => `error: ${error}`,
});

// …or use Match for richer patterns:
const isActive = Match.type<Status>().pipe(
  Match.tags({
    Loading: () => true,
    Idle: () => false,
    Done: () => false,
    Failed: () => false,
  }),
  Match.exhaustive,
);
```

### Equality

`Data.Class` / `TaggedClass` instances support `Equal.equals` out of the box (structural).
`taggedEnum` variants are plain objects — they're equal by structural comparison, but `Equal.equals`
won't add deep-equality on its own. If you need that, wrap fields in another `Data.Class` or use
`Schema.Class`.

## When to use which

| Use case                                 | Pick                                  |
| ---------------------------------------- | ------------------------------------- |
| Domain entity with optional methods      | `Data.Class` or `Schema.Class`        |
| ADT with 2–N variants, no methods        | `Data.TaggedEnum` + `Data.taggedEnum` |
| Tagged single-variant value              | `Data.TaggedClass`                    |
| Domain error, no serialization needed    | `Data.TaggedError`                    |
| Domain error, serializable / wire-format | `Schema.TaggedError<Self>()`          |
| Generic ADT (e.g. `Result<E, A>`)        | `Data.TaggedEnum.WithGenerics<N>`     |

## Pitfalls

- `Data.taggedEnum` variants are **plain objects**, not class instances. `instanceof Click` won't
  work; use `$is("Click")(value)` instead.
- `_tag` must not appear in the variant record passed to `Data.TaggedEnum<{...}>` — the key is the
  tag.
- `WithGenerics` caps at 4 type parameters. If you need more, restructure or fall back to manual
  class hierarchy.
- `Data.Error` is yieldable but not catchable by tag. Use `Data.TaggedError` unless you have a
  specific reason.

## See Also

- [Error Handling](../core/error-handling.md) — comparison with `Schema.TaggedError` and recovery
  patterns
- [Match](../core/match.md) — `Match.valueTags` / `Match.typeTags` for pattern matching
- [Schema](../schema/schema.md) — `Schema.Class` for runtime-validated classes, `Schema.TaggedError`
  for serializable errors
