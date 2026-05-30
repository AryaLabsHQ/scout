# Platform (HTTP)

**Source:** `effect/unstable/http/HttpRouter.ts` - see `~/Developer/effect/packages/effect/src/unstable/http/HttpRouter.ts`

**Source:** `effect/unstable/http/HttpClient.ts` - see `~/Developer/effect/packages/effect/src/unstable/http/HttpClient.ts`

> **Unstable in v4.** In v4, the HTTP stack moved from `@effect/platform` into `effect/unstable/http`. Runtime adapters remain in platform-specific packages.

Use `effect/unstable/http` for the HTTP server, client, and router abstractions. Provide a platform-specific runtime layer to run.

## When To Use

- Backend HTTP APIs (Node, Bun)
- HTTP clients for external services
- Typed API routes with HttpApi/OpenApi
- WebSocket servers via Socket

## Runtime Matrix

| Runtime | HTTP Server adapter | HTTP Client adapter |
|---------|---------------------|---------------------|
| Node.js | `NodeHttpServer.layer` (`@effect/platform-node`) | `NodeHttpClient.layerUndici` (`@effect/platform-node`) |
| Bun | `BunHttpServer.layer` (`@effect/platform-bun`) | `BunHttpClient.layer` (`@effect/platform-bun`) |
| Browser | N/A | `BrowserHttpClient.layerXMLHttpRequest` (`@effect/platform-browser`) |

## Minimal HTTP Server (Node)

```ts
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { createServer } from "node:http"

// Create routes using HttpRouter.use to access the router service
const Routes = HttpRouter.use(Effect.fn(function*(router) {
  yield* router.add(
    "GET",
    "/health",
    Effect.succeed(HttpServerResponse.text("ok"))
  )
}))

// HttpRouter.serve takes a Layer (not routes directly)
const HttpLive = HttpRouter.serve(Routes).pipe(
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: 3000 }))
)

NodeRuntime.runMain(Layer.launch(HttpLive))
```

## Minimal HTTP Server (Bun)

```ts
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Effect, Layer } from "effect"

// Create routes using HttpRouter.use to access the router service
const Routes = HttpRouter.use(Effect.fn(function*(router) {
  yield* router.add(
    "GET",
    "/health",
    Effect.succeed(HttpServerResponse.text("ok"))
  )
}))

// HttpRouter.serve takes a Layer (not routes directly)
const HttpLive = HttpRouter.serve(Routes).pipe(
  Layer.provide(BunHttpServer.layer({ port: 3000 }))
)

BunRuntime.runMain(Layer.launch(HttpLive))
```

## HTTP Client

```ts
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Effect, Schema } from "effect"

const Todo = Schema.Struct({
  userId: Schema.Number,
  id: Schema.Number,
  title: Schema.String,
  completed: Schema.Boolean
})

const request = HttpClientRequest.get("/todos/1").pipe(
  HttpClientRequest.prependUrl("https://jsonplaceholder.typicode.com")
)

const program = Effect.gen(function*() {
  const response = yield* HttpClient.execute(request)
  return yield* response.json(Todo)
})
```

Provide a concrete client layer before running: `NodeHttpClient.layerUndici` on Node, `BunHttpClient.layer` on Bun, or `BrowserHttpClient.layerXMLHttpRequest` in browsers.

## Key Modules (effect/unstable/http)

| Module | What it provides |
|--------|-----------------|
| `HttpRouter` | Route matcher and builder |
| `HttpServer` | HTTP server with `serve` |
| `HttpServerResponse` | Response builders (`text`, `json`, `html`, `stream`) |
| `HttpClient` | HTTP client with `execute` |
| `HttpClientRequest` | Request builders and modifiers |
| `HttpClientResponse` | Response parsing (`text`, `json`, `stream`, `schemaJson`) |
| `HttpMiddleware` | Middleware stack |
| `HttpEffect` | Effect-based request handlers |
| `HttpBody` | Request body types and parsers |

## HttpApi (typed API builders)

Use with OpenApi for full-stack type safety:

```ts
import { HttpApi, HttpApiGroup, HttpApiEndpoint, OpenApi } from "effect/unstable/httpapi"

const api = HttpApi.make("my-api")

const todos = HttpApiGroup.make("todos").pipe(
  HttpApiGroup.add(HttpApiEndpoint.get("list", "/todos")(Effect.succeed(/* ... */)))
)
```

## Other Platform Services

`effect/unstable/` also includes these non-HTTP platform services (provide platform-specific layers):

| Module | Purpose |
|--------|---------|
| `effect/unstable/workers` | Worker threads/pools |
| `effect/unstable/socket` | WebSocket/stream transport |
| `effect/unstable/cli` | Command-line interface |
| `effect/unstable/cluster` | Clustering |

> Note: In v4, `@effect/platform` no longer exists as a separate package. Its modules are split between `effect/unstable/http` (HTTP stack) and platform-specific packages (Node/Bun/Browser adapters).
