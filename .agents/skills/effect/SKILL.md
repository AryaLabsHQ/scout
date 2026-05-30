---
name: effect
description: "Use when working with Effect-TS v4 (effect@4.0.0-beta.x) - a functional programming library for TypeScript. Covers Effect, Option, Result (renamed from Either), Context, Layer, Stream, Schedule, Schema, and ecosystem packages. Triggers on: effect v4, effect-smol, effect/unstable/* imports, Context.Service (replaces v3 Context.Tag/GenericTag/Effect.Tag), httpapi-seams, integration seam, tracer bullet, HttpApiMiddleware, effect-native architecture / app structure, three-slot DI, Environment Context.Reference, AppConfig, catchDbErrors, RequestContext seam, Layer.buildWithMemoMap, @effect/vitest v4, Result (instead of Either), Effect.catch (instead of catchAll), Effect.forkChild (instead of fork), Effect.tx / Effect.txRetry (replace v3 STM.commit/retry), Tx* primitives (TxRef/TxHashMap/TxQueue replace v3 TRef/TMap/TQueue), drizzle-orm/effect-postgres / PgDrizzle.make / EffectPgDatabase / defineRelations (Drizzle 1.0 + Effect integration), @effect/sql-pg. Do NOT use for effect 3.x / @effect/platform as a separate package / Context.Tag class syntax / Either — use the `effect-v3` skill instead."
---

# Effect-TS v4 Skill

Decision tree for finding the right Effect pattern. See `references/` for topic docs.

**Implementation Source:** All patterns in this skill reference the official Effect v4 implementation at `~/Developer/effect/packages/effect/src/`. When in doubt, check the source files directly.

Version marker: effect `4.0.0-beta.74` (reconcile against `~/Developer/effect` at HEAD), TypeScript `5.8+`.

Beta changes after beta.66: [references/ecosystem/v4-beta-deltas.md](references/ecosystem/v4-beta-deltas.md).

## Canonical Setup

- Core install: `npm install effect@4`
- Add runtime / integration packages as needed: `@effect/platform-node`, `@effect/platform-bun`, `@effect/platform-browser`, `@effect/platform-node-shared`, `@effect/vitest`, `@effect/opentelemetry`, `@effect/sql-*`, `@effect/ai-*`, `@effect/atom-*`
- Platform HTTP from: `effect/unstable/http`
- Keep all `@effect/*` packages and `effect` on a compatible release line

## Style Rule: Use Effect Directly

Effect is already the abstraction layer. Prefer Effect's public primitives
directly: `Effect.gen`, `Context.Service`, `Layer`, `Effect.catchTag` /
`Effect.catchTags`, `Effect.run*`, `ScopedCache`, `Schedule`, and the relevant
`effect/unstable/*` modules.

Do not build project-local helper frameworks that hide Effect control flow,
dependency access, runtime boundaries, or typed error handling. A little
duplication is usually better than a helper that forces readers to understand
both Effect and a project-specific wrapper.

Create a local helper only when it captures a repeated domain concept or a real
interop boundary. Migration facades should have an exit plan: once callers are
Effect-aware, delete the facade and use the Effect service or primitive
directly.

## Style Rule: Let Schema Own Wire Encoding

Use Effect Schema codecs at JSON, HTTP, OpenAPI, and persistence boundaries so
domain code can keep semantic runtime types. Schema is the DTO when the only
transformation is wire encoding.

For example, prefer a Date-backed schema over manually converting every row to
an ISO string:

```ts
import { Schema } from "effect";

export const ISODateTime = Schema.DateFromString.annotate({
  identifier: "ISODateTime",
});

export const Entry = Schema.Struct({
  id: Schema.String,
  occurredAt: ISODateTime,
  title: Schema.String,
});

type Entry = typeof Entry.Type;
// occurredAt: Date inside the application
// occurredAt: string at the JSON/OpenAPI boundary
```

When a database projection already matches the public schema shape, return that
projection directly:

```ts
const rows: ReadonlyArray<Entry> = yield* db
  .select({
    id: entries.id,
    occurredAt: entries.occurredAt,
    title: entries.title,
  })
  .from(entries);

return { entries: rows };
```

Do not add DTO mappers whose only job is `date.toISOString()`. Add a mapper only
for real transformation: renaming fields, nesting child rows, deriving values,
redacting private data, extracting typed metadata, or crossing a non-HTTP
boundary such as an AI prompt, export file, log payload, webhook, or third-party
SDK.

```ts
const promptInput = {
  ...entry,
  occurredAt: entry.occurredAt.toISOString(),
};
```

## Style Rule: Effect.gen vs .pipe

Use `Effect.gen` for business logic: dependency access, conditional logic,
sequential operations, multi-step workflows, and named intermediate values.

Use `.pipe` for composition: error handling, tracing/spans, retries, layer
building, simple transforms with `Effect.map`, and cross-cutting concerns around
an already-defined effect.

Preferred shape: business flow inside `Effect.gen`, operational behavior outside
with `.pipe(...)`.

## Quality Gate

Before declaring Effect-heavy work done, check:

- Is Effect itself the abstraction, or did the change add a project-local helper
  that hides control flow, dependency access, runtime boundaries, or typed
  errors?
- Are service definitions owned once with `Context.Service` and provided through
  explicit `Layer` construction?
- Are request/runtime boundaries explicit, with `Effect.run*` only at real JS or
  framework edges?
- Are Promise wrappers limited to unavoidable Promise-only foreign APIs?
- If an Effect-native integration exists, did the code use it directly?
- Are typed failures preserved with tagged errors and `Effect.catchTag` /
  `Effect.catchTags` rather than broad catch-and-fallback logic?
- Did cleanup include grep proof for removed wrappers, shims, duplicate service
  tags, legacy helpers, or old v3 names?
- For HttpApi integration work: is there a named **seam** and **tracer test**
  (see `references/ecosystem/httpapi-seams.md`)?

Use `how` before changing unfamiliar Effect subsystems. Use `why` before
preserving or deleting suspicious historical wrappers.

## Module Map (Topic -> Package)

| Topic                                                | Source package(s)                        |
| ---------------------------------------------------- | ---------------------------------------- |
| Core effect model, fibers, Layer, Context, Schema | `effect`                                 |
| HTTP server/client/router                            | `effect/unstable/http` + runtime adapter |
| Typed HTTP APIs / clients / OpenAPI                  | `effect/unstable/httpapi` + runtime adapter |
| SQL + drivers                                        | `effect/unstable/sql` + driver packages  |
| Drizzle ORM (Effect integration)                     | `drizzle-orm/effect-postgres` + `@effect/sql-pg` |
| AI providers + models                                | `effect/unstable/ai` + provider packages |
| CLI                                                  | `effect/unstable/cli`                    |
| Cluster                                              | `effect/unstable/cluster`              |
| Reactivity / Atom core                               | `effect/unstable/reactivity`             |
| OpenTelemetry integration                            | `@effect/opentelemetry`                  |
| Testing                                              | `@effect/vitest`                         |
| Atom framework bindings                              | `@effect/atom-react`, `@effect/atom-solid`, `@effect/atom-vue` |

**Key imports**: HTTP, HTTP API, CLI, SQL core, AI core, and reactivity come from `effect/unstable/*`. Runtime adapters, provider implementations, SQL drivers, testing, OpenTelemetry, and framework bindings remain separate `@effect/*` packages.

## Minimal App Skeleton (Node)

```ts
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { createServer } from "node:http";

// Define routes using HttpRouter.addAll with route definitions
const routes = HttpRouter.addAll([
  HttpRouter.route(
    "GET",
    "/hello",
    Effect.succeed(HttpServerResponse.text("Hello, World!")),
  ),
]);

// Create the HTTP server layer
// HttpRouter.serve takes a routes Layer and returns a Layer
const HttpServerLive = Layer.mergeAll(
  NodeHttpServer.layer(() => createServer(), { port: 3000 }),
  HttpRouter.serve(routes),
);

// Launch the server using Layer.launch and NodeRuntime.runMain
NodeRuntime.runMain(Layer.launch(HttpServerLive));
```

Install: `npm install effect @effect/platform-node`

## Quick Decision Trees

### "I need to structure an Effect application"

```
Structuring an app / service / DI / migrating to Effect-native?
├─ Service shape, three-slot DI, errors, persistence, naming → references/patterns/effect-native-architecture.md
├─ HTTP layer (groups→handlers→services, middleware order, RequestContext) → references/ecosystem/httpapi-seams.md
├─ Cloudflare Worker host (bindings, queues, workflows, test tiers) → cloudflare skill: references/workers/effect-worker-seams.md
└─ Full migration sequence + repo exemplars → the architecture playbook the maintaining org keeps with its repos
```

### "I need to create an effect"

```
Create Effect?
├─ Synchronous success → Effect.succeed(value)
├─ Synchronous failure → Effect.fail(error)
├─ From try-catch (sync) → Effect.try({ try: ..., catch: ... })
├─ From unavoidable Promise-only API → Effect.tryPromise({ try: ..., catch: ... })
├─ Lazy sync computation → Effect.sync(() => compute())
└─ Defer creation until runtime → Effect.suspend(() => effect)
```

If an Effect-native integration exists, use it instead of wrapping a Promise API
with `Effect.tryPromise`.

### "I need to run the effect"

```
Run Effect (Program Boundary)?
├─ Synchronous (no async boundaries) → Effect.runSync(effect)
├─ As Promise → await Effect.runPromise(effect)
├─ As Promise with Exit (no throw) → Effect.runPromiseExit(effect)
├─ Keep full Exit (sync only) → Effect.runSyncExit(effect)
└─ Run in background fiber from JS boundary → Effect.runFork(effect)
```

`Effect.runSync` / `Effect.runSyncExit` are only for fully synchronous effects.

### "I need to chain/transform effects"

```
Chain Operations?
├─ Sequential business workflow → Effect.gen(function*() { ... })
├─ Branching / conditionals → Effect.gen with normal if/else
├─ Map one success value → .pipe(Effect.map(f))
├─ Chain from only the previous value → .pipe(Effect.flatMap(f))
├─ Add cross-cutting behavior → .pipe(Effect.retry(...), Effect.catchTag(...), Effect.withSpan(...))
└─ Keep only values matching predicate → .pipe(Effect.filterOrFail(predicate, () => error))
```

### "I need to handle errors"

```
Error Handling?
├─ Catch all typed errors → .pipe(Effect.catch(f))
├─ Catch specific tagged error → .pipe(Effect.catchTag("TagName", f))
├─ Catch by predicate → .pipe(Effect.catchIf((e) => predicate(e), f))
├─ Convert to Result → Effect.result(effect)
├─ Convert to Option (drop error) → Effect.option(effect)
├─ Handle defects (dies) → .pipe(Effect.catchDefect(f))
└─ Observe full success/failure/defect → Effect.exit(effect)
```

Note: v4 renamed `catchAll`→`catch`, `catchAllCause`→`catchCause`, `catchAllDefect`→`catchDefect`, `catchSome`→`catchFilter`, `catchSomeCause`→`catchCauseFilter`. `catchSomeDefect` is removed. `Effect.catchIf` provides predicate-based error handling.

### "I need dependency injection"

```
Dependency Injection (Service Definition)?
├─ Function syntax → Context.Service<Interface>("Name")
└─ Class syntax → class S extends Context.Service<S, Shape>()("Name") {}

Dependency Injection (Provisioning)?
├─ Build simple layer → Layer.succeed(MyService, impl)
├─ Build effectful layer → Layer.effect(MyService, effect)
├─ Scoped acquisition/release → Layer.effect(MyService, Effect.acquireRelease(acquireEffect, release))
└─ Override for tests → program.pipe(Effect.provide(testLayer))
```

Note: v4 unifies v3's `Context.Tag` / `Context.GenericTag` / `Effect.Tag` into a single `Context.Service`. `Context.Reference` is unchanged from v3.

### "I need dependency injection with effectful construction"

```
Service with Effectful Constructor?
└─ Class with make → class S extends Context.Service<S, Shape>()("Name", { make: Effect.gen(function*() { ... }) }) {}
```

The `make` option provides the service implementation via an effect, enabling dependency chains.

### "I need to access services in context"

```
Access Services?
├─ Get all services as Context → Effect.context<R>()
├─ Transform with all services → Effect.contextWith((ctx) => ...)
├─ Get specific service → yield* MyService
├─ Provide services to effect → Effect.provideContext(effect, ctx)
├─ Get service by key → Effect.service(MyService)
├─ Get optional service by key → Effect.serviceOption(MyService)
└─ Check if service exists → Context.getOption(ctx, MyService)
```

Note: `Effect.context<R>()` replaces runtime-based environment inspection. Prefer `yield* MyService` in normal effect code and use `Effect.context` / `Effect.provideContext` only when you explicitly need the whole `Context`.

### "I need to create a named effect function"

```
Named Effect Function?
├─ Basic named function → Effect.fn("name", function*(args) { ... })
├─ With call-site transformers → Effect.fn("name")(function* (args) { ... }, Effect.retry(schedule))
├─ Untraced for performance → Effect.fnUntraced(function*(args) { ... })
└─ With argument types → const fn = Effect.fn("name")<Args, Ret, Err>(function*(args) { ... })
```

**Why use Effect.fn?**

- Names appear in fiber dumps, stack traces, and tracing tools
- Better debugging experience when effects fail
- Self-documenting code

**Example from real-world projects:**

```ts
const fetchData = Effect.fn("Api.fetchData")(function* (url: string) {
  const response = yield* http.get(url);
  return yield* response.json;
});
```

**Source:** `effect/Effect.ts` - see `~/Developer/effect/packages/effect/src/Effect.ts`

### "I need concurrency"

```
Concurrency?
├─ Fork computation → Effect.forkChild(effect)
├─ Fork and detach (daemon) → Effect.forkDetach(effect)
├─ Join fiber result → Fiber.join(fiber)
├─ Create deferred signal → Deferred.make<A, E>()
├─ Complete deferred with Effect → Deferred.complete(deferred, effect)
├─ Shared mutable cell → Ref.make(initial)
└─ Atomic update → Ref.update(ref, f)
```

Note: v4 renamed `fork`→`forkChild`, `forkDaemon`→`forkDetach`.

### "I need resource safety"

```
Resource Safety?
├─ Acquire/release resource → Effect.acquireRelease(acquire, release)
├─ Acquire/use/release in one block → Effect.acquireUseRelease(acquire, use, release)
├─ Run workflow in a managed scope → effect.pipe(Effect.scoped)
└─ Provide scoped service dependency → Layer.effect(Tag, Effect.acquireRelease(acquire, release))
```

### "I need retry logic"

```
Retry?
├─ Exponential backoff → Schedule.exponential("100 millis")
├─ Fixed spacing → Schedule.spaced("30 seconds")
├─ Limit attempts → Schedule.recurs(5)
├─ Retry forever → Schedule.forever
├─ Add jitter → Schedule.jittered(Schedule.exponential("100 millis"))
└─ Apply policy → effect.pipe(Effect.retry(schedule))
```

Note: `jittered` is a schedule transformer, not a standalone schedule. It wraps an existing schedule and adds random jitter (80%-120% of delay).

### "I need optional values"

```
Option?
├─ Create Some → Option.some(value)
├─ Create None → Option.none()
├─ From nullable → Option.fromNullishOr(value)
├─ Transform → Option.map(option, f)
├─ Chain → Option.flatMap(option, f)
├─ Get default → Option.getOrElse(option, () => fallback)
└─ Pattern match → Option.match(option, { onSome, onNone })
```

### "I need typed error/success with Result"

```
Result (renamed from Either)?
├─ Success → Result.succeed(value)
├─ Failure → Result.fail(error)
├─ Transform Success → Result.map(result, f)
├─ Chain Success → Result.flatMap(result, f)
├─ Get default from Failure → Result.getOrElse(result, onFailure)
├─ Pattern match → Result.match(result, { onSuccess, onFailure })
└─ Convert Effect to Result → Effect.result(effect)
```

### "I need streaming"

```
Streaming?
├─ Create from iterable → Stream.fromIterable(values)
├─ Create from Effect → Stream.fromEffect(effect)
├─ Transform elements → Stream.map(stream, f)
├─ Effectful transform → Stream.flatMap(stream, f)
├─ Limit size → Stream.take(stream, n)
├─ Collect output → Stream.runCollect(stream)
└─ Consume with Sink → Stream.run(stream, sink)
```

### "I need queue backpressure"

```
Queue?
├─ No capacity limit → Queue.unbounded<A>()
├─ Backpressure when full → Queue.bounded<A>(n)
├─ Drop new values when full → Queue.dropping<A>(n)
├─ Drop oldest values when full → Queue.sliding<A>(n)
└─ Consume items → Queue.take(queue) / Queue.takeAll(queue)
```

### "I need request batching / N+1 avoidance"

```
Request / RequestResolver?
├─ Define request type → class Req extends Request.Class("Req")<A, E, Fields>() {}
├─ Resolve one request → RequestResolver.fromEffect((request) => effect)
├─ Resolve a batch → RequestResolver.fromFunctionBatched((requests) => results)
├─ Execute through resolver → Effect.request(request, resolver)
└─ Reference → references/core/request.md
```

### "I need transactional state"

```
Transactions?
├─ Transaction boundary → Effect.tx(effect)
├─ Retry transaction until touched state changes → Effect.txRetry
├─ Transactional ref → TxRef.make(initial)
├─ Transactional map/set → TxHashMap / TxHashSet
├─ Transactional queue/pubsub → TxQueue / TxPubSub
└─ Reference → references/core/stm.md
```

### "I need explicit runtime control"

```
Runtime Control?
├─ App entrypoint run → NodeRuntime.runMain / BunRuntime.runMain
├─ Sync run → Effect.runSync(effect)
├─ Promise run → Effect.runPromise(effect)
├─ Promise run with services → Effect.runPromiseWith(services)(effect)
├─ Fork with explicit context → Effect.runForkWith(services)(effect)
└─ Run and get Exit → Effect.runPromiseExit(effect)
```

Note: `Runtime<R>` is removed in v4. Use `Effect.run*` directly. All `run*` functions have `*With` variants for providing services.

Do not introduce project-local runner helpers unless they are a temporary
interop boundary for non-Effect callers. Prefer `Effect.run*` and `Effect.run*With`
directly at the actual program boundary.

### "I need logging/tracing"

```
Observability?
├─ Log structured messages → Effect.logInfo / logDebug / logError
├─ Add log fields → Effect.annotateLogs({ ... })
├─ Span around effect → Effect.withSpan("name", ...)
└─ Add span/log context → Effect.withLogSpan("name") / Effect.annotateCurrentSpan({ ... })
```

### "I need schema decoding/validation"

```
Schema?
├─ Decode unknown external input → Schema.decodeUnknownEffect(schema)(input)
├─ Sync decode unknown (throw on invalid) → Schema.decodeUnknownSync(schema)(input)
├─ Decode already-typed internal value → Schema.decodeEffect(schema)(value)
├─ Sync decode typed internal value → Schema.decodeSync(schema)(value)
├─ Validate already-decoded type → Schema.is(schema)(value)
├─ Encode typed value to unknown → Schema.encodeEffect(schema)(value)
└─ Sync encode typed value → Schema.encodeSync(schema)(value)
```

Note: `Schema.encode` exists but is a transformation helper for building schema transforms, not the serialization function. Use `Schema.encodeEffect` or `Schema.encodeSync` for actual encoding.

### "I need HTTP server/client"

```
HTTP Platform (v4)?
├─ HTTP server → build routes with HttpRouter.*, serve with HttpRouter.serve
├─ HTTP client → HttpClient.execute(HttpClientRequest.get("/path"))
├─ Status code handling → HttpClientResponse.matchStatus({ "200": successHandler, "404": notFoundHandler })
├─ Typed API contract → HttpApi / HttpApiGroup / HttpApiEndpoint from effect/unstable/httpapi
├─ Middleware stack / integration order / tracer TDD → references/ecosystem/httpapi-seams.md
├─ Typed client/server → HttpApiClient / HttpApiBuilder from effect/unstable/httpapi
├─ Platform runtime → provide NodeHttpServer.layer / BunHttpServer.layer
└─ Note: @effect/platform is removed; use effect/unstable/http + runtime adapter
```

### "I need an ecosystem package"

```
Ecosystem Routing?
├─ Typed SQL + driver layers → effect/unstable/sql (+ driver package)
├─ Drizzle ORM with Effect → drizzle-orm/effect-postgres (+ @effect/sql-pg)
├─ AI provider-agnostic LLM/embeddings → effect/unstable/ai (+ provider package)
├─ Typed HTTP API contracts → effect/unstable/httpapi
├─ HttpApi middleware stack / tracer TDD / contract-vs-live → references/ecosystem/httpapi-seams.md
├─ Reactive Atom state → effect/unstable/reactivity (+ @effect/atom-* bindings)
├─ CLI commands/args/prompts → effect/unstable/cli
├─ OpenTelemetry tracing/metrics → @effect/opentelemetry
└─ Testing Effect code → @effect/vitest
```

### "I need branded types"

```
Branded Types?
├─ Branded string → Schema.String.pipe(Schema.brand("Name"))
├─ With validation → Schema.String.pipe(Schema.check(...), Schema.brand("Email"))
└─ With methods → Object.assign(brandedSchema, { fromUrl(url) { ... } })
```

### "I need pattern matching"

```
Pattern Matching (Match)?
├─ Exhaustive on tagged unions → Match.valueTags(value, { Tag: handler })
└─ Compiled matcher → Match.type<Value>().pipe(Match.tag("Tag", ...), Match.exhaustive)
```

### "I need testing (Vitest)"

```
Testing?
├─ Unit test effectful logic → it.effect("name", () => effect)
├─ Live services test (no mocks) → it.live("name", () => effect)
├─ Test dependency wiring → provide test Layer overrides
├─ HttpApi in-memory client (selected groups) → HttpApiTest.groups(api, names, { baseUrl? })
├─ Integration seam / middleware order TDD → references/ecosystem/httpapi-seams.md
├─ Test retries/time behavior → use controlled test services (clock/random as needed)
└─ Effect-specific setup/assertion patterns → references/ecosystem/vitest.md
```

## Product Index

### Core

| Topic                                                      | Reference                              |
| ---------------------------------------------------------- | -------------------------------------- |
| Effect (create, run, chain)                                | `references/core/effect.md`            |
| Generator syntax                                           | `references/core/gen.md`               |
| Error handling                                             | `references/core/error-handling.md`    |
| Concurrency (fibers)                                       | `references/core/concurrency.md`       |
| Collections helpers                                        | `references/core/collections.md`       |
| Config / ConfigProvider                                    | `references/core/config.md`            |
| TypeClass (FP abstractions)                                | `references/core/typeclass.md`         |
| Cache                                                      | `references/core/cache.md`             |
| Queue                                                      | `references/core/queue.md`             |
| PubSub                                                     | `references/core/pubsub.md`            |
| Request / RequestResolver                                  | `references/core/request.md`           |
| Metric                                                     | `references/core/metric.md`            |
| STM (Software Transactional Memory)                        | `references/core/stm.md`               |
| Observability (logging, tracing)                           | `references/core/observability.md`     |
| Runtime (run functions)                                    | `references/core/runtime.md`           |
| Advanced runtime (bootstrapping/lifecycle)                 | `references/core/advanced-runtime.md`  |
| Runtime services (Clock/Random/Logger/Tracer)              | `references/core/runtime-services.md`  |
| Service lifecycle (Reloadable/ScopedRef/LayerMap/Redacted) | `references/core/service-lifecycle.md` |
| Coordination (RateLimiter/Mailbox/Cron/ExecutionPlan)      | `references/core/coordination.md`      |
| Match (pattern matching)                                   | `references/core/match.md`             |
| Atom (reactive state)                                      | `references/core/atom.md`              |

### Patterns

| Topic                                                  | Reference                                        |
| ------------------------------------------------------ | ------------------------------------------------ |
| **Effect-native app architecture (service/DI/errors/persistence house style)** | `references/patterns/effect-native-architecture.md` |
| Real-world production patterns                         | `references/patterns/real-world.md`              |
| Service effectification (migrating services to Effect) | `references/patterns/service-effectification.md` |
| Schema patterns + Zod interop (during migration)       | `references/patterns/schema-zod-interop.md`      |
| Async/await migration guide                            | `references/patterns/async-await-migration.md`   |
| Dual API design (Effect + imperative)                  | `references/patterns/dual-api-design.md`         |
| Callback interop (Node.js callbacks)                   | `references/patterns/callback-interop.md`        |
| Testing migration                                      | `references/patterns/testing-migration.md`       |

### Data Types

| Topic                        | Reference                         |
| ---------------------------- | --------------------------------- |
| Option                       | `references/data-types/option.md` |
| Result (renamed from Either) | `references/data-types/result.md` |
| Exit                         | `references/data-types/exit.md`   |
| Data (TaggedEnum, TaggedClass, TaggedError) | `references/data-types/data.md` |

### Dependency Injection

| Topic                                 | Reference                                    |
| ------------------------------------- | -------------------------------------------- |
| Context.Service (v4's Context.Tag) | `references/dependency-injection/service.md` |
| Context                            | `references/dependency-injection/context.md` |
| Layer                                 | `references/dependency-injection/layer.md`   |

### Streaming

| Topic  | Reference                        |
| ------ | -------------------------------- |
| Stream | `references/streaming/stream.md` |
| Sink   | `references/streaming/sink.md`   |

### Retry

| Topic    | Reference                      |
| -------- | ------------------------------ |
| Schedule | `references/retry/schedule.md` |

### Schema

| Topic  | Reference                     |
| ------ | ----------------------------- |
| Schema | `references/schema/schema.md` |

### Ecosystem

| Topic                                                    | Reference                                      |
| -------------------------------------------------------- | ---------------------------------------------- |
| Platform (HTTP server/client) — v4: effect/unstable/http | `references/ecosystem/platform.md`             |
| HttpApi (typed HTTP APIs / clients / OpenAPI)       | `references/ecosystem/httpapi.md`              |
| HttpApi integration seams / tracer order            | `references/ecosystem/httpapi-seams.md`        |
| v4 beta deltas (post–beta.66)                       | `references/ecosystem/v4-beta-deltas.md`       |
| Platform Node runtime package                            | `references/ecosystem/platform-node.md`        |
| Platform Bun runtime package                             | `references/ecosystem/platform-bun.md`         |
| Platform Browser runtime package                         | `references/ecosystem/platform-browser.md`     |
| Platform Node shared utilities                           | `references/ecosystem/platform-node-shared.md` |
| SQL                                                      | `references/ecosystem/sql.md`                  |
| Drizzle ORM (effect-postgres)                            | `references/ecosystem/drizzle.md`              |
| AI                                                       | `references/ecosystem/ai.md`                   |
| CLI                                                      | `references/ecosystem/cli.md`                  |
| RPC                                                      | `references/ecosystem/rpc.md`                  |
| Cluster                                                  | `references/ecosystem/cluster.md`              |
| Workflow                                                 | `references/ecosystem/workflow.md`             |
| OpenTelemetry                                            | `references/ecosystem/opentelemetry.md`        |
| Vitest                                                   | `references/ecosystem/vitest.md`               |

### Not Yet Documented

These `effect/unstable/*` modules ship in v4 but do not yet have reference docs in this skill. Consult the source directly:

| Module          | Source                                              |
| --------------- | --------------------------------------------------- |
| `devtools`      | `packages/effect/src/unstable/devtools`             |
| `encoding`      | `packages/effect/src/unstable/encoding`             |
| `eventlog`      | `packages/effect/src/unstable/eventlog`             |
| `observability` | `packages/effect/src/unstable/observability`        |
| `persistence`   | `packages/effect/src/unstable/persistence`          |
| `process`       | `packages/effect/src/unstable/process`              |
| `socket`        | `packages/effect/src/unstable/socket`               |
| `workers`       | `packages/effect/src/unstable/workers`              |

Paths are relative to the Effect repo (`~/Developer/effect`). The `observability` module here is the unstable package; the documented `references/core/observability.md` covers core logging/tracing primitives.

## Unstable Modules

`effect/unstable/*` modules in v4:

`ai`, `cli`, `cluster`, `devtools`, `encoding`, `eventlog`, `http`, `httpapi`, `observability`, `persistence`, `process`, `reactivity`, `rpc`, `schema`, `socket`, `sql`, `workflow`, `workers`

## Core Principles

- **Effect<A, E, R>**: Computation that can succeed with `A`, fail with `E`, and require `R`
- **Context.Service**: v4's replacement for `Context.Tag` / `Context.GenericTag` — defines typed service identifiers accessed via `yield*`
- **Runtime<R> removed**: Use `Effect.runSync`, `Effect.runPromise`, `Effect.runFork` directly
- **Cause flattened**: `Sequential` / `Parallel` constructors removed; `cause.reasons` for multi-cause inspection
- **Total composition**: Prefer `.pipe(...)` and `Effect.gen` over nested callbacks
- **Typed errors and services**: Encode failures and dependencies in the type system
- **Resource safety**: Use `Scope`, `Layer.effect` with `Effect.acquireRelease`, and managed lifecycles
- **Fibers**: Lightweight concurrent execution with deterministic interruption
