# Result

`Result<A, E>` is a pure data type for success (`Success`) / failure (`Failure`). Use it when the
computation is already complete and you want to pass a success-or-failure value without an Effect
runtime. An Effect that cannot fail is `Effect<A>`, not `Result`.

`Success` wraps a value, `Failure` wraps an error.

## Basics

```ts
import { Result } from "effect";

const right = Result.succeed(123);
const left = Result.fail("bad");
```

**Source:** `effect/Result.ts` - see `~/Developer/effect/packages/effect/src/Result.ts`

## Transform

```ts
import { Result } from "effect";

const transformed = Result.flatMap(Result.succeed(1), (n) =>
  n > 0 ? Result.succeed(n) : Result.fail("non-positive"),
);

const mapped = Result.map(Result.succeed(3), (n) => n * 2);
// Result.succeed(6)

const both = Result.mapBoth(Result.succeed(5), {
  onSuccess: (n) => n + 1,
  onFailure: (e) => `Error: ${e}`,
});
```

## Consume

```ts
import { Result } from "effect";

const value = Result.getOrElse(Result.fail("oops"), () => 0);
// 0

const rendered = Result.match(Result.succeed("ok"), {
  onFailure: (e) => `error:${e}`,
  onSuccess: (v) => `value:${v}`,
});
// "value:ok"

const thrown = Result.getOrThrow(Result.fail("err"));
// throws "err"

const merged = Result.merge(Result.fail("err"));
// "err" (returns A | E)
```

**Source:** `effect/Result.ts` - see `~/Developer/effect/packages/effect/src/Result.ts`

## Usage Notes

- `E` defaults to `never`, so `Result<number>` means a result that cannot fail
- `Result.try` wraps throwing code: `Result.try(() => JSON.parse(input))`
- `Result.fromNullishOr(value, (a) => error)` converts nullable values; the fallback is a function
  `(a: A) => E`
- `Result.fromOption(opt, () => error)` converts `Option` to `Result`
- `Result.flip` swaps success and failure channels
- Do notation: `Result.Do`, `Result.bind`, `Result.let`, `Result.bindTo`
- Generator syntax: `Result.gen(function*() { ... })` — evaluated synchronously
- `all` short-circuits on first failure

## Common APIs

**Creation**: `Result.succeed`, `Result.fail`, `Result.succeedNone`, `Result.succeedSome`,
`Result.void`, `Result.fromNullishOr`, `Result.fromOption`, `Result.try`, `Result.liftPredicate`
**Do notation**: `Result.Do`, `Result.bind`, `Result.let`, `Result.gen` **Transform**: `Result.map`,
`Result.mapError`, `Result.mapBoth`, `Result.flatMap`, `Result.andThen`, `Result.tap` **Consume**:
`Result.getOrElse`, `Result.getOrNull`, `Result.getOrUndefined`, `Result.getOrThrow`,
`Result.getOrThrowWith`, `Result.match`, `Result.merge`, `Result.getSuccess`, `Result.getFailure`
**Error handling**: `Result.orElse`, `Result.filterOrFail` **Combining**: `Result.all`,
`Result.flip`, `Result.transposeOption`, `Result.transposeMapOption` **Access**: `Result.bindTo`,
`Result.isResult`, `Result.isSuccess`, `Result.isFailure`
