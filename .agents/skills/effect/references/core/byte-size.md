# ByteSize

`ByteSize` is an exact, non-negative byte count backed by `bigint`. Use it when byte quantities must
not lose precision or when configuration and schemas should share one representation.

## Constructors and conversion

```ts
import { ByteSize } from "effect";

const exact = ByteSize.bytes(10_000n);
const decimal = ByteSize.megabytes(2);
const binary = ByteSize.mebibytes(2);
const parsed = ByteSize.fromString("1.5 MiB"); // Option<ByteSize>
const integral = ByteSize.fromInput("2 MiB"); // Input strings must be integer + unit

ByteSize.toBigInt(exact); // 10000n
ByteSize.format(binary); // compact human-readable form
```

`bytes`, decimal unit constructors (`kilobytes` through `quettabytes`), and binary unit constructors
(`kibibytes` through `yobibytes`) reject negative inputs and non-integral or unsafe resulting byte
counts. Fractional quantities are valid when their resulting byte count is exact, such as
`megabytes(1.5)`. `fromInputUnsafe` throws for invalid input; `fromInput` returns `Option.none()`
instead. `ByteSize.Input` string literals are limited to a canonical non-negative integer plus a
recognized unit (`"2 MiB"`), so a fraction like `"1.5 MiB"` is a compile error there. Parse external
or fractional strings with `fromString` / `fromStringUnsafe`.

## Arithmetic

Use `sum`, `subtract`, `times`, and `divide` for checked byte arithmetic. Comparisons and ordering
are available through `between`, `min`, `max`, `clamp`, and `Order`. `toNumber` is loss-aware and
returns an `Option`; use `toNumberUnsafe` only when the range is already proven safe.

## Schema and Config

Use `Schema.ByteSize` for native `ByteSize` values and `Schema.ByteSizeFromString` when decoding
human-readable strings. `Schema.ByteSizeFromBigInt` and `Schema.ByteSizeFromNumber` cover typed
input. `Config.ByteSize("MAX_BODY")` reads the string form through the active config provider.

Decimal units use powers of 1,000 (`MB`); binary units use powers of 1,024 (`MiB`).
