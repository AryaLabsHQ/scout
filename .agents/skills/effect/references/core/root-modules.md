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
| Versions, bytes, and diffs  | `SemVer`, `SemVerRange`, `Bytes`, `TextDiff`                                                                         |
| Platform and terminal       | `FileSystem`, `Path`, `Stdio`, `Terminal`, `Utils`                                                                   |

The complete fallback is the root export list in `packages/effect/src/index.ts`: if a root module is
not named in the focused product index or the table above, route it here and inspect its
corresponding source module at the pinned commit before using it.

These are root exports, not domain subpaths such as `effect/http` or `effect/encoding`. Base64,
Base64Url, and hex live under `effect/encoding`, not at the root. Route domain subpaths through the
index in [SKILL.md](../../SKILL.md), `Arbitrary` through [arbitrary.md](../ecosystem/arbitrary.md),
and prefer the focused pages for `Stream`, `Schema`, `Schedule`, `Context`, and other modules
already listed in the product index.

## Versions, bytes, and diffs

- `SemVer`: strict SemVer 2.0.0 values. `SemVer.parse` returns `Result<SemVer, SemVerError>`
  (`parseUnsafe` throws); `make`, `format`, `Order`, `bump(releaseType, identifier?)`, and the
  `isLessThan` / `isGreaterThan` family. `Order` follows spec precedence and ignores build metadata;
  structural equality includes it.
- `SemVerRange`: `parse` / `parseUnsafe`, constructors `caret`, `tilde`, `between`, `exact`, `any`,
  and `matches(range, version, options?)`, `maxSatisfying`, `minSatisfying`.
- `Bytes`: `Bytes.concat(chunks)` always returns a new `Uint8Array`; `Bytes.Equivalence` and
  `Bytes.Order` compare `Uint8Array` values.
- `TextDiff`: `diff` (arrays) and `lines` (text) compute edit scripts; `apply` / `applyText` replay
  them as `Result`, `invert` reverses a script, and `unified` formats a line diff.

## Platform notes

- `Path.resolveWithin(root, input)` resolves a relative input beneath `root` and returns
  `Option.none()` for `..` escapes and rooted inputs; use it for untrusted paths. `Path.make` builds
  a `Path` service from the platform primitives and derives `resolveWithin`.
- `FileSystem.lstat(path)` stats without following symlinks. `FileSystem.open` accepts
  `noFollow: true` (Node and Bun on POSIX) to reject a symlink at the final component, and
  `File.read` / `File.readAlloc` take `{ position }` (a `bigint`) for positional reads that leave
  the cursor unchanged. `File.Info` 64-bit fields are `bigint`: `dev`, and `Option<bigint>` for
  `ino`, `rdev`, `nlink`, `blocks`. Custom `FileSystem.make` implementations must supply `lstat`.
- `Stdio.stderrIsTerminal` joins `stdinIsTerminal` and `stdoutIsTerminal`; `Stdio.make` defaults all
  three to `false` unless supplied.

## How to use this page

1. Confirm the consumer's resolved `effect` version with
   [consumer-versions.md](../ecosystem/consumer-versions.md).
2. Open the matching source module at the pinned commit.
3. Prefer the module's exported constructors and combinators over handwritten equivalents.
4. Add a focused reference only when the module becomes a repeated task seam; keep this page as the
   fallback route for the rest.
