---
name: effect
description:
  "Use when writing, reviewing, or debugging TypeScript that imports `effect` (v4): services and
  layers, Schema, errors, streams, HttpApi, SQL, CLI, and @effect/vitest tests. Cloudflare hosting
  belongs to cloudflare, TanStack Start to tanstack-start, and naming or abstraction taste to craft."
metadata:
  opencode/slash: "true"
---

# Effect

Read the reference for the task. `~/Developer/effect` is the canonical checkout. For
version-sensitive APIs, check resolved
[consumer dependencies](references/ecosystem/consumer-versions.md) against the
[version lineage and deltas](references/ecosystem/v4-beta-deltas.md). This skill documents
`effect@4.0.6`; a `4.1.x` consumer also applies the
[4.0.6 → 4.1.2 deltas](references/ecosystem/v4-beta-deltas.md#406--412), including the
`effect/crypto` services. Code on an earlier 4.0.x release, beta, or RC needs the lineage page.

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

Use Effect directly; do not build project-local helper frameworks around it. The full posture, and
when to use `how` and `why` before changing or deleting a wrapper, is in
[effect-native-architecture.md](references/patterns/effect-native-architecture.md#0-the-one-rule-the-right-amount-of-effect-native).
Schema owns wire encoding at JSON, HTTP, OpenAPI, and persistence boundaries. See
[schema.md](references/schema/schema.md#let-schema-own-wire-encoding). The done-check for
Effect-heavy work is the quality gate in
[effect-native-architecture.md](references/patterns/effect-native-architecture.md#quality-gate).

## Routing

Read the row that matches the task. Paths are relative to this skill directory.

| Task or symbol                                                                    | Reference                                           |
| --------------------------------------------------------------------------------- | --------------------------------------------------- |
| Consumer version, RC/beta, `effect/unstable/*` import, lineage                    | `references/ecosystem/consumer-versions.md`         |
| Version lineage and prerelease deltas                                             | `references/ecosystem/v4-beta-deltas.md`            |
| App structure, three-slot DI, quality gate                                        | `references/patterns/effect-native-architecture.md` |
| Real-world production patterns                                                    | `references/patterns/real-world.md`                 |
| Service effectification                                                           | `references/patterns/service-effectification.md`    |
| Migrate async/await                                                               | `references/patterns/async-await-migration.md`      |
| Migrate Node callbacks                                                            | `references/patterns/callback-interop.md`           |
| Zod schemas, schema patterns                                                      | `references/patterns/schema-zod-interop.md`         |
| API callable from non-Effect code                                                 | `references/patterns/dual-api-design.md`            |
| Migrate tests                                                                     | `references/patterns/testing-migration.md`          |
| `Effect`: create, run, chain                                                      | `references/core/effect.md`                         |
| `Effect.gen`, `Effect.fn`                                                         | `references/core/gen.md`                            |
| Errors, `catch*` family, `Cause`                                                  | `references/core/error-handling.md`                 |
| Fibers, `Deferred`, `Ref`                                                         | `references/core/concurrency.md`                    |
| `Chunk`, `Channel`, collections                                                   | `references/core/collections.md`                    |
| `Config`, `ConfigProvider`                                                        | `references/core/config.md`                         |
| `ByteSize`                                                                        | `references/core/byte-size.md`                      |
| TypeClass abstractions                                                            | `references/core/typeclass.md`                      |
| `Cache`, memoization                                                              | `references/core/cache.md`                          |
| `Queue` backpressure                                                              | `references/core/queue.md`                          |
| `PubSub`                                                                          | `references/core/pubsub.md`                         |
| `Request`, `RequestResolver`, N+1 batching                                        | `references/core/request.md`                        |
| `Metric`                                                                          | `references/core/metric.md`                         |
| `Effect.tx`, `TxRef`, `TxHashMap`                                                 | `references/core/stm.md`                            |
| `Clock`, `DateTime`, `TestClock`                                                  | `references/core/datetime.md`                       |
| Logging, tracing, spans                                                           | `references/core/observability.md`                  |
| `Effect.run*` program boundaries                                                  | `references/core/runtime.md`                        |
| Runtime bootstrapping, lifecycle                                                  | `references/core/advanced-runtime.md`               |
| Clock, Random, Logger, Tracer services                                            | `references/core/runtime-services.md`               |
| `Pool`, `LayerMap`, `Redacted`                                                    | `references/core/service-lifecycle.md`              |
| `RateLimiter`, `Cron`, `ExecutionPlan`                                            | `references/core/coordination.md`                   |
| `Match`                                                                           | `references/core/match.md`                          |
| Atom state (`effect/reactivity`, `@effect/atom-*`)                                | `references/core/atom.md`                           |
| Other root `effect` utility or data module                                        | `references/core/root-modules.md`                   |
| `Option`                                                                          | `references/data-types/option.md`                   |
| `Result`                                                                          | `references/data-types/result.md`                   |
| `Exit`                                                                            | `references/data-types/exit.md`                     |
| `Data`: TaggedEnum, TaggedClass, TaggedError                                      | `references/data-types/data.md`                     |
| `Context.Service`                                                                 | `references/dependency-injection/service.md`        |
| `Context`                                                                         | `references/dependency-injection/context.md`        |
| `Layer`                                                                           | `references/dependency-injection/layer.md`          |
| `Stream`                                                                          | `references/streaming/stream.md`                    |
| `Sink`                                                                            | `references/streaming/sink.md`                      |
| `Schedule`: retry, repeat, backoff                                                | `references/retry/schedule.md`                      |
| `Schema`: brands, variants, wire encoding, codegen                                | `references/schema/schema.md`                       |
| HTTP server, client, router (`effect/http`)                                       | `references/ecosystem/platform.md`                  |
| HttpApi contracts, clients, OpenAPI                                               | `references/ecosystem/httpapi.md`                   |
| HttpApi middleware order, RequestContext, tracer tests                            | `references/ecosystem/httpapi-seams.md`             |
| `effect/sql` and drivers                                                          | `references/ecosystem/sql.md`                       |
| Drizzle (`drizzle-orm/effect-postgres`, `@effect/sql-pg`)                         | `references/ecosystem/drizzle.md`                   |
| `effect/ai`: models, tools, MCP                                                   | `references/ecosystem/ai.md`                        |
| `effect/cli`                                                                      | `references/ecosystem/cli.md`                       |
| `effect/rpc`                                                                      | `references/ecosystem/rpc.md`                       |
| `effect/cluster`                                                                  | `references/ecosystem/cluster.md`                   |
| `effect/workflow`                                                                 | `references/ecosystem/workflow.md`                  |
| `effect/workers`                                                                  | `references/ecosystem/workers.md`                   |
| `effect/socket`, TLS upgrades                                                     | `references/ecosystem/socket.md`                    |
| `@effect/opentelemetry`                                                           | `references/ecosystem/opentelemetry.md`             |
| `@effect/vitest`                                                                  | `references/ecosystem/vitest.md`                    |
| `effect/Arbitrary`, property tests                                                | `references/ecosystem/arbitrary.md`                 |
| `@effect/platform-node`                                                           | `references/ecosystem/platform-node.md`             |
| `@effect/platform-bun`                                                            | `references/ecosystem/platform-bun.md`              |
| `@effect/platform-browser`                                                        | `references/ecosystem/platform-browser.md`          |
| `@effect/platform-deno`                                                           | `references/ecosystem/platform-deno.md`             |
| `@effect/platform-node-shared`                                                    | `references/ecosystem/platform-node-shared.md`      |
| Other domain subpaths; `effect/schema` and `effect/observability` name collisions | `references/ecosystem/unstable.md`                  |

Outside this skill:

- Cloudflare Worker host → the `cloudflare` skill. Module scope holds inert descriptions only.
- TanStack Start and the AtomHttpApi dashboard client (`@effect/atom-react`) → the `tanstack-start`
  skill.
- Subjective taste → the `craft` skill.
