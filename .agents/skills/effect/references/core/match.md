# Match

## Table of Contents

- [Decision Tree](#decision-tree)
- [Type-Driven Matcher (Most Common)](#type-driven-matcher-most-common)
- [Selector matchers (`Match.fn`)](#selector-matchers-matchfn)
- [Tagged-Union Matchers](#tagged-union-matchers)
- [Predicate Refinements](#predicate-refinements)
- [Object Patterns](#object-patterns)
- [Combining Patterns](#combining-patterns)
- [Custom Discriminators](#custom-discriminators)
- [Closing the Matcher](#closing-the-matcher)
- [Pinning the Return Type](#pinning-the-return-type)
- [Common Pitfalls](#common-pitfalls)
- [See Also](#see-also)

**Source:** `effect/Match.ts` - see

`~/Developer/effect/packages/effect/src/Match.ts`

Pattern matching with exhaustiveness checking. Two flavors:

- **Type-driven** (`Match.type<I>()`) — build a reusable matcher function `(input: I) => Result`.
  Compile once, apply many times.
- **Value-driven** (`Match.value(input)`) — match a specific value inline.

For tagged unions, `Match.valueTags` and `Match.typeTags` are shorthand for the common case.

## Decision Tree

```
What do I have?
├─ A union type, want a reusable matcher        → Match.type<I>()
├─ A specific value, match once                 → Match.value(input)
├─ Extra args around the matched value          → Match.fn((a, b) => b)
├─ A tagged union value, match once             → Match.valueTags(input, { Tag: handler })
└─ A tagged union type, want a reusable matcher → Match.typeTags<I>()({ Tag: handler })

What's my pattern?
├─ Predicate / refinement → Match.when(Match.string, fn) / Match.when(Match.number, fn) / ...
├─ Object with field constraints → Match.when({ name: "John" }, fn)
├─ Tagged-union _tag value → Match.tag("MyTag", fn)
├─ _tag prefix → Match.tagStartsWith("Auth.", fn)
├─ Multiple tags at once → Match.tags({ TagA: fn, TagB: fn })
├─ Discriminator on custom field → Match.discriminator("kind")(...)
└─ All of the above with multiple alternatives → Match.whenOr(...) / Match.whenAnd(...)

How do I close the matcher?
├─ All cases handled, want compile-time exhaustiveness → Match.exhaustive
├─ Need a fallback for unmatched cases → Match.orElse((input) => fallback)
├─ Should never happen, throw if it does → Match.orElseAbsurd
├─ Wrap result in Option → Match.option
└─ Wrap result in Result (Success=match, Failure=miss) → Match.result
```

## Type-Driven Matcher (Most Common)

`Match.type<I>()` builds a `(input: I) => Result`. Pipe through `when`/`tag` cases, end with
`exhaustive` or `orElse`.

```ts
import { Match } from "effect";

const formatNumOrString = Match.type<string | number>().pipe(
  Match.when(Match.number, (n) => `number: ${n}`),
  Match.when(Match.string, (s) => `string: ${s}`),
  Match.exhaustive,
);

formatNumOrString(42); // "number: 42"
formatNumOrString("hi"); // "string: hi"
```

`Match.exhaustive` is a compile-time guarantee — if you forget a case, TypeScript errors.

## Selector matchers (`Match.fn`)

When the value to match is not the first argument, `Match.fn(select)` keeps the original argument
list. Handlers receive the narrowed selected value first, then those arguments.

```ts
import { Match } from "effect";

const format = Match.fn((prefix: string, value: "a" | "b") => value).pipe(
  Match.when("a", (_value, prefix) => `${prefix}: A`),
  Match.when("b", (_value, prefix) => `${prefix}: B`),
  Match.exhaustive,
);

format("status", "a"); // "status: A"
```

## Tagged-Union Matchers

Most common scenario: matching on `_tag`. Two equivalent forms.

### Compact: `Match.valueTags` / `Match.typeTags`

```ts
import { Match } from "effect";

type Result =
  | { readonly _tag: "Success"; readonly data: string }
  | { readonly _tag: "Error"; readonly message: string }
  | { readonly _tag: "Loading" };

// One-shot match on a value
const message = Match.valueTags(result, {
  Success: (r) => `ok: ${r.data}`,
  Error: (r) => `err: ${r.message}`,
  Loading: () => "loading",
});

// Reusable matcher
const formatResult = Match.typeTags<Result>()({
  Success: (r) => `ok: ${r.data}`,
  Error: (r) => `err: ${r.message}`,
  Loading: () => "loading",
});

formatResult(someResult);
```

`typeTags<I, Ret>()({...})` lets you pin the return type. Without it, the return type is inferred as
the union of every handler's return.

### Pipe form: `Match.tag` / `Match.tags`

When you need extra logic between cases (filters, refinements):

```ts
const formatResult = Match.type<Result>().pipe(
  Match.tag("Success", (r) => `ok: ${r.data}`),
  Match.tag("Error", (r) => `err: ${r.message}`),
  Match.tag("Loading", () => "loading"),
  Match.exhaustive,
);
```

`Match.tags({ TagA: fn, TagB: fn })` handles multiple tags in one call.

`Match.tagsExhaustive({ ... })` is the same plus the exhaustiveness check baked in — no separate
`Match.exhaustive` needed.

`Match.tagStartsWith("Auth.")` matches any `_tag` that starts with the prefix (useful for namespaced
tags like `"Auth.LoginFailed"`).

## Predicate Refinements

`Match.when` accepts a refinement (`x is T`), a predicate (`(x) => boolean`), or a literal
value/object pattern.

```ts
import { Match, Predicate } from "effect";

const describe = Match.type<unknown>().pipe(
  Match.when(Match.string, (s) => `string: ${s}`),
  Match.when(Match.number, (n) => `number: ${n}`),
  Match.when(Match.boolean, (b) => `boolean: ${b}`),
  Match.when(Match.bigint, (b) => `bigint: ${b}`),
  Match.when(Match.symbol, (s) => `symbol: ${String(s)}`),
  Match.when(Match.date, (d) => `date: ${d.toISOString()}`),
  Match.when(Match.record, (r) => `record: ${JSON.stringify(r)}`),
  Match.when(Match.defined, (x) => `defined: ${String(x)}`), // not null/undefined
  Match.orElse(() => "unknown"),
);
```

Built-in refinements: `Match.string`, `number`, `boolean`, `bigint`, `symbol`, `date`, `record`,
`any`, `defined`, `nonEmptyString`, `instanceOf(Class)`, `is(...literals)`, `not(refinement)`.

`Match.is("a", "b", "c")` matches any of the listed literals.

## Object Patterns

Match against object shape — values are literals, predicates, or nested patterns.

```ts
const greet = Match.type<{ name: string; age: number }>().pipe(
  Match.when({ age: 18 }, () => "you can vote"),
  Match.when({ age: (n: number) => n > 18 }, (u) => `adult: ${u.name}`),
  Match.when({ age: (n: number) => n < 13 }, () => "kid"),
  Match.orElse((u) => `${u.age}: ${u.name}`),
);
```

## Combining Patterns

```ts
import { Match } from "effect";

// Match if ANY of the patterns hit
Match.whenOr(Match.string, Match.number, (sn) => `prim: ${sn}`);

// Match if ALL of the patterns hit
Match.whenAnd(Match.record, { name: Match.nonEmptyString }, (x) => `named record: ${x.name}`);

// Negate
Match.when(Match.not(Match.string), (x) => `not a string: ${String(x)}`);
```

## Custom Discriminators

When the discriminator field isn't `_tag`:

```ts
import { Match } from "effect";

type Event = { kind: "click"; x: number; y: number } | { kind: "key"; code: string };

const formatEvent = Match.type<Event>().pipe(
  Match.discriminator("kind")("click", (e) => `click@${e.x},${e.y}`),
  Match.discriminator("kind")("key", (e) => e.code),
  Match.exhaustive,
);

// Or all at once:
const formatEvent2 = Match.type<Event>().pipe(
  Match.discriminatorsExhaustive("kind")({
    click: (e) => `click@${e.x},${e.y}`,
    key: (e) => e.code,
  }),
);
```

`Match.discriminatorStartsWith("kind")("Auth.", fn)` for prefix matching.

## Closing the Matcher

| Closer                   | Behavior                                                             | Type at end                     |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------- |
| `Match.exhaustive`       | Compile-time check that every case is handled                        | `(input: I) => Ret`             |
| `Match.orElse(fallback)` | Runtime fallback for unmatched                                       | `(input: I) => Ret \| Fallback` |
| `Match.orElseAbsurd`     | Throw at runtime if unmatched (use sparingly)                        | `(input: I) => Ret`             |
| `Match.option`           | Wrap match result in `Option`                                        | `(input: I) => Option<Ret>`     |
| `Match.result`           | Wrap match result in `Result` (Success=hit, Failure=miss-with-input) | `(input: I) => Result<Ret, I>`  |

```ts
const tryParse = Match.type<string>().pipe(
  Match.when(
    (s: string) => /^\d+$/.test(s),
    (s) => parseInt(s, 10),
  ),
  Match.option,
);
// tryParse: (input: string) => Option<number>
```

## Pinning the Return Type

`Match.withReturnType<Ret>()` constrains every handler to produce `Ret`:

```ts
const formatStatus = Match.type<Status>().pipe(
  Match.withReturnType<string>(),
  Match.tag("Ok", () => "ok"),
  Match.tag("Err", (e) => e.message),
  Match.exhaustive,
);
```

Useful when handlers return literals that would otherwise widen the inferred return.

## Common Pitfalls

- **Forgetting to call the matcher.** `Match.type<I>().pipe(...).exhaustive` returns a function. You
  still need to invoke it: `formatResult(value)`.
- **`Match.exhaustive` vs `Match.tagsExhaustive`.** The first is a closer at the end of a pipe; the
  second is a single call that handles tags + closure together. Don't combine them.
- **`Match.orElseAbsurd` is not `assertNever`.** It throws at runtime; the type system can't verify
  exhaustiveness. Use `Match.exhaustive` when you want compile-time enforcement.
- **`Match.value(x)` inside a hot loop is fine** — pattern matching has minimal overhead, but if the
  matcher is reused, prefer `Match.type<I>()` and apply repeatedly.

## See Also

- [Error Handling](./error-handling.md) — `Effect.catchTag` is `Match.tag` for the error channel
- [Data](../data-types/data.md) — `Data.TaggedEnum` produces unions that pair well with
  `Match.valueTags`
