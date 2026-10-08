---
name: effect-native-architecture
description:
  The canonical end-state shape for an Effect application — service definitions, the three-slot DI
  model, the DB-error boundary, errors, schema-at-the-seams, and naming/style. Use when structuring
  a new Effect app or migrating one to be Effect-native. Pairs with httpapi-seams.md (API layer) and
  the cloudflare skill's effect-worker-seams.md (Worker host).
---

## Table of Contents

- [0. The one rule: the _right amount_ of Effect-native](#0-the-one-rule-the-right-amount-of-effect-native)
- [1. Service shape — namespace module + `Context.Service`](#1-service-shape--namespace-module--contextservice)
- [2. Dependency injection — the three-slot model](#2-dependency-injection--the-three-slot-model)
- [3. The DB-error boundary — `catchDbErrors`](#3-the-db-error-boundary--catchdberrors)
- [4. Persistence — `effect-postgres` `Database` + query stores](#4-persistence--effect-postgres-database--query-stores)
- [5. Errors — `Schema.TaggedError` + status](#5-errors--schemataggederror--status)
- [6. Schema at the seams — parsers, not post-hoc validators](#6-schema-at-the-seams--parsers-not-post-hoc-validators)
- [7. Config / env — Effect Schema](#7-config--env--effect-schema)
- [8. Naming & style](#8-naming--style)
- [8a. Logging — level and layer](#8a-logging--level-and-layer)
- [9. Anti-patterns (the "don't" list)](#9-anti-patterns-the-dont-list)
- [Quality gate](#quality-gate)
- [Related](#related)

# Effect-native application architecture

The portable, opinionated shape an Effect app converges on. This is the _structure_ layer — how
services, DI, errors, and persistence fit together — not the API primitive reference (see the rest
of this skill for that).

For the HTTP layer (groups → handlers → services, middleware order, the RequestContext seam) see
[httpapi-seams.md](../ecosystem/httpapi-seams.md). For the Cloudflare Worker host (bindings, queues,
workflows, test tiers) see the `cloudflare` skill's `references/workers/effect-worker-seams.md`. For
a full migration sequence and worked exemplars, see the architecture playbook the maintaining org
keeps alongside its repos.

## 0. The one rule: the _right amount_ of Effect-native

Effect-native does **not** mean "everything is an `Effect`." Business logic and IO seams are modeled
in Effect; the messy edges are bridged explicitly and kept thin.

**Model in Effect**

- Business logic / services
- The HTTP API layer (contracts → handlers → services)
- Persistence (a `Database` service + query "stores")
- Provider/integration adapters
- Queue/cron/workflow _handlers_ (the work, not the platform shell)

**Keep at the edge (Promise / raw), bridge explicitly**

- Auth libraries with Promise adapters — keep a Promise DB client for them.
- Platform bindings — read at the call site; don't wrap in a forwarding service.
- Framework entrypoints — `fetch`/`queue`/`scheduled`, workflow step callbacks.

**Do NOT over-Effect**

- No wrappers/helpers/adapters/repositories/runners/façades unless they capture a _repeated domain
  concept_, isolate a _real_ integration boundary, or encode a _cross-cutting policy with multiple
  call sites_. Default: use the framework directly.
- Don't over-name with `Request*` — the request lifecycle is implied by the runtime and Effect
  scoping. `Database`, not `RequestDatabase`; `Environment`/`AppConfig`, not `RequestEnv`.
- Don't schema-validate trusted, typed platform bindings — decode untrusted _strings_ and external
  data, not the binding objects.

## 1. Service shape — namespace module + `Context.Service`

One service per file, with file-local role names (`Interface`, `Service`, `layer`) and the domain
name carried by a namespace self-export:

```ts
// account-service.ts
export interface Interface {
  readonly getById: (
    id: string,
  ) => Effect.Effect<Account | undefined, InternalError, OrganizationContext>;
}

export class Service extends Context.Service<Service, Interface>()("@app/AccountService") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* Database.Service; // ← hoist dependencies here, once
    return Service.of({
      getById: Effect.fn("AccountService.getById")(function* (id: string) {
        const org = yield* OrganizationContext;
        return yield* db.query.accounts.findFirst({
          where: { id, organizationId: org.id },
        });
      }, catchDbErrors), // ← DB-error boundary as 2nd arg
    });
  }),
);

export * as AccountService from "./account-service";
```

```ts
// consumer — siblings import the owning leaf directly
import { AccountService } from "./account-service";

const accounts = yield * AccountService.Service;
const account = yield * accounts.getById(id);
// wiring: Effect.provide(AccountService.layer)
```

Rules:

- File-local `Interface` / `Service` / `layer`; the self-export
  `export * as AccountService from "./account-service"` gives every consumer the same domain-first
  name. Barrels relay it: `export { AccountService } from "./account-service"`. **Never a TypeScript
  `namespace` as the module container** — `export namespace AccountService { … }` is the exact shape
  the self-export replaces, and they are not interchangeable: a namespace is TS-only syntax that a
  plain-erasure toolchain cannot emit, and it nests the domain name inside the file rather than
  letting the module carry it. An ambient `declare namespace` for third-party or JSX runtime types
  is a different construct and is fine. Fall back to a named service class only when the toolchain
  or an existing codebase doesn't support the namespace-module style.
- **Hoist dependencies**: `yield* Database.Service` (and other deps) at the top of the
  `Layer.effect` gen and close over them in the methods. This resolves each dep once and keeps it
  out of every method's inferred `R`. Per-request deps work too because the service layer is rebuilt
  per request (see the DI model below).
- Wrap **every public method and non-trivial internal method** in
  `Effect.fn("Service.method")(genFn, catchDbErrors)` — names the tracing span and attaches the
  DB-error boundary in one place. `Effect.fnUntraced` only where dropping span/stack metadata is
  deliberate (e.g. hot middleware).
- Declare the full method type once in `Interface`; in the implementation, `yield*` ambient/auth
  context (`OrganizationContext`, …) inside the method and let types be inferred — don't re-annotate
  `Effect.Effect<…>` on the gen functions.
- Export only intentional surface; local row codecs, schemas, and helpers stay unexported.

## 2. Dependency injection — the three-slot model

Provide exactly three kinds of thing, each built once at the right lifetime:

| Slot                       | What                                                        | Type                                                                                                      | Lifetime       |
| -------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------- |
| **`Environment`**          | Raw platform bindings (KV, queues, DO namespaces)           | `Context.Reference<Env>` — no production default; the entry fills it once                                 | ambient        |
| **`AppConfig`**            | Decoded **string** config (secrets, URLs, flags-as-strings) | `Context.Service<AppConfig, ServerEnv>`                                                                   | isolate-stable |
| **Typed binding services** | Thin typed wrappers over bindings                           | `QueueService` (`send("email"\|…)`), `WorkflowProducer` (`start("x")`), actor factories, `FlagService`, … | isolate-stable |

```ts
// Environment: a named slot, no production default.
class Environment extends Context.Reference<Environment>()("@app/Environment", {
  defaultValue: (): Env => {
    throw new Error("Environment not provided");
  },
}) {}

// AppConfig: decoded config, NOT the bindings.
class AppConfig extends Context.Service<AppConfig, ServerEnv>()("@app/AppConfig") {}
```

`Context.Reference` in general: use it rarely, and only where a safe default is real (log level,
feature toggles). Never hide required authority — credentials, persistence, transports, external
services — behind a defaultable reference. `Environment` is the documented exception: a named
ambient slot whose default _throws_, filled exactly once per invocation by the host entry.

Two lifetimes, kept distinct:

- **Isolate-stable** (`AppConfig`, `QueueService`, `FlagService`, integration clients like Stripe):
  assembled once into an `AppServices` layer and **hoisted** by services at layer creation — _not_
  rebuilt per request.
- **Per-request** (`Database`, auth service): built once per invocation by a single request
  middleware with a fresh `MemoMap`, then provided to the route.

```ts
// One middleware builds request-scoped services once and provides them.
const Middleware = HttpRouter.middleware<{ provides: MiddlewareServices }>()(
  Effect.fnUntraced(function* (httpEffect) {
    const env = yield* Environment;
    const memoMap = yield* Layer.makeMemoMap;
    const scope = yield* Effect.scope;
    const services = yield* Layer.buildWithMemoMap(servicesLayer(env), memoMap, scope);
    return yield* Effect.provideContext(httpEffect, services);
  }),
);
```

**No module-level pools or client singletons.** Host assembly files may read the Worker `env` to
build layers (`Environment.context(env)` in `fetch`, `AppServices`, `AppConfig`); ordinary app
modules must not create `const stripe = createClient(env...)` or similar singletons. Make those
factories resolved from `AppConfig`. The CF-specific wiring lives in the `cloudflare` skill's
`references/workers/effect-worker-seams.md`.

## 3. The DB-error boundary — `catchDbErrors`

A single transformer maps infrastructure/data failures to a uniform `InternalError` (HTTP 500) at
the **method boundary**, so HTTP endpoints only ever surface their declared domain errors. Apply it
as the **second argument** to the service `Effect.fn`.

```ts
type DbError = EffectDrizzleQueryError | /* SqlError | RowDecodeError */ …

export const catchDbErrors = <A, E, R>(effect: Effect.Effect<A, DbError | E, R>) =>
  effect.pipe(
    Effect.catchTag("EffectDrizzleQueryError", (c) =>
      Effect.fail(new InternalError({ message: c.message })),
    ),
    /* + one of the boundary errors below */
  )
```

**Always catch** `EffectDrizzleQueryError` (the `drizzle-orm/effect-postgres` query failure). Then
add **one** of these depending on your store pattern:

| Add                                               | When                                                                   | Trade-off                                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `SqlError` (`effect/sql/SqlError`)                | Methods can surface the raw driver error; no decode-at-boundary stores | Simpler; but a **connect-time** `SqlError` fires at pool/layer build, _outside_ any per-method scope |
| `RowDecodeError` (your tagged store decode error) | Stores decode rows at the boundary into a tagged error                 | Catches data-corruption per method; pairs with the stores pattern (§4)                               |

> The two exemplar repos diverge here: one catches `EffectDrizzleQueryError | SqlError`, the other
> `EffectDrizzleQueryError | RowDecodeError`. Pick per whether your stores decode at the boundary.
> **Cover connect-time `SqlError` structurally** (a health/org-context integration test that fails a
> real query), not by catching it in every method.

## 4. Persistence — `effect-postgres` `Database` + query stores

```ts
// database.ts — the Service value IS the drizzle client; every query returns an Effect.
export class Service extends Context.Service<Service, DatabaseClient>()("@app/Database") {}

export const layer = (connectionString: string) =>
  Layer.scoped(Service /* PgClient.layer -> PgDrizzle.make({ relations }) */);

export * as Database from "./database";
```

- Use `drizzle-orm/effect-postgres` `PgDrizzle.make({ relations })` over `@effect/sql-pg`
  `PgClient.layer`. `Database.layer(connectionString)` builds a per-scope pool. Drizzle 1.0: one
  `defineRelations(schema, (r) => ({…}))` registry (RQB v2), not per-table `relations()`. See
  [../ecosystem/drizzle.md](../ecosystem/drizzle.md).
- **Stores**: aggregate `*Store` objects for reused/non-trivial SQL. Every method
  `Effect.fn("PostsStore.getByIdForOrg")(…)`; **org-scoped** (first arg `organizationId` / a branded
  `OrgId`); decode rows at the boundary (`decodeRow`/`decodeRows` → a tagged `RowDecodeError`). Keep
  one-off SQL inline in the service.
- **Promise edge for auth**: keep a separate Promise `createDb()` for the auth library's non-Effect
  adapter. Bridge with `runWithDatabase(db, effect)` only when a Promise edge already holds a client
  — don't invent a general runner.
- Test path: a PGlite harness that runs the _real_ `PgClient` path against in-memory Postgres +
  migrations. See [../ecosystem/vitest.md](../ecosystem/vitest.md) and the `cloudflare` skill's
  `references/workers/effect-worker-seams.md` for the workerd tier.

## 5. Errors — `Schema.TaggedError` + status

- Domain/HTTP errors: `Schema.TaggedError` annotated with an HTTP status (`httpApiStatus`). Rich,
  schema-aware, encodable.
- Use `Effect.catch` / `Effect.catchTag` / `Effect.catchTags`; narrow unknowns with `Cause` helpers.
  **Never discard a failure you should handle or die on** — `Effect.catch`, `Effect.option`,
  `Effect.ignore`, `Effect.orElseSucceed`, and blind `mapError` each collapse a typed error channel
  into something no caller can inspect.
- **Genuine absence is a different question, and `Effect.option` is not its tool.** Its signature is
  `Effect<A, E, R> => Effect<Option<A>, never, R>`: it maps _every_ failure to `None`, not only the
  one that means "not there". `FileSystem.stat` fails with a `PlatformError` carrying either a
  `BadArgument` or a `SystemError`, and `SystemErrorTag` alone has eleven values — `NotFound`,
  `PermissionDenied`, `Busy`, `TimedOut`, `InvalidData`, … — so `Effect.option` makes a permissions
  problem indistinguishable from a missing file. To express absence, in order of preference: use an
  API that already returns it (`FileSystem.exists`); or narrow the single error that means absence,
  `Effect.catchTag` / `Effect.catchIf` into `Effect.succeedNone`, and let every other failure stay
  in the channel. For a value that is merely nullable, `Option.fromNullishOr` — that is a data
  question, not an error-channel question.
- Name errors `{Entity}{Reason}Error` — `UserNotFoundError`, `PaymentRequiredError`. One error per
  failure mode; never collapse to a generic `NotFoundError`. One-per-failure-mode is what makes
  `catchTag` usable at the call site.
- Convert an unknown into a typed domain error at the service boundary rather than letting it escape
  untyped:

  ```ts
  Effect.mapError((error) =>
    Cause.isUnknownError(error) ? new InternalError({ message: "..." }) : error,
  );
  ```

- Don't recover from `ParseError`/unsupported platforms — `Effect.die`.
- See [../core/error-handling.md](../core/error-handling.md).

## 6. Schema at the seams — parsers, not post-hoc validators

- Decode external/untrusted data into stronger domain values at every IO seam: HTTP bodies &
  responses, provider/webhook payloads, KV/SQL decoded rows, JWT claims.
- Datetimes: `Schema.DateFromString` so domain code uses `Date` and ISO lives only on the wire.
  **Delete string-branded "ISO" types** — let the codec own the transform.
- Brand IDs/slugs with `Schema.brand(...)` so invariants ride the type.
- See [../schema/schema.md](../schema/schema.md).

## 7. Config / env — Effect Schema

- Validate environment with **Effect Schema** (not Zod) in a dedicated `env` package. One decode
  entry, e.g. `decodeServerEnv(workerEnv)`. Decode **string** vars; ignore bindings (typed platform
  objects, not schema input).
- Keep generated binding types (`wrangler types` / `cf-typegen`) committed and unedited. See
  [../core/config.md](../core/config.md).

## 8. Naming & style

- **`layer`** is the module's default production layer (`AccountService.layer` via the namespace);
  variants get prefixed names inside the module (`layerConfig`, `testLayer`); merged/assembled
  layers get a `*Layer` const suffix (`ApiHandlersLayer`, `MiddlewareLayer`). Third-party layers use
  `.layer` (`PgClient.layer`).
- `Effect.gen` for business logic (sequential steps, named intermediates, `yield* Service`,
  branching). `.pipe(...)` for cross-cutting concerns (`catchTag`, spans/log annotations,
  retries/timeouts, providing layers). Logic in `gen`, operational behavior outside in `pipe`.
- `Option`/`undefined` in domain logic; `Schema.NullOr` only at DB/wire. Don't leak casual `null`.
- Sort with `effect/Order` rather than ad-hoc comparators, so orderings compose:
  `Order.combine(Order.mapInput(Order.Date, (m: Message) => m.createdAt), byPriority)`.
- Import directly from source files; no barrel `index.ts` cross-package re-exports.

## 8a. Logging — level and layer

Logging goes through Effect (`Effect.logInfo` / `logDebug` / `logWarning` / `logError`), never
`console.log`. Beyond that, level and placement are the decisions worth making deliberately:

- **Log mutations at Info.** Any create, update, or delete records what happened with the relevant
  IDs.
- **Log high-frequency reads at Debug.** List queries and lookups use `Effect.logDebug` so they can
  be silenced in production without losing the mutation trail.
- **Log in services, not handlers.** Put logging where the business meaning lives; handlers are a
  transport detail.
- **Annotate spans with contextual IDs** —
  `yield* Effect.annotateCurrentSpan({ messageId, organizationId })` in service methods that own a
  span.

Never log secrets, tokens, or full request/response payloads; log IDs instead. Wide-event shape,
correlation, and redaction policy live in the `logging-best-practices` skill.

## 9. Anti-patterns (the "don't" list)

- `Effect.catch` / `Effect.option` / `Effect.ignore` / `Effect.orElseSucceed` used to discard a
  typed failure; recovering from `ParseError`. Expressing genuine absence is a separate question —
  see §5 for the tools that do it without erasing the error channel.
- Module-level pools or client singletons created from env outside host assembly; wrapper services
  that only forward a binding.
- `as` casts on IO results (`response.json() as T`, SQL rows, KV values); `any`; dynamic `import()`
  for app modules.
- Local wrappers/helpers/runners without a real repeated/boundary/policy justification.
- Over-naming with `Request*`; schema-validating trusted bindings.
- Barrel `index.ts` cross-package re-exports; holding Effect layers across workflow step boundaries.

## Quality gate

Before declaring Effect-heavy work done, check:

- Is Effect itself the abstraction, or did the change add a project-local helper that hides control
  flow, dependency access, runtime boundaries, or typed errors?
- Are service definitions owned once with `Context.Service` and provided through explicit `Layer`
  construction?
- Are request/runtime boundaries explicit, with `Effect.run*` only at real JS or framework edges?
- Are Promise wrappers limited to unavoidable Promise-only foreign APIs?
- Are current-time reads inside Effect workflows using `Clock` / `DateTime` instead of `Date.now()`
  / `new Date()`?
- If an Effect-native integration exists, did the code use it directly?
- Are typed failures preserved with tagged errors and `Effect.catchTag` / `Effect.catchTags` rather
  than broad catch-and-fallback logic?
- Did cleanup include grep proof for removed wrappers, shims, duplicate service tags, legacy
  helpers, or obsolete API names?
- For HttpApi integration work: is there a named **seam** and **tracer test** (see
  [../ecosystem/httpapi-seams.md](../ecosystem/httpapi-seams.md))?

## Related

| Topic                                            | Reference                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| Service / layers                                 | [../dependency-injection/service.md](../dependency-injection/service.md) |
| HTTP API seams + RequestContext                  | [../ecosystem/httpapi-seams.md](../ecosystem/httpapi-seams.md)           |
| Errors                                           | [../core/error-handling.md](../core/error-handling.md)                   |
| Drizzle / persistence                            | [../ecosystem/drizzle.md](../ecosystem/drizzle.md)                       |
| Schema                                           | [../schema/schema.md](../schema/schema.md)                               |
| Worker host (bindings, queues, workflows, tests) | `cloudflare` `references/workers/effect-worker-seams.md`                 |
