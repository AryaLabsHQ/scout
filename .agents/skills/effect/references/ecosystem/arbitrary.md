# Native Arbitrary and property testing

`effect@4.0.0` provides native schema-derived generation as the root `effect/Arbitrary` module
(`import { Arbitrary } from "effect"`). It replaces the removed `effect/testing/FastCheck` bridge
and the removed `Schema.toArbitrary` helpers. RC builds exposed it as `effect/unstable/arbitrary`;
that barrel no longer exists, and the module's APIs are still tagged `@stability unstable`.

```ts
import * as Arbitrary from "effect/Arbitrary";
import { Schema } from "effect";

const User = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
});

const users = Arbitrary.schema(User);
const sample = Arbitrary.sampleEffect(users, { count: 10, seed: "stable-seed" });
```

Use `Arbitrary.Constant`, `map`, `filter`, `filterMap`, `flatMap`, `all`, and `array` to compose
generators. Use `sampleEffect` for examples and `checkEffect` for shrinking a falsified property;
both accept bounded sample/check options. Seeds and the returned replay token make a failure
reproducible, but replay compatibility is limited to the same implementation version.
`Arbitrary.configureGlobal({ check, sample })` sets default options (including the run count
`@effect/vitest` uses); explicit per-call options win and `{}` resets it.
`Arbitrary.array(item, { minLength, maxLength })` builds variable-length arrays from custom
Arbitraries.

`@effect/vitest` accepts either Schemas or Arbitraries in `it.prop`:

```ts
import { it } from "@effect/vitest";
import { Schema } from "effect";

it.prop("reversing twice is identity", [Schema.Array(Schema.Int)], ([values]) =>
  values
    .slice()
    .reverse()
    .reverse()
    .every((value, index) => value === values[index]),
);
```

Property callbacks may return `false` or fail with an Effect error to trigger shrinking. Keep the
property Effect-native when it needs services or deterministic time.
