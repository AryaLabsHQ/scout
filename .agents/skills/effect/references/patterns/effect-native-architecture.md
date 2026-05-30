---
name: effect-native-architecture
description: The canonical end-state shape for an Effect v4 application — service definitions, the three-slot DI model, the DB-error boundary, errors, schema-at-the-seams, and naming/style. Use when structuring a new Effect app or migrating one to be Effect-native. Pairs with httpapi-seams.md (API layer) and the cloudflare skill's effect-worker-seams.md (Worker host).
---

# Effect-native application architecture

The portable, opinionated shape an Effect v4 app converges on. This is the
*structure* layer — how services, DI, errors, and persistence fit together —
not the API primitive reference (see the rest of this skill for that).

For the HTTP layer (groups → handlers → services, middleware order, the
RequestContext seam) see [httpapi-seams.md](../ecosystem/httpapi-seams.md). For
the Cloudflare Worker host (bindings, queues, workflows, test tiers) see the
cloudflare skill's `effect-worker-seams.md`. For a full migration sequence and
worked exemplars, see the architecture playbook the maintaining org keeps
alongside its repos.

## 0. The one rule: the *right amount* of Effect-native

Effect-native does **not** mean "everything is an `Effect`." Business logic and
IO seams are modeled in Effect; the messy edges are bridged explicitly and kept
thin.

**Model in Effect**
- Business logic / services
- The HTTP API layer (contracts → handlers → services)
- Persistence (a `Database` service + query "stores")
- Provider/integration adapters
- Queue/cron/workflow *handlers* (the work, not the platform shell)

**Keep at the edge (Promise / raw), bridge explicitly**
- Auth libraries with Promise adapters — keep a Promise DB client for them.
- Platform bindings — read at the call site; don't wrap in a forwarding service.
- Framework entrypoints — `fetch`/`queue`/`scheduled`, workflow step callbacks.

**Do NOT over-Effect**
- No wrappers/helpers/adapters/repositories/runners/façades unless they capture
  a *repeated domain concept*, isolate a *real* integration boundary, or encode
  a *cross-cutting policy with multiple call sites*. Default: use the framework
  directly.
- Don't over-name with `Request*` — the request lifecycle is implied by the
  runtime and Effect scoping. `Database`, not `RequestDatabase`;
  `Environment`/`AppConfig`, not `RequestEnv`.
- Don't schema-validate trusted, typed platform bindings — decode untrusted
  *strings* and external data, not the binding objects.

## 1. Service shape — `Context.Service` + `Layer.effect`

```ts
class AccountService extends Context.Service<AccountService, AccountServiceShape>()(
  "myapp/AccountService",
) {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const db = yield* Database              // ← hoist dependencies here, once
      return AccountService.of({
        getById: Effect.fn("AccountService.getById")(function* (id: string) {
          const org = yield* OrganizationContext
          return yield* db.query.accounts.findFirst({
            where: { id, organizationId: org.id },
          })
        }, catchDbErrors),                     // ← DB-error boundary as 2nd arg
      })
    }),
  )
}
```

Rules:
- `Context.Service` + `static readonly layer = Layer.effect(this)(...)`. **Never**
  `Effect.Service`, `Context.Tag`, `Context.GenericTag`, `Effect.Tag`.
- **Hoist dependencies**: `yield* Database` (and other deps) at the top of the
  `Layer.effect` gen and close over them in the methods. This resolves each dep
  once and keeps it out of every method's inferred `R`. Per-request deps work
  too because the service layer is rebuilt per request (see the DI model below).
- Wrap each method in `Effect.fn("Service.method")(genFn, catchDbErrors)` — names
  the tracing span and attaches the DB-error boundary in one place.
- `yield*` ambient/auth context (`OrganizationContext`, …) inside the method;
  let the return type's `R` be inferred — don't hand-annotate `Effect.Effect<…>`.

## 2. Dependency injection — the three-slot model

Provide exactly three kinds of thing, each built once at the right lifetime:

| Slot | What | Type | Lifetime |
|---|---|---|---|
| **`Environment`** | Raw platform bindings (KV, queues, DO namespaces) | `Context.Reference<Env>` — no production default; the entry fills it once | ambient |
| **`AppConfig`** | Decoded **string** config (secrets, URLs, flags-as-strings) | `Context.Service<AppConfig, ServerEnv>` | isolate-stable |
| **Typed binding services** | Thin typed wrappers over bindings | `QueueService` (`send("email"\|…)`), `WorkflowProducer` (`start("x")`), actor factories, `FlagService`, … | isolate-stable |

```ts
// Environment: a named slot, no production default.
class Environment extends Context.Reference<Environment>()("myapp/Environment", {
  defaultValue: (): Env => { throw new Error("Environment not provided") },
}) {}

// AppConfig: decoded config, NOT the bindings.
class AppConfig extends Context.Service<AppConfig, ServerEnv>()("myapp/AppConfig") {}
```

Two lifetimes, kept distinct:
- **Isolate-stable** (`AppConfig`, `QueueService`, `FlagService`, integration
  clients like Stripe): assembled once into an `AppServices` layer and **hoisted**
  by services at layer creation — *not* rebuilt per request.
- **Per-request** (`Database`, auth service): built once per invocation by a
  single request middleware with a fresh `MemoMap`, then provided to the route.

```ts
// One middleware builds request-scoped services once and provides them.
const Middleware = HttpRouter.middleware<{ provides: MiddlewareServices }>()(
  Effect.fnUntraced(function* (httpEffect) {
    const env = yield* Environment
    const memoMap = yield* Layer.makeMemoMap
    const scope = yield* Effect.scope
    const services = yield* Layer.buildWithMemoMap(servicesLayer(env), memoMap, scope)
    return yield* Effect.provideContext(httpEffect, services)
  }),
)
```

**No module-level binding reads, pools, or client singletons.** Module-level
`const stripe = createClient(env...)` becomes a factory resolved from
`AppConfig`. The CF-specific wiring (`Environment.context(env)` in `fetch`,
`AppServices` assembly) lives in the cloudflare skill's `effect-worker-seams.md`.

## 3. The DB-error boundary — `catchDbErrors`

A single transformer maps infrastructure/data failures to a uniform
`InternalError` (HTTP 500) at the **method boundary**, so HTTP endpoints only
ever surface their declared domain errors. Apply it as the **second argument** to
the service `Effect.fn`.

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

**Always catch** `EffectDrizzleQueryError` (the `drizzle-orm/effect-postgres`
query failure). Then add **one** of these depending on your store pattern:

| Add | When | Trade-off |
|---|---|---|
| `SqlError` (`effect/unstable/sql/SqlError`) | Methods can surface the raw driver error; no decode-at-boundary stores | Simpler; but a **connect-time** `SqlError` fires at pool/layer build, *outside* any per-method scope |
| `RowDecodeError` (your tagged store decode error) | Stores decode rows at the boundary into a tagged error | Catches data-corruption per method; pairs with the stores pattern (§4) |

> The two exemplar repos diverge here: one catches `EffectDrizzleQueryError | SqlError`,
> the other `EffectDrizzleQueryError | RowDecodeError`. Pick per whether your
> stores decode at the boundary. **Cover connect-time `SqlError` structurally**
> (a health/org-context integration test that fails a real query), not by
> catching it in every method.

## 4. Persistence — `effect-postgres` `Database` + query stores

```ts
// The Database service value IS the drizzle client; every query returns an Effect.
class Database extends Context.Service<Database, DatabaseClient>()("myapp/Database") {
  static layer = (connectionString: string) =>
    Layer.scoped(this, /* PgClient.layer -> PgDrizzle.make({ relations }) */)
}
```

- Use `drizzle-orm/effect-postgres` `PgDrizzle.make({ relations })` over
  `@effect/sql-pg` `PgClient.layer`. `Database.layer(connectionString)` builds a
  per-scope pool. Drizzle 1.0: one `defineRelations(schema, (r) => ({…}))`
  registry (RQB v2), not per-table `relations()`. See
  [../ecosystem/drizzle.md](../ecosystem/drizzle.md).
- **Stores**: aggregate `*Store` objects for reused/non-trivial SQL. Every method
  `Effect.fn("PostsStore.getByIdForOrg")(…)`; **org-scoped** (first arg
  `organizationId` / a branded `OrgId`); decode rows at the boundary
  (`decodeRow`/`decodeRows` → a tagged `RowDecodeError`). Keep one-off SQL inline
  in the service.
- **Promise edge for auth**: keep a separate Promise `createDb()` for the auth
  library's non-Effect adapter. Bridge with `runWithDatabase(db, effect)` only
  when a Promise edge already holds a client — don't invent a general runner.
- Test path: a PGlite harness that runs the *real* `PgClient` path against
  in-memory Postgres + migrations. See [../ecosystem/vitest.md](../ecosystem/vitest.md)
  and the cloudflare skill's `effect-worker-seams.md` for the workerd tier.

## 5. Errors — `Schema.TaggedErrorClass` + status

- Domain/HTTP errors: `Schema.TaggedErrorClass` annotated with an HTTP status
  (`httpApiStatus`). Rich, schema-aware, encodable.
- Use `Effect.catch` / `Effect.catchTag` / `Effect.catchTags`; narrow unknowns
  with `Cause` helpers. **Never** `Effect.catchAll`, `Effect.option`,
  `Effect.ignore`, `Effect.orElseSucceed`, or blind `mapError`.
- Don't recover from `ParseError`/unsupported platforms — `Effect.die`.
- See [../core/error-handling.md](../core/error-handling.md).

## 6. Schema at the seams — parsers, not post-hoc validators

- Decode external/untrusted data into stronger domain values at every IO seam:
  HTTP bodies & responses, provider/webhook payloads, KV/SQL decoded rows, JWT
  claims.
- Datetimes: `Schema.DateFromString` so domain code uses `Date` and ISO lives
  only on the wire. **Delete string-branded "ISO" types** — let the codec own the
  transform.
- Brand IDs/slugs with `Schema.brand(...)` so invariants ride the type.
- See [../schema/schema.md](../schema/schema.md).

## 7. Config / env — Effect Schema

- Validate environment with **Effect Schema** (not Zod) in a dedicated `env`
  package. One decode entry, e.g. `decodeServerEnv(workerEnv)`. Decode **string**
  vars; ignore bindings (typed platform objects, not schema input).
- Keep generated binding types (`wrangler types` / `cf-typegen`) committed and
  unedited. See [../core/config.md](../core/config.md).

## 8. Naming & style

- **`.layer`** is the default production layer; merged/assembled layers get a
  `*Layer` const suffix (`ApiHandlersLayer`, `MiddlewareLayer`). **No `.Live`** —
  it's a v3-ism. Third-party layers stay `.layer` (`PgClient.layer`).
- `Effect.gen` for business logic (sequential steps, named intermediates,
  `yield* Service`, branching). `.pipe(...)` for cross-cutting concerns
  (`catchTag`, spans/log annotations, retries/timeouts, providing layers).
  Logic in `gen`, operational behavior outside in `pipe`.
- `Option`/`undefined` in domain logic; `Schema.NullOr` only at DB/wire. Don't
  leak casual `null`.
- Import directly from source files; no barrel `index.ts` cross-package
  re-exports.

## 9. Anti-patterns (the "don't" list)

- `Effect.Service` / `Context.Tag` / `Context.GenericTag` / `Effect.Tag`.
- `Effect.catchAll` / `Effect.option` / `Effect.ignore` / `Effect.orElseSucceed`;
  recovering from `ParseError`.
- Module-level env reads, pools, or client singletons; wrapper services that only
  forward a binding.
- `as` casts on IO results (`response.json() as T`, SQL rows, KV values); `any`;
  dynamic `import()` for app modules.
- Local wrappers/helpers/runners without a real repeated/boundary/policy
  justification.
- Over-naming with `Request*`; schema-validating trusted bindings.
- Barrel `index.ts` cross-package re-exports; holding Effect layers across
  workflow step boundaries.

## Related

| Topic | Reference |
|---|---|
| Service / layers | [../dependency-injection/service.md](../dependency-injection/service.md) |
| HTTP API seams + RequestContext | [../ecosystem/httpapi-seams.md](../ecosystem/httpapi-seams.md) |
| Errors | [../core/error-handling.md](../core/error-handling.md) |
| Drizzle / persistence | [../ecosystem/drizzle.md](../ecosystem/drizzle.md) |
| Schema | [../schema/schema.md](../schema/schema.md) |
| Worker host (bindings, queues, workflows, tests) | cloudflare `references/workers/effect-worker-seams.md` |
