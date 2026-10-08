---
name: effect
description:
  "Effect-TS v4 (stable 4.0.0): Effect, Option, Result, Context.Service, Layer, Stream, Schedule,
  Schema, ByteSize, domain subpaths (effect/http, http-api, net, sql, ai, cli, cluster, rpc, socket,
  workers, encoding, devtools, eventlog, observability, persistence, process, schema, reactivity,
  workflow, testing), root Arbitrary, native SQL/PostgreSQL, and @effect/vitest property tests.
  Covers HttpApi + HttpApiMiddleware seams, three-slot DI, RequestContext, AppConfig, platform
  adapters, Drizzle effect-postgres, and Effect-native TypeScript architecture. Cloudflare Workers
  and workerd fetch hosting belong to cloudflare, TanStack Start dashboards to tanstack-start, and
  subjective naming or abstraction taste to craft."
disable-model-invocation: true
metadata:
  opencode/slash: "true"
  opencode/autoinvoke: "false"
---

# Effect

Read the reference for the task. `~/Developer/effect` is the canonical checkout. For
version-sensitive APIs, check resolved
[consumer dependencies](references/ecosystem/consumer-versions.md) against the
[version lineage and deltas](references/ecosystem/v4-beta-deltas.md). This skill documents
`effect@4.0.0`; code still on a 4.0.0 beta or RC needs the lineage page.

## Core defaults

Defaults for new Effect code. Established project conventions win unless the task is explicitly
changing them.

**Composition.** `Effect.gen` for business flow. `.pipe` for cross-cutting behavior around an
already-defined effect. See [gen.md](references/core/gen.md).

**Services.** One per file, namespace-module style. File-local `Interface`, `Service` as
`Context.Service<Service, Interface>()("@app/Name")`, `layer`, and a self-export
`export * as Name from "./name"`. Write the specifier the way the consumer resolves it. Add a `.js`
extension only under NodeNext resolution. See
[service.md](references/dependency-injection/service.md).

**Named effects.** `Effect.fn("Domain.operation")` on every public service method and non-trivial
internal method. `Effect.fnUntraced` only where dropping span metadata is deliberate. See
[gen.md](references/core/gen.md).

**Layers.** `Layer.effect(Service, Effect.gen(...))` returning `Service.of({ ... })`. Hoist
dependencies at the top of the gen. `Layer.mergeAll` and `provideMerge` express real composition.
Never use them as a make-it-compile fix. See [layer.md](references/dependency-injection/layer.md).

**Data and errors.** `Schema.Struct` plus a same-name interface for new models. Do not use
`Schema.Class` or `Schema.TaggedClass` for those models. Use `Schema.TaggedError` for typed errors.
Recover with `Effect.catchTag` or `catchTags`. Do not recover at the cause level. Do not use
`as any`, non-null assertions, or unchecked casts. See [schema.md](references/schema/schema.md) and
[error-handling.md](references/core/error-handling.md).

**Boundaries.** Decode unknown input with `Schema.decodeUnknownEffect`. Read runtime config through
`Config` recipes in layers. Never read `process.env` in application logic. Keep HTTP handlers thin.
Wrap SDKs, CLIs, and HTTP clients in named effects at adapter boundaries. Keep provider and network
calls outside authoritative database transactions. See
[httpapi-seams.md](references/ecosystem/httpapi-seams.md).

**Authority.** Never hide required authority behind a `Context.Reference` default. Credentials,
persistence, transports, and external services are required authority. The three-slot `Environment`
is the documented exception. It is a throwing default filled once by the host entry. See
[effect-native-architecture.md](references/patterns/effect-native-architecture.md).

**Time, retry, streams, caches, clients.** `Clock` and `DateTime` for workflow-owned time reads.
`Schedule` for retry and backoff. `Stream` for many-valued sources. Keep `Queue`, `PubSub`, and
`SubscriptionRef` private behind stream-exposing interfaces. Build `Cache` once in the owning layer.
Do not hand-roll Map or TTL caches. Use `HttpClient.retryTransient` and `HttpClient.withRateLimiter`
for outgoing HTTP. See [datetime.md](references/core/datetime.md),
[schedule.md](references/retry/schedule.md), [cache.md](references/core/cache.md), and
[platform.md](references/ecosystem/platform.md).

**Tests.** Use `it.effect`, `TestClock`, and deterministic synchronization. Do not use arbitrary
`Effect.sleep`. Tier stubs from `Layer.succeed` to dual-tag `TestService` to `Layer.mock`. See
[vitest.md](references/ecosystem/vitest.md).

## Style posture

Use Effect directly. Effect is already the abstraction layer. Use its public primitives. Do not
build project-local helper frameworks that hide Effect control flow, dependency access, runtime
boundaries, or typed error handling. A little duplication beats a helper that forces readers to
understand both Effect and a project-specific wrapper. Add a local helper only for a repeated domain
concept or a real interop boundary. Give migration facades an exit plan.

Schema owns wire encoding at JSON, HTTP, OpenAPI, and persistence boundaries. See
[schema.md](references/schema/schema.md#let-schema-own-wire-encoding). The done-check for
Effect-heavy work is the quality gate in
[effect-native-architecture.md](references/patterns/effect-native-architecture.md#quality-gate). Use
`how` before changing an unfamiliar Effect subsystem and `why` before preserving or deleting a
suspicious historical wrapper when those skills are available. Otherwise inspect the relevant local
implementation and tests, and use targeted git history for the wrapper decision.

## Where to start

```text
Which layer is the question about?
├─ Consumer version, RC/beta, `effect/unstable/*` import, or lineage question → references/ecosystem/consumer-versions.md and references/ecosystem/v4-beta-deltas.md
├─ App structure → references/patterns/effect-native-architecture.md
├─ HTTP layer. Route by what you have:
│  ├─ HTTP server, client, or router primitives → references/ecosystem/platform.md
│  ├─ typed HttpApi contract, clients, or OpenAPI → references/ecosystem/httpapi.md
│  └─ middleware order, RequestContext, tracer tests → references/ecosystem/httpapi-seams.md
├─ Moving existing code into Effect. Route by what you have:
│  ├─ async/await → references/patterns/async-await-migration.md
│  ├─ Node callbacks → references/patterns/callback-interop.md
│  ├─ Zod schemas → references/patterns/schema-zod-interop.md
│  ├─ an API that must stay callable from non-Effect code → references/patterns/dual-api-design.md
│  └─ tests → references/patterns/testing-migration.md
├─ A specific module, primitive, or ecosystem package → the Product index below
├─ An additional root `effect` utility/data module  → references/core/root-modules.md
├─ A domain subpath not listed in the index         → references/ecosystem/unstable.md
├─ Cloudflare Worker host → the cloudflare skill. Module scope holds inert descriptions only.
├─ TanStack Start and AtomHttpApi dashboard client → the tanstack-start skill
└─ Subjective taste → the craft skill
```

## Product index

Paths are repo-relative to this skill directory, so they open as written. An empty Package cell
means the root `effect` package. `none` means the row is not tied to one package.

| Topic                                                  | Package                                         | Reference                                           |
| ------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------- |
| Effect: create, run, chain                             |                                                 | `references/core/effect.md`                         |
| Additional root utilities and data modules             |                                                 | `references/core/root-modules.md`                   |
| Generator syntax, `Effect.fn` named functions          |                                                 | `references/core/gen.md`                            |
| Error handling, `catch*` family, `Cause`               |                                                 | `references/core/error-handling.md`                 |
| Concurrency: fibers, `Deferred`, `Ref`                 |                                                 | `references/core/concurrency.md`                    |
| Collections, Chunk, Channel                            |                                                 | `references/core/collections.md`                    |
| Config / ConfigProvider                                |                                                 | `references/core/config.md`                         |
| ByteSize: exact byte values and config/schema codecs   |                                                 | `references/core/byte-size.md`                      |
| TypeClass FP abstractions                              |                                                 | `references/core/typeclass.md`                      |
| Cache, memoization                                     |                                                 | `references/core/cache.md`                          |
| Queue backpressure                                     |                                                 | `references/core/queue.md`                          |
| PubSub                                                 |                                                 | `references/core/pubsub.md`                         |
| Request / RequestResolver, N+1 batching                |                                                 | `references/core/request.md`                        |
| Metric                                                 |                                                 | `references/core/metric.md`                         |
| Transactional state: `Effect.tx`, `TxRef`, `TxHashMap` |                                                 | `references/core/stm.md`                            |
| Clock, DateTime, TestClock                             |                                                 | `references/core/datetime.md`                       |
| Observability: logging, tracing, spans                 |                                                 | `references/core/observability.md`                  |
| Runtime: `Effect.run*` program boundaries              |                                                 | `references/core/runtime.md`                        |
| Advanced runtime: bootstrapping, lifecycle             |                                                 | `references/core/advanced-runtime.md`               |
| Runtime services: Clock, Random, Logger, Tracer        |                                                 | `references/core/runtime-services.md`               |
| Service lifecycle, `Pool`, `LayerMap`, `Redacted`      |                                                 | `references/core/service-lifecycle.md`              |
| Coordination: RateLimiter, Cron, ExecutionPlan         |                                                 | `references/core/coordination.md`                   |
| Match: pattern matching                                |                                                 | `references/core/match.md`                          |
| Option                                                 |                                                 | `references/data-types/option.md`                   |
| Result                                                 |                                                 | `references/data-types/result.md`                   |
| Exit                                                   |                                                 | `references/data-types/exit.md`                     |
| Data: TaggedEnum, TaggedClass, TaggedError             |                                                 | `references/data-types/data.md`                     |
| Context.Service                                        |                                                 | `references/dependency-injection/service.md`        |
| Context                                                |                                                 | `references/dependency-injection/context.md`        |
| Layer                                                  |                                                 | `references/dependency-injection/layer.md`          |
| Stream                                                 |                                                 | `references/streaming/stream.md`                    |
| Sink                                                   |                                                 | `references/streaming/sink.md`                      |
| Schedule: retry, repeat, backoff                       |                                                 | `references/retry/schedule.md`                      |
| Schema: records, brands, variants, wire encoding       |                                                 | `references/schema/schema.md`                       |
| Schema representation, revivers, codegen               |                                                 | `references/schema/schema.md`                       |
| Atom reactive state                                    | `effect/reactivity`, `@effect/atom-*`           | `references/core/atom.md`                           |
| HTTP server, client, router                            | `effect/http` plus adapter                      | `references/ecosystem/platform.md`                  |
| Typed HTTP APIs, clients, OpenAPI                      | `effect/http-api` plus adapter                  | `references/ecosystem/httpapi.md`                   |
| HttpApi seams, middleware order, tracer tests          | `effect/http-api`                               | `references/ecosystem/httpapi-seams.md`             |
| SQL and drivers                                        | `effect/sql` plus driver                        | `references/ecosystem/sql.md`                       |
| Drizzle ORM                                            | `drizzle-orm/effect-postgres`, `@effect/sql-pg` | `references/ecosystem/drizzle.md`                   |
| AI providers and models                                | `effect/ai` plus provider                       | `references/ecosystem/ai.md`                        |
| CLI commands, args, prompts                            | `effect/cli`                                    | `references/ecosystem/cli.md`                       |
| RPC                                                    | `effect/rpc`                                    | `references/ecosystem/rpc.md`                       |
| Cluster                                                | `effect/cluster`                                | `references/ecosystem/cluster.md`                   |
| Workflow                                               | `effect/workflow`                               | `references/ecosystem/workflow.md`                  |
| Node runtime adapter                                   | `@effect/platform-node`                         | `references/ecosystem/platform-node.md`             |
| Bun runtime adapter                                    | `@effect/platform-bun`                          | `references/ecosystem/platform-bun.md`              |
| Browser runtime adapter                                | `@effect/platform-browser`                      | `references/ecosystem/platform-browser.md`          |
| Deno runtime adapter                                   | `@effect/platform-deno`                         | `references/ecosystem/platform-deno.md`             |
| Node shared utilities                                  | `@effect/platform-node-shared`                  | `references/ecosystem/platform-node-shared.md`      |
| Pull-based sockets and TLS upgrades                    | `effect/socket`                                 | `references/ecosystem/socket.md`                    |
| OpenTelemetry tracing and metrics                      | `@effect/opentelemetry`                         | `references/ecosystem/opentelemetry.md`             |
| Testing Effect code                                    | `@effect/vitest`                                | `references/ecosystem/vitest.md`                    |
| Native Arbitrary and property testing                  | `effect/Arbitrary`, `@effect/vitest`            | `references/ecosystem/arbitrary.md`                 |
| Worker clients and runners                             | `effect/workers`                                | `references/ecosystem/workers.md`                   |
| Version lineage and prerelease deltas                  | none                                            | `references/ecosystem/v4-beta-deltas.md`            |
| Resolved dependencies and alignment                    | none                                            | `references/ecosystem/consumer-versions.md`         |
| Effect-native app architecture, quality gate           | none                                            | `references/patterns/effect-native-architecture.md` |
| Real-world production patterns                         | none                                            | `references/patterns/real-world.md`                 |
| Service effectification                                | none                                            | `references/patterns/service-effectification.md`    |
| Schema patterns, Zod interop                           | none                                            | `references/patterns/schema-zod-interop.md`         |
| Async/await migration                                  | none                                            | `references/patterns/async-await-migration.md`      |
| Dual API design: Effect plus imperative                | none                                            | `references/patterns/dual-api-design.md`            |
| Callback interop                                       | none                                            | `references/patterns/callback-interop.md`           |
| Testing migration                                      | none                                            | `references/patterns/testing-migration.md`          |
| TanStack Start and AtomHttpApi dashboard               | `@effect/atom-react`                            | `tanstack-start` skill                              |
| Other domain subpaths                                  | `effect/*` subpaths                             | `references/ecosystem/unstable.md`                  |

### Domain subpaths without a focused reference

At `effect@4.0.0` there is no `effect/unstable/*` export. The domain areas that were unstable
subpaths at RC are top-level `effect/<area>` exports: 19 domain subpaths (`ai`, `cli`, `cluster`,
`devtools`, `encoding`, `eventlog`, `http`, `http-api`, `net`, `observability`, `persistence`,
`process`, `reactivity`, `rpc`, `schema`, `socket`, `sql`, `workers`, `workflow`) plus `testing`.
`Arbitrary` is a root module (`effect/Arbitrary`, `import { Arbitrary } from "effect"`), not a
subpath, and the old `unstable/arbitrary` barrel is gone. The path no longer says "unstable", but
most of these modules still carry `@stability unstable` in their API docs, so minor releases may
break them; root modules without a stability tag follow semver. The index above has focused
references for eleven of them. Eight are routed through
[unstable.md](references/ecosystem/unstable.md): `devtools`, `encoding`, `eventlog`, `net`,
`observability`, `persistence`, `process`, and `schema`. `testing` (`TestClock`, `TestConsole`,
`TestSchema`) is covered by [vitest.md](references/ecosystem/vitest.md) and
[datetime.md](references/core/datetime.md). Read the source under
`~/Developer/effect/packages/effect/src/<area>/` for implementation detail. A
`-> effect/unstable/...` import is an RC-era path; see
[v4-beta-deltas.md](references/ecosystem/v4-beta-deltas.md#rc115--400-stable).

Two of those names collide with documented topics and are not the same thing. `effect/schema` is
`Model` / `VariantSchema` plus the optional JIT/AOT compilers, while core `Schema` lives in the root
`effect` package and is covered by `references/schema/schema.md`. `effect/observability` is not
`references/core/observability.md`. The core file covers logging and tracing primitives.

`effect/encoding` replaces root `effect/Encoding`, which no longer exists. It has dedicated
`Base64`, `Base64Url`, `Hex`, and `EncodingError` modules, plus parse-only `Ini`, `Yaml`, and
`Toml`, `Ndjson`, `Sse`, and `SchemaBinary` for compact schema-derived frames. Use `Ini.parse`,
`Yaml.parse`, and `Toml.parse`, then `Schema.decodeUnknownEffect`. Do not add `yaml`, `toml`, or
`ini` npm packages. Do not invent `Schema.fromYaml`. RPC currently supports JSON, NDJSON, JSON-RPC,
and SchemaBinary; MessagePack was removed. `SchemaBinary.toCodec(schema)` is the binary codec;
`fingerprint: true` is positional and not evolution-safe. JSON wire encoding still belongs to
[schema.md](references/schema/schema.md).
