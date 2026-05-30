# Platform Bun

**Source:** `@effect/platform-bun` - see `~/Developer/effect/packages/platform-bun/src/`

Use `@effect/platform-bun` when your runtime is Bun and you want Effect-native layers for Bun HTTP server, filesystem, terminal, workers, and command execution.

## When To Use

- Bun-native backend services
- Bun CLI and scripting workflows
- Projects using Effect with Bun's built-in server/runtime model
- Apps that should stay on Bun's runtime primitives

## Minimal Runtime Wiring

```ts
import { BunRuntime } from "@effect/platform-bun"
import { Effect } from "effect"

BunRuntime.runMain(
  Effect.sync(() => {
    console.log("bun runtime ready")
  })
)
```

## Common Layers and Modules

| Module / Layer | What it provides |
|---|---|
| `BunRuntime.runMain` | Runtime entrypoint for Bun |
| `BunServices.layer` | Standard Bun platform services bundle |
| `BunHttpServer.layer({ port })` | Bun HTTP server adapter |
| `BunHttpClient.layer` | Bun HTTP client layer (uses Bun's native fetch) |
| `BunFileSystem.layer` | Bun filesystem service |
| `BunTerminal.layer` | Bun terminal service |
| `BunWorker.layerManager` / `BunWorker.layer` | Worker manager and platform worker layers |
| `BunKeyValueStore.layerFileSystem(directory)` | File-backed key/value store on Bun |
| `BunPath.layer` | Path utilities |
| `BunSocket.layerWebSocket` | WebSocket layer |

## HTTP Server Example

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

## HTTP Client Example

```ts
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { BunHttpClient, BunRuntime } from "@effect/platform-bun"
import { Effect } from "effect"

const request = HttpClientRequest.get("/todos/1").pipe(
  HttpClientRequest.prependUrl("https://jsonplaceholder.typicode.com")
)

const program = Effect.gen(function*() {
  const response = yield* HttpClient.execute(request)
  return yield* response.json
}).pipe(Effect.provide(BunHttpClient.layer))

BunRuntime.runMain(program)
```

## BunServices vs Individual Layers

`BunServices.layer` bundles the most common Bun services. For smaller bundles, provide only the layers you need.

## Notes

- In v4, `HttpRouter`, `HttpServer`, `HttpClient` moved to `effect/unstable/http` (was `@effect/platform` in v3). The Bun adapter (`BunHttpServer`, `BunHttpClient`) remains in `@effect/platform-bun`.
- BunRuntime automatically provides Bun's native fetch as the default HTTP client.
- Bun's SQLite support is via `BunFileSystem` + `@effect/sql-sqlite-bun`.
