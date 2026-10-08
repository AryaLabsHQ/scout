# v4 version lineage

## Table of Contents

- [beta.92 → beta.93](#beta92--beta93)
- [beta.93 → beta.94](#beta93--beta94)
- [Post-beta.94 published releases (beta.95–98)](#post-beta94-published-releases-beta9598)
- [beta.98 → beta.101](#beta98--beta101)
- [beta.101 → beta.102](#beta101--beta102)
- [beta.102 → beta.103](#beta102--beta103)
- [beta.103 → beta.104](#beta103--beta104)
- [beta.104 → beta.107](#beta104--beta107)
- [beta.107 → rc.108](#beta107--rc108)
- [rc.108 → rc.110](#rc108--rc110)
- [rc.110 → rc.111](#rc110--rc111)
- [rc.111 → rc.112](#rc111--rc112)
- [rc.112 → rc.113](#rc112--rc113)
- [rc.113 → rc.114](#rc113--rc114)
- [rc.114 → rc.115](#rc114--rc115)
- [rc.115 → 4.0.0 stable](#rc115--400-stable)
- [Schema](#schema)
- [Effect / errors](#effect--errors)
- [Runtime / platform](#runtime--platform)
- [HttpApi](#httpapi)
- [Workflow / RPC / SQL](#workflow--rpc--sql)
- [Config / observability](#config--observability)
- [CLI / other](#cli--other)

**Baseline: the rest of the skill documents `effect@4.0.0` (stable).** The source map follows
`~/Developer/effect` at `67ba4e46a11ccda0b6761578bfd22c04ae00167d`, the commit whose package
metadata reports `4.0.0`. The previous baseline was `9ad9891e24058065bcd445772e005f8ce4b3e42f`
(`4.0.0-rc.115` plus a few commits). Use exact release tags for published-package claims. Check
resolved dependencies in [consumer-versions.md](consumer-versions.md) before copying an example into
a consumer.

**Historical sections keep the paths of their release.** Every `effect/unstable/<area>` import,
`Encoding` helper, or `Schema.is*` name in a section above
[rc.115 → 4.0.0 stable](#rc115--400-stable) was correct for that prerelease and is not an
instruction for stable code. Apply the stable mapping in that section when substituting a historical
example.

## beta.92 → beta.93

### URL construction moved

`UrlParams.makeUrl` moved to `Url.make`. `Url.make` returns `Result.Result<URL, Url.UrlError>` and
takes an already-created `UrlParams` plus an optional hash:

```ts
import { Result } from "effect";
import { Url, UrlParams } from "effect/unstable/http";

const result = Url.make(
  "https://example.com/search",
  UrlParams.fromInput({ q: "effect", page: 2 }),
  "results",
);

if (Result.isFailure(result)) {
  const error: Url.UrlError = result.failure;
  console.error(error.cause);
}
```

Use `Url.fromString(value, base?)` for parsing without query construction. Its failure is
`Cause.IllegalArgumentError`, not `UrlError`.

Other beta.93 changes relevant to this skill:

- several `UrlParams` APIs accept `UrlParams.Input` directly;
- tracer exception events render nested Effect causes; and
- malformed JSON/security-handler behavior received HttpApi fixes around the release boundary.

## beta.93 → beta.94

- `Schema.Decoder` and `Schema.Encoder` were added; decode-only and encode-only APIs accept narrower
  schema capabilities.
- `LayerRef` and `FileSystem.glob` were added.
- HttpApi runtime shape was corrected.
- `@effect/sql-sqlite-node` changed its underlying driver to `node:sqlite`; audit driver-specific
  assumptions before upgrading.

These are opt-in migration facts, not a reason to refactor a beta.93 consumer during unrelated work.

## Post-beta.94 published releases (beta.95–98)

No beta.95/96 tags exist; the published releases after beta.94 are `effect@4.0.0-beta.97` and
`effect@4.0.0-beta.98`.

**beta.97 — Schedule consolidation.** 22 exports removed, 7 added (verified by export diff between
the beta.94 and beta.98 tags; the Schedule surface is identical at beta.97 and beta.98):

- Removed: the `either*` and `both*` families, `take`, `tapInput`, `tapOutput`, `collectInputs`,
  `collectOutputs`, `collectWhile`, `delays`, `elapsed`, `reduce`, `unfold`, and the
  `satisfies*Type` helpers.
- Added: `Schedule.min`, `Schedule.max`, `Schedule.upTo`, and the type accessors
  `Schedule.Output/Input/Error/Env`.
- Migration: `either` → `min`, `both` → `max`, `take(n)` → `upTo({ times: n })`,
  `tapInput`/`tapOutput` → `Schedule.tap((meta) => …)` reading `meta.input` / `meta.output`. See
  [schedule.md](../retry/schedule.md).

**beta.97 — other changes:**

- Config: empty string values are treated as missing data (`FOO=""` now takes `withDefault` defaults
  and yields `Option.none()` from `Config.option`); opt out with the provider's
  `preserveEmptyStrings` option. See [config.md](../core/config.md).
- RPC protocol ids widened from `number` to `string | number` (internal to RpcMessage /
  RpcSerialization; no documented rpc.md surface changes).
- `Schedule.cron` follows vixie cron semantics more closely.

**beta.98 — additions:**

- `SchemaError` exposed as a standalone `effect/SchemaError` module; `Schema.SchemaError` /
  `Schema.isSchemaError` re-exports remain valid on the beta line. The standalone module is
  **removed at rc.108** — RC consumers import from `Schema` only.
- `HttpApiError.UnprocessableEntity` (422) added to the error vocabulary.
- HttpApi rejects unknown and duplicate handler registrations with descriptive errors (previously
  silent) and rejects duplicate OpenAPI operation identifiers.

The skill's examples use the beta.97+ forms (`min`/`max`/`upTo`/`tap`). Consumers pinned at beta.94
or earlier must substitute the older forms per the migration mapping above and must not use
`min`/`max`/`upTo`; when upgrading such a consumer, audit `tapInput`/`tapOutput`/`take`/
`either`/`both` usage first.

## beta.98 → beta.101

No exports were removed in this range; it is additive plus correctness fixes. The items below are
the ones that change consumer-visible behaviour.

**beta.99**

- CLI: a scoped `CliConfig` service customizes the built-in global flags. Passing an explicit
  `builtIns` list omits the ones you leave out — e.g.
  `[GlobalFlag.Help, GlobalFlag.Version, GlobalFlag.Completions]` removes `--log-level`. See
  [cli.md](cli.md).
- CLI: interactive wizard mode is back, via the `--wizard` flag and `Command.wizard`.
- CLI: a flag supplied without its required value now reports an error instead of being accepted,
  `--completions` included.
- CLI: `Command.withSubcommands` no longer collapses inferred requirements to `never` when given
  more than one subcommand, and `Command.Services` extracts a command's required services.
- HttpApi: `HttpApiBuilder` distributes handler requirements per service, so a request middleware
  layer can supply them. This is what makes `requires: never` reachable on auth middleware — see
  [httpapi-seams.md](httpapi-seams.md).
- Multipart parser limit violations surface as failures instead of being silently swallowed.
- `Graph` gained set operations (`compose`, `intersection`, `difference`, `symmetricDifference`,
  `complement`, `neighborhood`, `sum`), radius-bounded and undirected traversals, and a long list of
  equality, hashing, and iterator fixes. No reference doc in this skill — read the source.
- AI: `Tool.addDependency` / `setParameters` / `setSuccess` / `setFailure` / `annotate` preserve a
  provider-defined tool's kind and `id` when cloning, so `Tool.isProviderDefined` and
  `Tool.getStrictMode` keep working. See [ai.md](ai.md).

**beta.100**

- `Schema.toTaggedUnion` exposes a `discriminants` tuple and rejects duplicate discriminant property
  keys. See [schema.md](../schema/schema.md).
- `Effect.reduce` is available.
- Constructor defaults preserve nested class construction.
- `Cron` correctness, in bulk: month and weekday aliases normalize independently of the host locale,
  `Cron.make` validates field constraints, weekday `7` is Sunday consistently, `Cron.prev` no longer
  mis-handles day-of-month rollover across short months or weekday wrapping, and equality and
  hashing include the optional timezone. A consumer with cron-scheduled work should re-check
  expected fire times when crossing this boundary. See [coordination.md](../core/coordination.md).
- Multipart errors respond with a status derived from their reason and are ignored by the error
  reporter.
- `Cache` interrupts a lookup only once every awaiter is gone.
- `@effect/vitest`: chained helpers such as `it.describe.each` and `it.skip.each` survive the `it`
  proxy. Before this, they threw `TypeError: it.describe.each is not a function`. See
  [vitest.md](vitest.md).
- `@effect/platform-node`: an aborted `HEAD` response no longer blocks `NodeHttpServer` disposal.
- The published declaration for `HttpEffect.appendPreResponseHandlerUnsafe` is fixed.

**beta.101**

- `HttpRouter.toWebHandler` middleware inference excludes request services supplied by the HTTP
  adapter. This matters to every `fetch`-handler host, workerd included — see `cloudflare`
  `references/workers/effect-request-seam.md`.
- Required readonly `Schema.Struct` fields render simpler `Type` / `Encoded` / `Iso` types.
- Fiber semantics: concurrent traversal workers are interrupted and awaited when a mapper or refill
  callback throws; pending interrupts are delivered when `interruptibleMask` restores
  interruptibility; self-interruption from inside a running operation works; stack-frame annotations
  survive terminal root failures, and interrupting-fiber frames are stored separately from
  interrupted-target frames.
- Performance: `runSyncExit` skips allocating a scheduler dispatcher when it completes without
  yielding, and `awaitAllChildren` child selection is linear in the number of fibers.
- `MutableList.filter` no longer leaves an invalid empty bucket when no values match.

## beta.101 → beta.102

No Samva-facing export removals beyond `Effect.withConcurrency` / `"inherit"` concurrency (unused
here). Consumer-visible changes:

- **Concurrency:** `Effect.withConcurrency`, `References.CurrentConcurrency`, and the `"inherit"`
  concurrency option are gone. Pass an explicit `number` or `"unbounded"` instead.
- **Clock:** wall-clock (`currentTime*`) and monotonic elapsed time are split. `Clock.Clock`
  requires `monotonicTimeNanos` / `monotonicTimeNanosUnsafe`. `Effect.timed`, duration metrics, and
  `Sink.withDuration` use monotonic time; custom clocks must implement both members.
- **ConfigProvider:** lookup absence is `undefined` (`load` / `make` lookup return
  `Node | undefined`). `mapInput` is a provider capability; `ConfigProvider.mapInput` delegates to
  it. Empty-string-as-missing behaviour from earlier betas is unchanged for built-in providers.
- Correctness/perf elsewhere (HTTP span attributes when unsampled, PubSub replay retention, RPC
  streaming buffer caps, Postgres advisory lock namespacing, OTLP flush/shutdown) — additive for
  typical HttpApi / SQL / OTel consumers.
- **Schema.Date:** rejects invalid dates. `Schema.DateValid`, `Schema.isDateValid`, and
  `Schema.isDateValidReviver` are removed — use `Schema.Date`.
- **Schema numbers:** `Schema.Natural` added; prefer canonical `Int` / `Finite` / `Natural` for
  numeric domain values.
- **Schema.asClass** removed. Schemas are directly class-extendable
  (`class MyString extends Schema.String`). `Schema.Class` / `TaggedClass` remain for domain
  classes.
- **SchemaUtils** / `getNativeClassSchema` removed.

## beta.102 → beta.103

- `@effect/platform-deno` is published (Deno FS, HTTP, sockets, workers, crypto, stdio, terminal).
  npm name is `@effect/platform-deno`; see [platform-deno.md](platform-deno.md).
- `Semaphore.takeIfAvailable` — non-blocking permit acquire, returns `Effect<boolean>`.
- `Context.mutate` and `Context.getReferenceUnsafe` removed. Context updates use overlays;
  `Context.get` resolves reference defaults.
- `Schema.UnknownFromJsonString` is internal. Use `Schema.fromJsonString(Schema.Unknown)`.
- `SchemaIssue` no longer carries `actual` / `getActual` / `redact`. Built-in formatters use static
  messages. Rejected input is opt-in via parse option `reportInput` (beta.105).

## beta.103 → beta.104

These are the renames that break skill examples. Substitute the left-hand names on any consumer
still on beta.103 or earlier.

| Removed / old                        | RC name                                                           |
| ------------------------------------ | ----------------------------------------------------------------- |
| `Schema.TaggedErrorClass`            | `Schema.TaggedError`                                              |
| `Schema.ErrorClass`                  | `Schema.Error`                                                    |
| JS `Error` schema                    | `Schema.ErrorInstance`                                            |
| `Schedule.andThen` / `andThenResult` | `Schedule.concat` / `Schedule.concatResult`                       |
| `Command.withHidden` / `.hidden`     | `Command.unlisted` / `.unlisted` (`Flag.withHidden` is unchanged) |
| `RateLimiter.makeSleep`              | `RateLimiter.sleep(limiter, options)`                             |

Also in this range:

- `HttpApiSchema.WithHeaders` / `encodeToWithHeaders` — typed response headers on handlers,
  generated clients, streams, and OpenAPI. See [httpapi.md](httpapi.md).
- Parse-only `Ini` / `Yaml` / `Toml` under `effect/unstable/encoding`. No stringify, no
  `Schema.fromYaml`.
- `Effect.withExecutionPlan` / `Stream.withExecutionPlan` take optional `onEvent`.
- Nested SQL transactions serialize; cross-dependent siblings deadlock instead of corrupting.
- `Migrator.fromFileSystem` needs `Path` as well as `FileSystem` from beta.107; aggregate platform
  layers (`NodeServices.layer`) already provide it.

## beta.104 → beta.107

Additive and correctness. Skill-visible items:

- **beta.105:** `Schema.makeEffect` fails with `SchemaIssue.Issue`, not `SchemaError`. `reportInput`
  parse option retains rejected inputs on value-bearing issues.
- **beta.106:** `ConfigProvider.fromEnvRecord` for an explicit environment record.
  `Schema.toArbitrary(schema)` returns a factory that takes the fast-check module; `toArbitraryLazy`
  is gone. (Both helpers and the fast-check bridge were removed at rc.113 — use
  `effect/unstable/arbitrary`.) Event-log encrypt wire changed (IV with ciphertext); clients and
  servers must upgrade together. Entity clients include `EntityNotAssignedToRunner`.
- **beta.107:** `Migrator.fromFileSystem` type widens to `FileSystem | Path`. Multipart file streams
  fail instead of hanging when a parser limit is exceeded.

## beta.107 → rc.108

First RC. Numbering continues from the beta line; there is no rc.0.

- Standalone `effect/SchemaError` module **removed**. Use `Schema.SchemaError` /
  `Schema.isSchemaError` only.
- HttpApi array query parameters with a single value decode as a one-element array.
- `HttpRouter.Middleware.layer` provides request error services declared in `handles`.
- Platform packages nest under `packages/platform/{node,bun,browser,deno}` in the source tree. npm
  names are unchanged (`@effect/platform-node`, …).

## rc.108 → rc.110

- `@effect/platform-node` NodeRedis now uses the `node-redis` client. Pass `createClient` options
  such as `url`, `socket`, and `commandOptions`; direct client calls use node-redis signatures.
- `SchemaIssue.InvalidValue` takes annotations, the rejected input, and parse options. Pass
  `{ reportInput: true }` when diagnostics must retain the input.
- Convert related schemas together with `SchemaRepresentation.toRepresentations`; converting them
  one at a time can lose shared reference identity.

`HttpStatus` is a public export of `effect/unstable/http` at rc.110 and later. Use named status
literals from that module rather than raw numbers when the HTTP layer already imported it.

## rc.110 → rc.111

- `Match.fn(select)` builds a reusable matcher from a selector. The compiled function keeps the
  selector's argument list; case handlers receive the narrowed selected value first, then those
  arguments. Hand-written `Matcher` / `ValueMatcher` flavor annotations from earlier RCs need an
  extra type argument.
- `Schema.JsonObject` is `Schema.Record(Schema.String, Schema.Json)`. It rejects arrays.
  `Schema.Json` still accepts any JSON value.
- Optics gained dual standalone functions: `Optic.get`, `getResult`, `set`, `replace`,
  `replaceResult`, `modify`, `getAll`, `modifyAll`. Method style `_a.get(s)` still works.
- Schema representation `$ref` emission is identifier-only by default. Set
  `ToRepresentationOptions.referencePolicy` when anonymous repeated schemas must become references.
- `Redis.subscribe(channel)` is scoped and returns `Queue.Dequeue<RedisMessage>`. Custom
  `Redis.make` implementations later require a `subscribe` callback (rc.112).
- RPC HTTP streams buffer by default (`streamBufferSize`, 16). Server-originated notifications are
  first-class RPC messages.
- Graph gained snapshots, bulk remove, connectivity, bipartite matching, max-flow, and min-cut. The
  module itself existed at rc.110.

## rc.111 → rc.112

- `effect/StandardSchema` vendors Standard Schema V1. Do not add `@standard-schema/spec`.
- `SchemaBinary` lives at `effect/unstable/encoding`. `SchemaBinary.toCodec(schema)` is the compact
  codec. `fingerprint: true` is positional and not evolution-safe. Encoded bytes are arena views;
  `bytes.slice()` if they must outlive the codec. RPC opt-in: `RpcSerialization.layerSchemaBinary`.
- `Pool.use(pool, f)` borrows without a `Scope`. `Pool.get` still needs one.
- `RcMap.getOption` and `LayerMap.contextEffectOption` look up a cached resource and never acquire.
- `Schema.TaggedUnion(...).matchOrElse(cases, fallback)` is partial matching with a typed fallback.
- CLI prompts dropped per-prompt `prefix`. Theme symbols and colors through `Prompt.Theme` or a
  per-prompt `theme` option.
- Workflow discard RPC/HTTP endpoints return the execution ID string, not void.
- `RpcSerialization` services must provide `codecFor`. Built-in JSON codecs already do.
- `@effect/sql-pg` exported `PgAuth`, `PgProtocol`, and `PgTypes` as a wire-codec library while
  `PgClient` still used the `pg` driver at this release tag.
- OpenAI GPT-5.6+: `promptCacheBreakpoint` on text/system parts; request-level `prompt_cache_key` /
  `prompt_cache_options`.
- `AuthenticationError.description` carries the provider explanation.
- JSON Schema import throws on unsupported keywords instead of dropping them.

## rc.112 → rc.113

rc.113 is the large v4 release-candidate cleanup. These are breaking for any consumer still on
rc.112 or earlier.

- **Config constructors are PascalCase.** `Config.string` / `number` / `boolean` / `int` / `finite`
  / `literal` / `literals` / `duration` / `port` / `logLevel` / `redacted` / `url` / `date` /
  `nonEmptyString` / `array` / `record` became `Config.String` / `Number` / `Boolean` / `Int` /
  `Finite` / `Literal` / `Literals` / `Duration` / `Port` / `LogLevel` / `Redacted` / `URL` / `Date`
  / `NonEmptyString` / `Array` / `Record`. `Config.mapOrFail` became `Config.mapEffect`.
  `Config.Array` / `Config.Record` are direct constructors, and `Config.ByteSize` was added.
  Combinators (`Config.all`, `option`, `withDefault`, `nested`, `map`, `schema`) are unchanged. See
  [config.md](../core/config.md).
- **CLI constructors are PascalCase.** `Primitive` / `Param` / `Flag` / `Argument` / `Prompt` /
  `GlobalFlag` renamed lowercase constructors: `Flag.String` / `Int` / `Finite` / `Boolean` / `Date`
  / `Literals` (was `choice`) / `ChoiceWithValue`; matching `Argument.*`; `Prompt.String` / `Int` /
  `Number` / `Select` / `Confirm` / `MultiSelect`; `GlobalFlag.Action` / `Setting`. Primitive `_tag`
  values are `"Int"`, `"Finite"`, and `"Never"`. `Prompt.IntegerOptions` / `FloatOptions` became
  `IntOptions` / `NumberOptions`. See [cli.md](cli.md).
- **Effectful schema transforms renamed.** `SchemaGetter.transformOrFail` and
  `SchemaTransformation.transformOrFail` are now `transformEffect`. See
  [schema.md](../schema/schema.md).
- **Schema parse options moved to the call.** `parseOptions` annotations no longer affect parsing;
  pass options to the decoder, encoder, or constructor adapter. `propertyOrder` was removed,
  `onExcessProperty: "preserve"` was removed, `SchemaAST.Union.mode` moved to `Union.options?.mode`,
  and declared `Struct` fields may now be inherited. `Schema.Enum` rejects non-finite numeric
  members and `Schema.isMultipleOf` rejects zero/non-finite divisors.
- **JSON Schema option renamed.** `Schema.ToJsonSchemaOptions.additionalProperties` became
  `onExcessProperty` (`false` → `"error"`, `true` → `"ignore"`; model values with `Schema.Record` /
  `Schema.StructWithRest`).
- **Schema revivers moved.** The built-in revivers move from `Schema` to `SchemaRepresentation` and
  are named `makeReviverDeclaration`, `makeReviverFilter`, and `makeReviverFilterGroup`.
  `Schema.toEncoderXml` now fails with `SchemaIssue.Issue` directly.
- **`@effect/sql-pg` uses a native PostgreSQL client.** `PgClient.fromPool`, `fromClient`, and
  `makeWith` are removed; use `PgClient.make` for a pool and `PgClient.makeClient` for one
  connection. New public `PgConnection` (single session) and `PgPool` (pool lifecycle, `reserve` for
  exclusive access) modules. `PgClientConfig.types` is now a `PgTypes.Registry`, plain object
  parameters are no longer inferred as JSON (use `sql.json` / `PgClient.json`), and binary codecs
  change result types (`int8` → `bigint`, timestamps → `Date`, `date` → string, `bytea`/unknown OIDs
  → `Uint8Array`). `listen` returns a scoped `Queue.Dequeue`. See [sql.md](sql.md).
- **MessagePack removed.** RPC serialization now provides JSON, NDJSON, JSON-RPC, and SchemaBinary.
  TCP cluster serialization uses the supplied `RpcSerialization`; provide `layerSchemaBinary(...)`
  to select SchemaBinary. See [rpc.md](rpc.md).
- **Fast-check bridge removed; native Arbitrary.** `effect/testing/FastCheck`, `Schema.toArbitrary`,
  and the legacy arbitrary annotations are gone. Native generation lives at
  `effect/unstable/arbitrary` (`Arbitrary.schema`, `sampleEffect`, `checkEffect`). `@effect/vitest`
  property tests accept Schemas or Arbitraries and no longer take `fastCheck` or `.sequential`. See
  [arbitrary.md](arbitrary.md).
- **Socket reads are pull-based.** `Socket.run`, `runString`, and `runRaw` are removed; acquire
  scoped `reader` / `writer` interfaces with backpressure. Server addresses use
  `NetAddress.SocketAddress`. See [socket.md](socket.md).
- **`mime` dependency removed.** MIME lookup now lives at `effect/unstable/http/Mime` (`getType`,
  `getExtension`, `getAllExtensions`).
- **Runtime type IDs follow module paths.** Marker strings omit legacy grouping prefixes and the
  `unstable` path segment; OpenTelemetry spans use the `OtelTracer` module path. Custom
  implementations that copy marker strings must adopt the corrected IDs.
- **Other removals and corrections.** `Channel.runDone` (use `runDrain`), `Graph.Proto`, and
  `SynchronizedRef`'s `Ref` subtype relation; `Effect.try` / `tryPromise` generic typing is
  tightened; `RateLimiterStore.tokenBucket` returns `[remaining, elapsedMillis]`; the Cookie,
  Cookies, Headers, and UrlParams schemas moved from `effect/unstable/http` to root `Schema`. Root
  `ByteSize` is an exact bigint-backed value with Schema and Config codecs (see
  [byte-size.md](../core/byte-size.md)).

## rc.113 → rc.114

- `Schema.Annotations.ToArbitrary.Constraint` became
  `Schema.Annotations.ToArbitrary.FilterConstraint`.
- `message` is optional for `Prompt.Select` and `Prompt.MultiSelect`.
- `Effect.cachedWithTTL` accepts a TTL computed from each completed `Exit`, so successes and
  failures can use different durations. See [cache.md](../core/cache.md).
- File stats return `Option.none()` for optional numeric metadata beyond the safe-integer range.
- Published declarations no longer reference stripped `@internal` symbols, so consumers compiling
  with `skipLibCheck: false` typecheck.

## rc.114 → rc.115

- `HttpServerResponse.toWeb` and the Bun/Deno HTTP adapters omit response bodies for statuses 204,
  205, and 304, preventing invalid Web responses. See [platform.md](platform.md).
- Persistence `getMany` lookup keys are parameterized in both SQL backing stores.
- Schema initialization is optimized while preserving custom constructor options.

## rc.115 → 4.0.0 stable

`effect@4.0.0` is the first stable v4 release; it replaces the beta and RC series. The path moves
landed in `rc.118`; the Schema brand and partition changes landed only in `4.0.0`. Verified against
`packages/effect/package.json` exports and `packages/effect/CHANGELOG.md`.

### Import paths

- **No `effect/unstable/*` export remains** (`rc.118`, no compatibility exports). Drop the
  `unstable/` segment: `effect/unstable/http` → `effect/http`, `.../sql` → `effect/sql`,
  `.../ai/LanguageModel` → `effect/ai/LanguageModel`, `.../schema/Model` → `effect/schema/Model`,
  and so on for `ai`, `cli`, `cluster`, `devtools`, `encoding`, `eventlog`, `net`, `observability`,
  `persistence`, `process`, `reactivity`, `rpc`, `socket`, `workers`, and `workflow`.
- **`effect/unstable/httpapi` → `effect/http-api`** (hyphenated). Runtime TypeIds and service keys
  moved from `httpapi` to `http-api`, and the reserved SSE failure event is now
  `effect/http-api/stream/failure`.
- **`effect/unstable/arbitrary` → root `effect/Arbitrary`** (`import { Arbitrary } from "effect"`).
  The `unstable/arbitrary` barrel and `unstable/schema` barrel were replaced: `effect/schema` is now
  `Model`, `VariantSchema`, and the optional
  `SchemaCompiler`/`SchemaJITCompiler`/`SchemaAOTCompiler` modules.
- The package exports are the root, `./*` (root modules), and nineteen domain subpaths (`ai`, `cli`,
  `cluster`, `devtools`, `encoding`, `eventlog`, `http`, `http-api`, `net`, `observability`,
  `persistence`, `process`, `reactivity`, `rpc`, `schema`, `socket`, `sql`, `workers`, `workflow`)
  plus `testing`. Moving a module does not stabilize it: `@stability unstable` tags remain on most
  of these APIs and permit breaking minor releases.
- `effect/unstable/http/Mime` → `effect/http/Mime`.

### Encoding

- **Root `effect/Encoding` was deleted** (`rc.118`). Use `effect/encoding/Base64`, `Base64Url`,
  `Hex`, and `EncodingError`. The helpers lost their format prefix and the `Result` decoders are
  unchanged:

  | Removed (`Encoding.*`)                | Stable                                            |
  | ------------------------------------- | ------------------------------------------------- |
  | `encodeBase64` / `decodeBase64`       | `Base64.encode` / `Base64.decode`                 |
  | `decodeBase64String`                  | `Base64.decodeString`                             |
  | `encodeBase64Url` / `decodeBase64Url` | `Base64Url.encode` / `Base64Url.decode`           |
  | `decodeBase64UrlString`               | `Base64Url.decodeString`                          |
  | `encodeHex` / `decodeHex`             | `Hex.encode` / `Hex.decode`                       |
  | `decodeHexString` / `randomHex`       | `Hex.decodeString` / `Hex.random`                 |
  | `EncodingError`, `isEncodingError`    | `EncodingError.EncodingError`, `.isEncodingError` |

  ```ts
  import { Base64, Hex } from "effect/encoding";

  Base64.encode("hello"); // "aGVsbG8="
  Hex.decode("48656c6c6f"); // Result<Uint8Array, EncodingError>
  ```

### Schema

- **Check renames** (`rc.118`): range checks put the subject last. `isLengthBetween` →
  `isBetweenLength`, `isSizeBetween` → `isBetweenSize`, `isPropertiesLengthBetween` →
  `isBetweenProperties`. String checks became `isStartingWith`, `isEndingWith`, and `isIncluding`
  (from `isStartsWith`, `isEndsWith`, `isIncludes`). New: `isMinCodePoints`, `isMaxCodePoints`,
  `isBetweenCodePoints` count Unicode code points; `isMinLength`/`isMaxLength` count UTF-16 units.
  Persisted check IDs and the matching `SchemaRepresentation.*Reviver` exports use the new names.
  The numeric `Schema.isBetween({ minimum, maximum })` and the date, bigint, and bigdecimal variants
  are unchanged.
- **`Schema.brand` is type-only and takes one concrete identifier** (`4.0.0`). A union, widened
  `string`, or open template literal identifier is a type error; apply `brand` repeatedly for
  distinct brands. The identifier is no longer stored in the AST, so `SchemaRepresentation` and its
  generated code drop it. Reapply `Schema.brand` after rebuilding from a representation. Checks
  added by `Schema.fromBrand` are still preserved, and `fromBrand` must use the constructor's sole
  concrete brand key (an enum member only when that key is an enum).
- `TestSchema` gained `succeedEffect`, `failEffect`, and `verifyRoundTripEffect`, and is tagged
  unstable.

### Other breaking behavior

- **Partition result order** (`4.0.0`): `Array`, `Chunk`, `Effect`, and `Record` `partition` and
  their `separate` helpers, and `Option.partitionMap`, return successes (or matches) first, then
  failures, matching `Stream.partition`. Swap the destructured tuple when moving from `rc.*`.
- `Scope.close` and `Scope.closeUnsafe` require a `Scope.Closeable` from `Scope.make` or
  `Scope.fork`; a plain `Scope.Scope` cannot be closed (`rc.118`).
- `Toolkit.handle` requires tool-handler services on the outer Effect as well as the returned
  `Stream` (`rc.118`).
- Custom `MessageStorage` implementations must honor the optional expected reply id on
  `clearReplies` (`4.0.0`).
- `RpcMessage.ExitEncoded` interrupt `fiberId` admits `null` from JSON encoding (`4.0.0`).
- `NetAddress` stores IPv4/IPv6 as numbers instead of a `Uint8Array` (`rc.118`).

### Additions worth knowing

- `Arbitrary.configureGlobal` (`rc.118`) sets default check/sample options, including the run count
  `@effect/vitest` uses; `Arbitrary.array(item, { minLength, maxLength })` (`rc.116`).
- `Decision` and `DecisionModel` in `effect/ai` (`rc.116`); `Schedule.once`, `Config.flatMap`,
  `PubSub.isPubSub`, `PlatformError.isPlatformError`, per-slot `HttpApi` parse options (`rc.118`).
- `ByteSize.Input` string literals must be a canonical integer plus a unit (`rc.116`); parse
  fractional or external strings such as `"1.5 MiB"` with `ByteSize.fromString`.
- `@effect/vitest` peers `vitest >=5.0.0 <6.0.0`, and TypeScript 5.9+ is required.

## Schema

| Change                                                                            | Since   | Skill impact                                |
| --------------------------------------------------------------------------------- | ------- | ------------------------------------------- |
| `Schema.asserts(schema, input)` — direct assert; removed `Schema.Codec.ToAsserts` | beta.68 | See [schema.md](../schema/schema.md)        |
| `SchemaParser.makeUnsafe` → `SchemaParser.make`                                   | beta.67 | Use `make` in new code                      |
| Decoding/constructor defaults can fail with `SchemaError` and require `R`         | beta.67 | Defaults may `yield*` services              |
| `Schema.Array` / `NonEmptyArray` `.value` restored                                | beta.71 | Collection wrapper API parity               |
| JSON Schema custom annotation passthrough                                         | beta.71 | OpenAPI / codegen                           |
| Boundary APIs normalize error behavior — defects propagate, not swallowed         | beta.84 | `decodeUnknownSync` / `decodeUnknownEffect` |
| Unconstrained JSON Schema nodes import as `Schema.Json`                           | beta.83 | Wire typing                                 |
| `toArbitraryConstraint` → `arbitrary: { constraint }` / `{ candidate }`           | beta.80 | Property tests                              |
| `Schema.Constraint*` types added; many APIs no longer need full `Schema.Top`      | beta.86 | Helper signatures                           |
| `Schema.toType` / `toEncoded` / codec wrappers expose source schema via `.schema` | beta.87 | Introspection                               |
| `Schema.Void` accepts present values and decodes to `undefined`                   | beta.89 | Use `Schema.Undefined` for exact undefined  |
| `Schema.toCodecStringTree` removed `keepDeclarations` option                      | beta.86 | StringTree codec helpers                    |

## Effect / errors

| Change                                                           | Since   | Skill impact                                                               |
| ---------------------------------------------------------------- | ------- | -------------------------------------------------------------------------- |
| `catch*` combinators preserve unhandled error types in inference | beta.71 | Typed error channels stay accurate                                         |
| `Effect.Yieldable` removed                                       | beta.66 | Use `Cause.YieldableError` / `Schema.TaggedError` — not `Effect.Yieldable` |
| `Effect.try(() => …)` — bare thunk without `{ try: }` wrapper    | beta.84 | Sync try shorthand                                                         |
| `Effect.transposeOption` added                                   | beta.84 | `Option<Effect<A>>` → `Effect<Option<A>>`                                  |
| `Random.choice` — pick from iterable/array                       | beta.84 | Empty iterables fail with `NoSuchElementError`                             |
| `Effect.fromOption(option, onNone)` custom error callback        | beta.89 | Avoid generic `NoSuchElementError` when domain error matters               |

## Runtime / platform

| Change                                                           | Since   | Skill impact                              |
| ---------------------------------------------------------------- | ------- | ----------------------------------------- |
| `Crypto` service — `randomUUIDv4` / `randomUUIDv7`, secure bytes | beta.68 | Prefer over `Random.nextUUIDv4` (removed) |
| `Model.Generated` → `Model.GeneratedByDb`                        | beta.68 | SQL/model docs                            |
| Module-level side effects removed for tree-shaking               | beta.83 | Safer edge/minimal bundles                |

## HttpApi

| Change                                                               | Since                  | Skill impact                                           |
| -------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------ |
| `HttpApiSecurity.http({ scheme })` custom Authorization schemes      | beta.73                | See [httpapi.md](httpapi.md)                           |
| `HttpApiTest.groups` optional `baseUrl`                              | beta.66                | E2E tests                                              |
| OpenAPI custom security scheme generation                            | beta.73                | Spec export                                            |
| `layerSchemaErrorTransform`                                          | (pre-beta.66 in range) | Map `HttpApiSchemaError` to declared middleware errors |
| `HttpApiSchema.StreamSse` / `StreamUint8Array` streaming             | beta.81                | See [httpapi.md](httpapi.md) streaming section         |
| `HttpApiClient` URL-encodes path parameters                          | beta.84                | Client calls                                           |
| HttpApi fields and clients use `Schema.Constraint` surface           | beta.86                | Helper typings                                         |
| Malformed JSON payloads render as 400 schema errors                  | beta.93 boundary       | Server edge behavior                                   |
| Security middleware does not try later schemes after handler failure | beta.93 boundary       | Auth behavior                                          |

## Workflow / RPC / SQL

| Change                                                            | Since   | Skill impact                                  |
| ----------------------------------------------------------------- | ------- | --------------------------------------------- |
| `Workflow.make("tag", options)` — tag is first argument           | beta.81 | See [workflow.md](workflow.md)                |
| `RpcGroup.toHandlers` iterates group definitions first            | beta.84 | Extra handler keys ignored — [rpc.md](rpc.md) |
| RPC HTTP client defects on response close before terminal message | beta.86 | [rpc.md](rpc.md)                              |
| `SqlResolver.findById` deduplicates concurrent requests           | beta.84 | [sql.md](sql.md)                              |
| `Statement.valuesUnprepared` exposes unprepared rows as arrays    | beta.86 | [sql.md](sql.md)                              |

## Config / observability

| Change                                                              | Since   | Skill impact                         |
| ------------------------------------------------------------------- | ------- | ------------------------------------ |
| `Config.withDefault` no longer masks filter failures                | beta.84 | Invalid present config fails         |
| Missing array values in `Config.schema` are treated as missing data | beta.90 | Defaults can apply to missing arrays |
| `Otlp.layerFromConfig` from `OTEL_*` env vars                       | beta.82 | [opentelemetry.md](opentelemetry.md) |
| OtlpTracer renders causes in exception events                       | beta.89 | Better trace diagnostics             |

## CLI / other

| Change                                                              | Since      | Skill impact                        |
| ------------------------------------------------------------------- | ---------- | ----------------------------------- |
| `Command.withHidden` (→ `unlisted` at beta.104), `Flag.withHidden`  | beta.69–70 | Hidden subcommands/flags            |
| `Schedule.tap` — observe schedule metadata                          | beta.71    | [schedule.md](../retry/schedule.md) |
| `Schedule.andThenResult` (→ `concatResult` at beta.104)             | beta.91    | [schedule.md](../retry/schedule.md) |
| `Stream.broadcastN`                                                 | beta.68    | Fan-out streams                     |
| `@effect/vitest` forked memo maps for nested `it.layer`             | beta.67    | Test isolation                      |
| `Latch.isOpen()` returns the current latch state                    | beta.88    | Coordination checks                 |
| `String.configCase`; numeric segments fixed in camel/pascal case    | beta.91    | Config key formatting               |
| `Cron.next` no longer skips earlier matching days on month overflow | beta.86    | Scheduled jobs                      |

When pinning a new release, bump the baseline at the top of this file and the dedicated `effect`
entry in `metadata/skill-sources.md` after source and snippet validation. Read the version off the
consumer's lockfile with the gate in [consumer-versions.md](consumer-versions.md) rather than
recording it here.
