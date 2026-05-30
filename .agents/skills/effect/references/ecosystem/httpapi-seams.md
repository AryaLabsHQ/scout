---
name: httpapi-seams
description: Integration seams for Effect v4 HttpApi — middleware stacks, contract vs live split, test boundaries, and tracer-bullet sequencing. Use with httpapi.md when scoping or implementing API work.
---

# HttpApi integration seams

An **integration seam** is a public boundary you can test without reaching through private implementation: HTTP handler, middleware layer, domain `Context.Service`, or a test-only layer swap.

A **tracer bullet** is one failing integration test that proves the next seam works end-to-end before you deepen the stack below it.

For contract syntax and middleware basics, see [httpapi.md](httpapi.md). For backlog seam ordering, use the **discovery** skill ([`seam-stack-template.md`](../../../global/discovery/references/seam-stack-template.md)).

## Contract vs live split

Keep the **API contract** free of server-only imports so clients, tests, and the manifest can import it safely.

| File | Contains |
|------|----------|
| `http-api.ts` (or `lib/auth/http-api.ts`) | `HttpApiMiddleware.Service` declarations, `Context.Service` shapes handlers consume, typed errors, security metadata |
| `http-api.live.ts` | `Layer.effect` implementations, database/auth service calls |

Handlers and group definitions import the contract file only. Wire `*Layer`
(live) layers at the Worker/bootstrap layer. For exemplar file anchors, see the
architecture playbook the maintaining org keeps alongside its repos.

## Middleware stack (call order)

Declare middleware as `HttpApiMiddleware.Service` with explicit **`requires`** and **`provides`**. Attach to `HttpApiGroup` in **dependency order** — upstream middleware must run before middleware that `requires` its output.

Typical stack:

```text
HTTP request
  → Authorization (provides UserContext; security: cookie / apiKey)
  → OrgContext (provides OrganizationContext; requires UserContext)
  → handler (reads UserContext / OrganizationContext only)
```

**`requires` on the contract** (type-parameter config, not the options object).
The canonical end state is **`requires: never`** on auth middleware: keep
`security:` for OpenAPI/SDK, but resolve per-request DB/auth from an **ambient
`RequestContext` Reference** (see next section) instead of listing per-request
services in `requires` (which would reintroduce an `as never` seam at the router).

| Middleware | `requires` | `provides` |
|------------|-----------|-----------|
| `Authorization` | `never` | `UserContext` |
| `OrgContext` | `never` (reads `RequestContext` + `UserContext`) | `OrganizationContext` (+ an org actor handle, if used) |

Rules:

- Handlers consume **`UserContext`**, **`OrganizationContext`**, or domain services — not raw cookies, API keys, or Access JWT claim names.
- App-specific identity mapping (e.g. operator email vs service token) belongs in an **app-owned middleware** above shared auth, as a **total pure function** from the auth package’s principal type when you have one.
- Declare typed errors with **`error:`** on the middleware options object (`UnauthorizedError`, `ForbiddenError`, …).
- Auth uses **`security:`** on the middleware plus `Authorization.of({ cookie: …, apiKey: … })` in `http-api.live.ts` — see [httpapi.md](httpapi.md#middleware-based-auth).

**Where to attach middleware** — two valid placements:

- `Authorization` on the root `HttpApi`; `OrgContext` on individual groups.
- `Authorization` per authenticated group (via a manifest); `OrgContext` on
  org-scoped groups.

Per-group attachment gives the most precise client type inference; derive
SDK/public surfaces from one group manifest. Conceptual order is always
auth → org → handler even when attachment is split across API and groups.

## RequestContext seam (per-request DB/auth without polluting `requires`)

`HttpApiMiddleware` can't take per-request services in `requires` without
forcing an `as never` cast where the router builds the handler. The canonical fix
is an **ambient `Context.Reference`** carrying the per-request DB/auth/user, set
once by the Worker middleware and read by the live middleware implementations.

```ts
export interface RequestContextShape {
  readonly db: DatabaseClient
  readonly authApi: BetterAuthApi
  readonly user: UserContextShape | null
}

export const RequestContext = Context.Reference<RequestContextShape>(
  "myapp/RequestContext",
  { defaultValue: () => { throw new Error("Missing RequestContext — provided by Middleware") } },
)
```

- The Worker `Middleware` builds `Database`/auth once, then merges
  `RequestContext.context({ db, authApi, user: null })` into the request context.
- `Authorization` (live) reads `rc.authApi` to resolve the session, then
  re-provides `RequestContext` with the resolved `user`.
- `OrgContext` (live) reads `rc.user` / `rc.db` to resolve and provide
  `OrganizationContext`.
- Net effect: auth middleware declare `requires: never`, per-request services
  stay out of the typed `requires`, and the `as never` router cast disappears.

This is the seam both exemplar repos converged on; see the architecture playbook
for the live-impl anchors.

## Layering handlers

Implement in `http-api.live.ts` with `Layer.effect(MiddlewareTag, …)`:

- **Security middleware:** `MiddlewareTag.of({ schemeName: (httpEffect, { credential }) => … })`
- **Ordinary middleware:** `MiddlewareTag.of((httpEffect, { endpoint, group }) => …)`

Provide layers at the Worker root together with platform HTTP, database, and config layers. Do not construct services inside handlers with `new`.

## Test seams

Test through **public surfaces**:

| Surface | When |
|---------|------|
| HTTP + real layer graph | E2E / integration tests against `HttpApi` manifest |
| Middleware layer in isolation | Unit-test auth/org resolution with controlled layers |
| In-memory or harness DB | A PGlite harness running the real `PgClient` path — prefer over mocking Drizzle |

Avoid:

- Testing private helpers inside `http-api.live.ts` unless they are exported test utilities.
- Mocking `fetch`, JOSE, or globals when a **fixture layer** or real signed token path exists (see cloudflare `effect-worker-seams.md`).

## Tracer-bullet sequencing

When adding a new vertical slice, order work by **seams**, not by file tree:

1. **Bootstrap tracer** — Worker serves one public route (e.g. health or public 404) through the real `HttpApi` graph.
2. **Auth tracer** — Protected route returns 401/403 without credential; succeeds with test credential through middleware layers.
3. **Domain service seam** — In-memory or stub `Context.Service` behind one mutating endpoint.
4. **Runtime seam** — Swap stub for KV, DO, or SQL with one integration test.
5. **Domain rules** — Status codes, conflicts, parsers — only after the stack above is green.

One seam per red-green cycle. Do not implement the full DO schema and compensation logic before the first authenticated HTTP tracer passes.

## Discovery / kickoff handoff

When **discovery** runs in integration mode, each backlog issue should name:

- `## Delivers seam` — which row in the seam stack this issue completes
- `## Tracer test` — single test file or command that must pass
- `## Depends on` — prior seams that must already be green

**Kickoff** implements one issue (one seam) at a time unless the user expands scope.

## Related

| Topic | Reference |
|-------|-----------|
| HttpApi API surface | [httpapi.md](httpapi.md) |
| `Context.Service` / layers | [dependency-injection/service.md](../dependency-injection/service.md) |
| Worker bindings + KV/DO seams | `~/Developer/skills/skills/domain/cloudflare/references/workers/effect-worker-seams.md` |
| Vitest + Effect | [vitest.md](vitest.md) |
