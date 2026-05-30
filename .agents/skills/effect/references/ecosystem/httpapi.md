---
name: httpapi
description: Typed HTTP APIs with Schema-validated contracts in Effect v4. Covers HttpApi/HttpApiGroup/HttpApiEndpoint/HttpApiBuilder, middleware-based auth, OpenAPI generation, listener composition, and migration patterns from Hono/Express-style backends.
---

# HttpApi (Effect v4)

> **Unstable in v4.** Typed HTTP API contracts, server handlers, clients, OpenAPI generation, and docs helpers live at `effect/unstable/httpapi`. APIs may shift in beta minors — see `~/Developer/effect/MIGRATION.md` "Unstable Module System".

Use `HttpApi` when you need a schema-backed contract instead of ad hoc `HttpRouter` routes.

For **middleware stacks**, **contract vs live file split**, **test seams**, and **tracer-bullet** delivery order, see [httpapi-seams.md](httpapi-seams.md).

## Core Modules

| Module | Purpose |
|--------|---------|
| `HttpApi` | Top-level API composed from groups and middleware |
| `HttpApiGroup` | Group endpoints under a shared name/path/middleware set |
| `HttpApiEndpoint` | Define method, path, params, query, payload, success, errors |
| `HttpApiBuilder` | Implement server handlers for an API |
| `HttpApiClient` | Build a typed client from an API contract |
| `HttpApiError` | Built-in HTTP API error types |
| `HttpApiSchema` | Schema helpers for params, payloads, headers, status metadata |
| `HttpApiMiddleware` | Typed per-endpoint or per-group middleware (auth, etc.) |
| `OpenApi` | OpenAPI model generation |
| `HttpApiSwagger` / `HttpApiScalar` | Documentation UI helpers |

## Minimal shape

```ts
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"

const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

const UsersGroup = HttpApiGroup.make("users").add(
  HttpApiEndpoint.get("getUser", "/users/:id", {
    params: { id: Schema.String },
    success: User,
  }),
)

export const Api = HttpApi.make("api").add(UsersGroup)
```

## Testing with `HttpApiTest`

In-memory client for selected groups — handlers come from the test `Layer` (unselected groups get die handlers):

```ts
import { Effect } from "effect"
import { HttpApiTest } from "effect/unstable/httpapi"

const client = yield* HttpApiTest.groups(MyApi, ["operator"], {
  baseUrl: "http://localhost", // optional; path-only URLs still work
})
```

Provide `HttpApiBuilder` layers for the groups under test. Pair with [httpapi-seams.md](httpapi-seams.md) tracer bullets.

## When to use HttpApi vs HttpRouter

| Use | Choose |
|-----|--------|
| Simple custom route handling | `effect/unstable/http` `HttpRouter` |
| Contract-first endpoints with schemas | `effect/unstable/httpapi` |
| Generated typed clients | `HttpApiClient` |
| OpenAPI / Swagger / Scalar docs | `HttpApi` + docs helpers |

---

## Endpoint definition

Every field on an endpoint is a `Schema`. The contract is pure data — handlers live separately.

```ts
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiError, OpenApi } from "effect/unstable/httpapi"

const QuestionApi = HttpApi.make("question").add(
  HttpApiGroup.make("question")
    .add(
      HttpApiEndpoint.get("list", "/question", {
        query: { limit: Schema.optional(Schema.NumberFromString) },
        success: Schema.Array(Question),
      }).annotateMerge(
        OpenApi.annotations({ identifier: "question.list", summary: "List questions" }),
      ),
      HttpApiEndpoint.post("reply", "/question/:requestID/reply", {
        params: { requestID: QuestionID },
        payload: ReplyPayload,
        success: Schema.Boolean,
        error: [HttpApiError.BadRequest, HttpApiError.NotFound],
      }),
    )
    .middleware(Authorization),
)
```

`HttpApiEndpoint.<method>(name, path, fields)`:

| Field | Schema for |
|-------|------------|
| `params` | URL path placeholders (`/users/:id` → `{ id: Schema.String }`) |
| `query` | URL query string |
| `payload` | Request body (JSON, multipart, etc. — controlled via `HttpApiSchema.asMultipart` / `asJson`) |
| `headers` | Request headers |
| `success` | Response body schema |
| `error` | Array of `Schema.ErrorClass` instances; each carries its own status |

## Schema-typed errors with `httpApiStatus`

Custom errors are `Schema.ErrorClass` with the `httpApiStatus` annotation. The HttpApi runtime maps the error to that status when an endpoint handler fails with one.

```ts
import { Schema } from "effect"

export class ApiNotFoundError extends Schema.ErrorClass<ApiNotFoundError>(
  "@scope/NotFoundError",
)(
  {
    _tag: Schema.tag("NotFoundError"),
    message: Schema.String,
  },
  { description: "Resource not found", httpApiStatus: 404 },
) {}
```

The built-in `HttpApiError.BadRequest` / `Unauthorized` / `Forbidden` / `NotFound` / `InternalServerError` (HttpApiError.ts) follow exactly this pattern — use them directly when the default English description is fine, otherwise define a project-local error class.

Map errors from lower layers in handlers:

```ts
const mapStorageNotFound = <A, R>(self: Effect.Effect<A, StorageNotFound, R>) =>
  self.pipe(
    Effect.mapError((e) => new ApiNotFoundError({ message: e.path })),
  )
```

## Middleware-based auth

Declare middleware with `HttpApiMiddleware.Service`. Put **`requires`** and **`provides`** in the **type-parameter config**; put **`error`**, **`security`**, and **`requiredForClient`** in the constructor options object.

```ts
import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi"
import { UnauthorizedError, ForbiddenError } from "../errors/domain"

export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  {
    provides: UserContext
  }
>()("@scope/Authorization", {
  error: [UnauthorizedError, ForbiddenError],
  security: {
    cookie: HttpApiSecurity.apiKey({ in: "cookie", key: "session" }),
    apiKey: HttpApiSecurity.apiKey({ in: "header", key: "x-api-key" }),
  },
  requiredForClient: true,
}) {}
```

Custom `Authorization` header schemes (beta.73+): `HttpApiSecurity.http({ scheme: "Bearer" })`.

Apply with `.middleware(Authorization)` on `HttpApi`, `HttpApiGroup`, or per-endpoint as your manifest requires. Samva often attaches `Authorization` on the root `HttpApi`; Fanbeam attaches it per authenticated group in the manifest — see [httpapi-seams.md](httpapi-seams.md).

**Security middleware live** — when `security` is set, implement per scheme (not a single `(request) =>`):

```ts
export const AuthorizationLive = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const auth = yield* AuthService
    return Authorization.of({
      cookie: (httpEffect, { credential }) =>
        resolveSession(auth, httpEffect, credential),
      apiKey: (httpEffect, { credential }) =>
        resolveApiKey(auth, httpEffect, credential),
    })
  }),
)
```

**Non-security middleware** wraps the endpoint `httpEffect` directly: `MyMiddleware.of((httpEffect, { endpoint, group }) => …)`.

**Schema errors at the edge:** `HttpApiMiddleware.layerSchemaErrorTransform` maps `HttpApiSchemaError` into middleware-declared `error` schemas (otherwise schema failures can surface as defects).

**Why middleware + `security:` beats endpoint-only `HttpApiSecurity`:** Endpoint-attached security can try schemes in turn and mis-handle typed downstream failures. Declaring auth as `HttpApiMiddleware.Service` with a `security` map keeps credentials and declared errors on the middleware contract. You still use `HttpApiSecurity` — **inside** the middleware declaration.

---

## Listener composition

Two paths, depending on whether you need raw runtime control.

### Path A — `BunHttpServer.layer` (or `NodeHttpServer.layer`)

Effect's platform packages ship turn-key server layers.

```ts
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Layer } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"

const ServerLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide([UsersHandlersLive, AuthorizationLive]),
  Layer.provideMerge(BunHttpServer.layer({ port: 3000 })),
)

BunRuntime.runMain(Layer.launch(ServerLive))
```

Use this when you want the simplest path and don't need to customize the underlying server.

### Path B — Custom `Bun.serve` with `HttpRouter.toWebHandler`

When you need WebSocket upgrades on selected paths, custom `Bun.serve` options, or to share routes across multiple listener configs, drop down to `HttpRouter.toWebHandler` (HttpRouter.ts:1118):

```ts
import { Layer, Effect, ConfigProvider, Scope } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"

const buildHandler = Effect.gen(function* () {
  const memoMap = yield* Layer.makeMemoMap
  const handler = yield* HttpRouter.toWebHandler(
    HttpApiBuilder.toHttpApp(Api).pipe(
      Effect.provide([UsersHandlersLive, AuthorizationLive]),
    ),
    { memoMap },
  )
  return handler
})

export async function listen(opts: { port: number }) {
  const handler = await Effect.runPromise(buildHandler)

  Bun.serve({
    port: opts.port,
    fetch(request, server) {
      const url = new URL(request.url)

      // Intercept WebSocket upgrades for specific paths
      if (url.pathname.startsWith("/ws/") && request.headers.get("upgrade") === "websocket") {
        const id = url.pathname.slice("/ws/".length)
        server.upgrade(request, { data: { id } })
        return undefined
      }

      return handler(request)
    },
    websocket: {
      open(ws)    { /* ... */ },
      message(ws, msg) { /* ... */ },
      close(ws)   { /* ... */ },
    },
  })
}
```

This is the pattern opencode uses to add WS upgrades on top of `HttpApi` — see `~/Developer/opencode/packages/opencode/src/server/httpapi-listener.ts`.

### Pitfall: stale `ConfigProvider` on repeated `listen()`

Effect caches the global `ConfigProvider` after first read. If you start one server, mutate `process.env`, then start a second listener inside the same process, the second listener will still see the original snapshot.

Fix: provide a fresh `ConfigProvider` per `listen()` scope.

```ts
const ServerLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide([handlersLive]),
  Layer.provideMerge(BunHttpServer.layer({ port })),
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),  // fresh each time
)
```

This shows up most often in tests that spin servers up and down. opencode's regression here was the Hono→HttpApi parity bug fixed in their PR #25726.

---

## OpenAPI generation

`OpenApi.fromApi(api)` (OpenApi.ts:135) produces a JSON Schema document from the API contract.

```ts
import { OpenApi } from "effect/unstable/httpapi"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"

const docResponse = lazyMemo(() =>
  HttpServerResponse.jsonUnsafe(OpenApi.fromApi(Api)),
)

const docRoute = HttpRouter.use((router) =>
  router.add("GET", "/doc", () => Effect.succeed(docResponse())),
)
```

`jsonUnsafe` caches the serialized `Uint8Array` so subsequent requests reuse the same buffer — combined with `lazyMemo`, the spec is generated once per process.

### Reshaping the spec via `annotations({ transform })`

When a downstream tool (a legacy SDK generator, a typed-client publisher) expects a specific OpenAPI shape, attach a transform to the API root:

```ts
export const PublicApi = Api.pipe(
  OpenApi.annotations({
    transform: (doc) => {
      // Strip `anyOf: [T, { type: "null" }]` from optional fields
      // Normalize component names
      // Patch SSE routes that HttpApi doesn't model directly
      return rewritten
    },
  }),
)
```

The transform runs once at spec-generation time. Common transforms:

- **Optional null-arms**: `Schema.optional(T)` produces `anyOf: [T, { type: "null" }]`. SDKs that expect bare `T` need the null arm stripped.
- **Component naming**: Effect generates names like `Foo.Bar` (dot-separated). SDKs that expect PascalCase need them rewritten.
- **Auth metadata**: When auth uses `HttpApiMiddleware` with a `security:` map, OpenAPI can include security schemes. Middleware without `security` will not add them — strip stale 401 responses if the legacy spec did not declare auth.

---

## Migration recipe (from Hono / Express)

Order matters. Don't delete the old backend until parity is verified.

### Phase 1 — Move types to Schema

For every Zod schema used in routes, build the Effect Schema equivalent and either:
- expose `static readonly zod` (see `references/patterns/schema-zod-interop.md`) and let the existing Hono routes consume it, or
- define both temporarily and pick the Effect one when wiring the new HttpApi.

### Phase 2 — Build HttpApi side-by-side with Hono

Wire the same routes as `HttpApiEndpoint`s. Keep the Hono backend running. Test parity with a route exerciser:

```ts
// Compare HttpApi response with Hono response for same fixture request
expect(httpApiResponse).toEqual(honoResponse)
```

### Phase 3 — OpenAPI parity

Switch your SDK generator to consume `OpenApi.fromApi(Api)` (with a `transform` annotation if needed). Keep the Hono spec-export available behind a flag for diff comparisons.

### Phase 4 — Default to HttpApi for non-prod, then prod

Flip a feature flag for dev/beta channels first. Catch regressions there before flipping production.

### Phase 5 — Delete

Once parity tests stay green and prod is on HttpApi for several releases, delete the Hono backend in a single commit. Keep a follow-up "scar tissue cleanup" commit ready for unused middleware/types/utils that were only kept for the old backend.

---

## Common parity pitfalls

### `undefined` body becomes `null` in Hono, empty in HttpApi

Hono `c.json(undefined)` emits the literal `null`. HttpApi via `HttpServerResponse.empty()` writes a zero-byte body. SDK clients that expected `null` will choke.

Fix:

```ts
return HttpServerResponse.jsonUnsafe(result ?? null)
```

### Query params declared in middleware but not in endpoint schema

If a middleware (workspace routing, tenant resolution) reads a query param like `?directory=...`, the param must appear in **every** endpoint's `query:` schema that uses that middleware. HttpApi rejects requests carrying query params not declared in the endpoint schema — Hono didn't.

Fix: export shared query fields and spread them into every endpoint:

```ts
export const WorkspaceRoutingQueryFields = {
  directory: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
}

const endpoint = HttpApiEndpoint.get("list", "/items", {
  query: { ...WorkspaceRoutingQueryFields, limit: Schema.optional(Schema.NumberFromString) },
  success: Schema.Array(Item),
})
```

A drift-detection test that walks every endpoint applying the middleware and asserts the fields are present is the easiest way to catch new endpoints that forgot.

### Error mapping divergence

If your Hono backend funneled all unhandled service errors into a generic 500 (`NamedError → ErrorMiddleware → 500`), don't reflexively map them to 400 in HttpApi. Use `HttpApiError.InternalServerError` so the wire status matches; the SDK clients won't notice the change.

### Schema-optional null arms in OpenAPI

See "Reshaping the spec via `annotations({ transform })`" above. Strip null arms recursively from `anyOf` if your legacy SDK didn't include them.

---

## Source

- `~/Developer/effect/packages/effect/src/unstable/httpapi/HttpApi.ts`
- `~/Developer/effect/packages/effect/src/unstable/httpapi/HttpApiBuilder.ts`
- `~/Developer/effect/packages/effect/src/unstable/httpapi/HttpApiEndpoint.ts`
- `~/Developer/effect/packages/effect/src/unstable/httpapi/HttpApiGroup.ts`
- `~/Developer/effect/packages/effect/src/unstable/httpapi/HttpApiMiddleware.ts`
- `~/Developer/effect/packages/effect/src/unstable/httpapi/HttpApiError.ts`
- `~/Developer/effect/packages/effect/src/unstable/httpapi/HttpApiSchema.ts`
- `~/Developer/effect/packages/effect/src/unstable/httpapi/OpenApi.ts`
- `~/Developer/effect/packages/effect/src/unstable/http/HttpRouter.ts:1118` — `toWebHandler`
- `~/Developer/effect/packages/platform-bun/src/BunHttpServer.ts` — Bun integration

## Related

- `references/ecosystem/platform.md` — `effect/unstable/http` core
- `references/ecosystem/platform-bun.md` — Bun runtime adapter
- `references/patterns/schema-zod-interop.md` — Schema interfaces for HttpApi
- `references/patterns/service-effectification.md` — building handlers as services
