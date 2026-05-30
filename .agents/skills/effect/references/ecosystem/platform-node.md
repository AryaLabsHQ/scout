# Platform Node

**Source:** `@effect/platform-node` - see `~/Developer/effect/packages/platform-node/src/`

Use `@effect/platform-node` when your runtime is Node.js and you want Effect-first access to HTTP, filesystem, terminal, workers, and command execution.

## When To Use

- Backend services on Node.js
- CLI tools and local automation
- Apps needing Node HTTP server/client adapters
- Code that needs Node file, terminal, or process integrations

## Minimal Runtime Wiring

```ts
import { NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"

NodeRuntime.runMain(
  Effect.sync(() => {
    console.log("node runtime ready")
  })
)
```

## Common Layers and Modules

| Module / Layer | What it provides |
|---|---|
| `NodeRuntime.runMain` | Runtime entrypoint for Node |
| `NodeServices.layer` | Standard Node platform services bundle |
| `NodeHttpServer.layer(() => createServer(), { port })` | Node HTTP server adapter (requires server factory + listen options) |
| `NodeHttpClient.layerUndici` / `NodeHttpClient.layer` | Node HTTP client layers using Undici |
| `NodeFileSystem.layer` | File system service implementation |
| `NodeTerminal.layer` | Terminal service implementation |
| `NodeWorker.layerManager` / `NodeWorker.layer` | Worker manager and platform worker layers |
| `NodeKeyValueStore.layerFileSystem(directory)` | File-backed key/value store |
| `NodePath.layer` | Path utilities (posix/win32) |
| `NodeSocket.layerWebSocketConstructor` | WebSocket constructor for Node |

## HTTP Server Example

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

## HTTP Client Example

```ts
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { NodeHttpClient, NodeRuntime } from "@effect/platform-node"
import { Effect, Schema } from "effect"

const request = HttpClientRequest.get("/todos/1").pipe(
  HttpClientRequest.prependUrl("https://jsonplaceholder.typicode.com")
)

const program = Effect.gen(function*() {
  const response = yield* HttpClient.execute(request)
  return yield* response.json(Schema.Struct({ userId: Schema.Number, id: Schema.Number }))
}).pipe(Effect.provide(NodeHttpClient.layerUndici))

NodeRuntime.runMain(program)
```

## Command Example

```ts
import { Command, Flag } from "effect/unstable/cli"
import { NodeServices, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"

const greet = Command.make("greet", {
  name: Flag.string("name")
}, (config) =>
  Effect.sync(() => console.log(`Hello, ${config.name}!`))
)

const program = Command.run(greet, { version: "1.0.0" }).pipe(
  Effect.provide(NodeServices.layer)
)

NodeRuntime.runMain(program)
```

## NodeServices vs Individual Layers

`NodeServices.layer` bundles the most common Node services. For minimal bundles, provide only the layers you need (e.g., `NodeFileSystem.layer` alone for filesystem access).

## Notes

- In v4, `HttpRouter`, `HttpServer`, `HttpClient` moved to `effect/unstable/http` (was `@effect/platform` in v3). The Node adapter (`NodeHttpServer`, `NodeHttpClient`) remains in `@effect/platform-node`.
- Requires Node 18+ (for fetch-based APIs) or Node 20+ LTS.
