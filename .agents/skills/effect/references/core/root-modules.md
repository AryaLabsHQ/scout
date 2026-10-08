# Additional Root Modules

## Table of Contents

- [Scope](#scope)
- [Additional modules](#additional-modules)
- [How to use this page](#how-to-use-this-page)

## Scope

The product index gives focused guidance for the core modules most often involved in Effect
application architecture. This page routes the remaining public modules exported by the root
`effect` package. Their exact APIs are source-sensitive; check the pinned checkout before copying an
example.

**Source:** `packages/effect/src/index.ts` and the corresponding module under
`~/Developer/effect/packages/effect/src/`.

## Additional modules

| Area                        | Root exports                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Collections and containers  | `Array`, `HashMap`, `HashSet`, `MutableHashMap`, `MutableHashSet`, `MutableList`, `MutableRef`, `Trie`, `Tuple`      |
| Scalar and structural data  | `BigDecimal`, `BigInt`, `Boolean`, `Number`, `String`, `Symbol`, `Struct`, `Brand`, `Ordering`, `Order`, `Predicate` |
| Equality and transformation | `Equal`, `Equivalence`, `Differ`, `Reducer`, `Filter`, `Formatter`, `Hash`, `Graph`, `Optic`, `Arbitrary`            |
| Runtime and coordination    | `Duration`, `Latch`, `ManagedRuntime`, `LayerRef`, `Resource`, `Scope`, `Semaphore`, `Take`, `HashRing`              |
| Encoding and interchange    | `Crypto`, `JsonPatch`, `JsonPointer`, `JsonSchema`, `StandardSchema`, `ChannelSchema`, `SchemaRepresentation`        |
| Platform and terminal       | `FileSystem`, `Path`, `Terminal`, `Utils`                                                                            |

The complete fallback is the root export list in `packages/effect/src/index.ts`: if a root module is
not named in the focused product index or the table above, route it here and inspect its
corresponding source module at the pinned commit before using it.

These are root exports, not domain subpaths such as `effect/http` or `effect/encoding`. Root
`Encoding` no longer exists; Base64, Base64Url, and hex live under `effect/encoding`. Route domain
subpaths through the index in [SKILL.md](../../SKILL.md), `Arbitrary` through
[arbitrary.md](../ecosystem/arbitrary.md), and prefer the focused pages for `Stream`, `Schema`,
`Schedule`, `Context`, and other modules already listed in the product index.

## How to use this page

1. Confirm the consumer's resolved `effect` version with
   [consumer-versions.md](../ecosystem/consumer-versions.md).
2. Open the matching source module at the pinned commit.
3. Prefer the module's exported constructors and combinators over handwritten equivalents.
4. Add a focused reference only when the module becomes a repeated task seam; keep this page as the
   fallback route for the rest.
