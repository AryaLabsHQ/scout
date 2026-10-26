# Other domain subpaths (formerly `effect/unstable/*`)

`effect` has no `effect/unstable/*` export. The twenty domain subpaths (`ai`, `cli`, `cluster`,
`devtools`, `encoding`, `eventlog`, `graphql`, `http`, `http-api`, `net`, `observability`,
`persistence`, `process`, `reactivity`, `rpc`, `schema`, `socket`, `sql`, `workers`, `workflow`) and
`testing` are top-level `effect/<area>` exports. `Arbitrary` is a root module, not a subpath. The
filename is kept so existing links resolve; the content is the stable-path routing.

A stable path is not a stable API. Most of these modules still tag their APIs `@stability unstable`
(`~/Developer/effect/MIGRATION.md`, "Unstable Module System"), which allows breaking changes in
minor releases. APIs without a stability tag follow semver. Check the tag on the module before
adopting it in a library with its own compatibility promise.

Focused guides cover `ai`, `cli`, `cluster`, `http`, `http-api`, `reactivity`, `rpc`, `socket`,
`sql`, `workers`, and `workflow`. This page routes the remaining public subpaths to the source-owned
namespace.

| Subpath                | Primary surface                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `effect/devtools`      | `DevTools.layer`, socket/WebSocket tracing, and metrics/span inspection                                                                                            |
| `effect/encoding`      | `Base64`, `Base64Url`, `Hex`, `EncodingError`, `Ini`, `Yaml`, `Toml`, `Ndjson`, `Sse`, `SchemaBinary`, `JsonArray`, `Tar`, `Zip`, and `Xml`                        |
| `effect/eventlog`      | Event groups, journals, replay/remote logs, `EventRow` convergent rows, encryption, and SQL-backed storage                                                         |
| `effect/graphql`       | Experimental typed GraphQL operations: `GraphQL`, `GraphQLGroup`, `GraphQLClient`, `GraphQLProtocol`, `GraphQLResolver`, `GraphQLMiddleware`, `GraphQLClientError` |
| `effect/net`           | `NetAddress`, `IpNetwork`, `IpInterface`, `Host`, `Dns`, and `AddressResolver`                                                                                     |
| `effect/observability` | OTLP JSON/Protobuf serialization, exporters, resources, logs, traces, and Prometheus metrics                                                                       |
| `effect/persistence`   | Persistable values, key-value stores, persisted caches/queues, Redis, rate limiting, and `UserDirectories`                                                         |
| `effect/process`       | `ChildProcess` commands, piping, handles, and the `ChildProcessSpawner` service                                                                                    |
| `effect/schema`        | `Model` variants for database/API shapes, `VariantSchema`, and the `SchemaCompiler`/JIT/AOT compiler modules                                                       |
| `effect/testing`       | `TestClock`, `TestConsole`, and `TestSchema`; see [vitest.md](vitest.md)                                                                                           |

## Practical routing

- Use `effect/encoding/Base64`, `Base64Url`, and `Hex` for byte/text encoding. Each has `encode`,
  `decode` (returns `Result<Uint8Array, EncodingError>`), and `decodeString`; `Hex` also has
  `random(length)`. The root `effect/Encoding` module and its `encodeBase64`/`decodeHex`-style names
  no longer exist; `effect/encoding/EncodingError` names or narrows the failure.
- Use `effect/encoding` `Ini`, `Yaml`, and `Toml` for parse-only configuration formats and
  `SchemaBinary` for schema-derived binary frames. They do not add YAML/TOML/INI npm dependencies or
  replace core JSON codecs. `Base64Url.encodePadded` (and the `padding` option of
  `SchemaGetter.encodeBase64Url`) produce padded URL-safe Base64.
- Streaming codecs are Effect channels, usable with `Stream.pipeThroughChannel`: `Ndjson` (byte
  decoders accept `maxLineBytes`; `NdjsonError.reason` is `InvalidJson`, `InvalidUtf8`, or
  `LineTooLarge`), `Sse`, `JsonArray` (stream the elements of one JSON array, root or by JSON
  Pointer, without buffering), `Tar` (`@stability unstable`), and experimental `Zip` and `Xml`.
  `Xml` and `Zip` can change in patch releases.
- Use `effect/schema/Model` when one field declaration should derive select, insert, update, and
  JSON variants; pair it with `SqlModel` for typed CRUD.
- `effect/schema` also ships optional, `@stability unstable` Schema compilers. Import
  `effect/schema/SchemaJITCompiler/enable` for its side effect before the first schema is used to
  compile decoders lazily; parsing falls back to the interpreter if dynamic function construction is
  blocked. `SchemaAOTCompiler` generates static decoder modules instead. Do not enable either by
  default.
- Use `effect/process` when subprocess lifecycle, piped output, or scoped handles must stay in
  Effect. Platform adapters provide the spawner.
- Use `effect/net` for `NetAddress` / `IpNetwork` / `IpInterface` when server addresses, host
  formatting, or IP interface enumeration must stay typed. Prefer it over ad-hoc `{ host, port }`
  shapes and platform-specific address types. Constructors come in `fromString`, `fromInput`
  (accepts parts or an existing value), and `*Unsafe` forms; `NetAddress.loopbackAddresses` lists
  the loopback addresses.
- `effect/net` `Host` (`DomainName`, `HostPort`, `toFullyQualified`, `toRelative`,
  `parseHostsFile`), `Dns` (service with `lookup`, `resolve` per record type including `TLSA`, and
  `reverse`; `Dns.layerStatic` for fixtures), and `AddressResolver` (resolves `host:port` input to
  socket addresses) are `@stability experimental`. Provide the real `Dns` with `NodeDns.layer`,
  `BunDns.layer`, or `DenoDns.layer`; TLSA queries need Node.js 22.15/23.9+ and fail with
  `Unsupported` on Bun, Deno, and older Node. For UDP see [socket.md](socket.md#udp-datagramsocket).
- `effect/graphql` (`@stability experimental`) models operations as `GraphQL` values grouped with
  `GraphQLGroup.make(...)`; `GraphQLClient.make` builds a typed client over a `GraphQLProtocol`
  (`layerHttp` / `makeHttp`, including subscription transports), `GraphQLResolver` batches lookups,
  and `GraphQLMiddleware` / `GraphQLClientError` cover middleware and failures. The npm package
  `@effect/graphql-generator` generates typed operations from documents. Read
  `~/Developer/effect/packages/effect/src/graphql/` before adopting.
- Use `effect/observability` for OTLP/Prometheus protocol plumbing; use core observability
  references for Effect logging, spans, and tracing primitives. `Otlp.layer`, `layerJson`, and
  `layerProtobuf` take `compression: "gzip" | "none"` (default `"none"`; bodies under 1KB stay
  uncompressed), and `Otlp.layerFromConfig` reads `OTEL_EXPORTER_OTLP_COMPRESSION` and the
  per-signal variants.
- `PersistedQueue.offer(element, { delay })` postpones an element's first delivery (memory, Redis,
  and SQL stores). `UserDirectories` (`layer` / `layerPlatform`) resolves XDG-style `config` /
  `data` / `cache` / `state` directories, e.g. for `KeyValueStore.layerFileSystem`.
- `DevTools.layer` reconnects to the DevTools server every second, so the server may start after the
  app.
- `effect/eventlog` writes batches with the `EventLog` service's `writeMany` (one lock, transaction,
  and journal commit); `EventRow` builds convergent `set` / `patch` / `remove` row events with
  per-field conflict resolution. Compaction helpers are `EventLog.groupCompaction` /
  `groupBatchCompaction`.
- Use `eventlog`, `persistence`, or `devtools` only when their explicit durability, remote-log, or
  inspection boundary is part of the design. Check their `@stability` tags against the installed
  version before adoption.
- `effect/http/Mime` (`getType`, `getExtension`, `getAllExtensions`) is the MIME lookup; it replaced
  the `mime` dependency.

Read the corresponding directory under `~/Developer/effect/packages/effect/src/` for the current
exact signatures. Do not infer APIs from similarly named core or platform modules. RC-era
`effect/unstable/*` paths map to these subpaths by dropping the `unstable/` segment, except
`unstable/httpapi` → `effect/http-api` and `unstable/arbitrary` → root `effect/Arbitrary`; see
[v4-beta-deltas.md](v4-beta-deltas.md#rc115--400-stable).
