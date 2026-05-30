# Platform Browser

**Source:** `@effect/platform-browser` - see `~/Developer/effect/packages/platform-browser/src/`

Use `@effect/platform-browser` for Effect programs running in browsers, including browser HTTP client integration, worker layers, and browser storage layers.

## When To Use

- Browser-only apps using Effect programs
- Frontend data fetching with `HttpClient`
- Apps needing browser worker integrations
- Browser key/value persistence via local/session storage
- Browser-native APIs (clipboard, geolocation, permissions)

## Minimal Runtime Wiring

```ts
import { BrowserRuntime } from "@effect/platform-browser"
import { Effect } from "effect"

BrowserRuntime.runMain(
  Effect.sync(() => {
    console.log("browser runtime ready")
  })
)
```

## Common Layers and Modules

| Module / Layer | What it provides |
|---|---|
| `BrowserRuntime.runMain` | Runtime entrypoint for browsers |
| `BrowserHttpClient.layerXMLHttpRequest` | Browser `HttpClient` implementation via XMLHttpRequest |
| `BrowserKeyValueStore.layerLocalStorage` | Persistent key/value storage (localStorage) |
| `BrowserKeyValueStore.layerSessionStorage` | Session-scoped key/value storage (sessionStorage) |
| `BrowserWorker.layerManager` | Worker manager layer |
| `BrowserWorker.layer` | Platform worker layer |
| `BrowserSocket.layerWebSocket` | Browser WebSocket layer |
| `BrowserStream.fromEventListenerWindow` / `BrowserStream.fromEventListenerDocument` | Stream integrations from DOM event listeners |
| `Clipboard.layer` | Browser clipboard API |
| `Geolocation.layer` | Geolocation API |
| `Permissions.layer` | Permissions API |

## HTTP Client Example

```ts
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { BrowserHttpClient, BrowserRuntime } from "@effect/platform-browser"
import { Effect } from "effect"

const request = HttpClientRequest.get("https://jsonplaceholder.typicode.com/todos/1")

const program = Effect.gen(function*() {
  const response = yield* HttpClient.execute(request)
  return yield* response.json
}).pipe(Effect.provide(BrowserHttpClient.layerXMLHttpRequest))

BrowserRuntime.runMain(program)
```

## Browser Workers

```ts
import { Worker } from "effect/unstable/workers"
import { BrowserWorker, BrowserRuntime } from "@effect/platform-browser"
import { Effect, Layer } from "effect"

const worker = Worker.makeSerialized(
  MyWorkerEffect,
  BrowserWorker.layer({ url: new URL("./worker.ts", import.meta.url) })
)

BrowserRuntime.runMain(
  Effect.provide(worker, BrowserWorker.layerManager)
)
```

## KeyValueStore (Browser Storage)

```ts
import { KeyValueStore } from "effect/unstable/http"
import { BrowserKeyValueStore, BrowserRuntime } from "@effect/platform-browser"
import { Effect } from "effect"

const program = Effect.gen(function*() {
  const kv = yield* KeyValueStore.KeyValueStore
  yield* kv.set("session:1", "ok")
  return yield* kv.get("session:1")
}).pipe(Effect.provide(BrowserKeyValueStore.layerLocalStorage))

BrowserRuntime.runMain(program)
```

## Notes

- In v4, `HttpClient` moved to `effect/unstable/http` (was `@effect/platform` in v3). The browser adapter (`BrowserHttpClient`) remains in `@effect/platform-browser`.
- Workers in browsers use `import.meta.url` for the worker script URL.
- `BrowserSocket.layerWebSocket` provides WebSocket support in browser environments.
