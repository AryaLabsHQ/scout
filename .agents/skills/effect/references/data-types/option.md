# Option

`Option<A>` models presence (`Some`) or absence (`None`) without throwing.

## Basics

```ts
import { Option } from "effect"

const some = Option.some(1)
const none = Option.none<number>()

const fromNullable = Option.fromNullishOr("value")
const fromUndefined = Option.fromUndefinedOr("value")
```

**Source:** `effect/Option.ts` - see `~/Developer/effect/packages/effect/src/Option.ts`

## Transform

```ts
import { Option } from "effect"

const result = Option.flatMap(Option.some(2), (n) => (n > 0 ? Option.some(n) : Option.none()))

const chained = Option.andThen(Option.some(5), (x) => Option.some(x * 2))
// Option.some(10)
```

## Consume

```ts
import { Option } from "effect"

const value = Option.getOrElse(Option.none<number>(), () => 0)
// 0

const text = Option.match(Option.some("x"), {
  onNone: () => "none",
  onSome: (v) => `some:${v}`
})
// "some:x"

const forced = Option.getOrThrow(Option.none())
// throws Error("getOrThrow called on a None")

const forcedWith = Option.getOrThrowWith(Option.none(), () => new Error("missing"))
// throws Error("missing")
```

**Source:** `effect/Option.ts` - see `~/Developer/effect/packages/effect/src/Option.ts`

## v4-specific Notes

- `fromNullishOr` treats both `null` and `undefined` as `None`; takes a plain value and returns `Option<NonNullable<A>>`. Example: `const fromNullable = Option.fromNullishOr("value")` — TypeScript infers the type from the argument, no type parameter needed.
- `fromUndefinedOr` treats only `undefined` as `None`; `null` is valid
- `Option.void` is a pre-allocated `Some(undefined)` singleton
- `tap` runs a side effect without modifying the value
- `flatten` unwraps a nested `Option<Option<A>>`
- `all` works with tuples, structs, and iterables: `Option.all([opt1, opt2])` or `Option.all({ a: opt1, b: opt2 })`

## Common APIs

**Creation**: `Option.some`, `Option.none`, `Option.fromNullishOr`, `Option.fromIterable`, `Option.fromUndefinedOr`
**Transform**: `Option.map`, `Option.flatMap`, `Option.andThen`, `Option.as`, `Option.asVoid`, `Option.tap`, `Option.flatten`
**Consume**: `Option.getOrElse`, `Option.getOrNull`, `Option.getOrUndefined`, `Option.getOrThrow`, `Option.getOrThrowWith`, `Option.match`
**Result interop** (operate on `Result<A, E>`, return `Option`): `Option.getSuccess`, `Option.getFailure`
**Error handling**: `Option.orElse`, `Option.orElseSome`, `Option.firstSomeOf`
**Filtering**: `Option.filter`, `Option.filterMap`, `Option.exists`
**Combining**: `Option.all`, `Option.zipWith`, `Option.zipRight`, `Option.zipLeft`, `Option.product`, `Option.makeEquivalence`, `Option.makeOrder`
**Checks**: `Option.isSome`, `Option.isNone`, `Option.isOption`, `Option.contains`
**Iteration**: `Option.toArray`, `Option.bindTo`
**Reduction**: `Option.makeReducer`, `Option.makeReducerFailFast`, `Option.makeCombinerFailFast`
