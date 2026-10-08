# Platform Browser

## Table of Contents

- [When To Use](#when-to-use)
- [Minimal Runtime Wiring](#minimal-runtime-wiring)
- [Common Layers and Modules](#common-layers-and-modules)
- [HTTP Client Example](#http-client-example)
- [Browser Workers](#browser-workers)
- [KeyValueStore (Browser Storage)](#keyvaluestore-browser-storage)
- [Notes](#notes)

**Source:** `@effect/platform-browser` - see

`~/Developer/effect/packages/platform/browser/src/`

At `effect@4.0.0` the same files live under `packages/platform/browser/src/`.

Use `@effect/platform-browser` for Effect programs running in browsers, including browser HTTP
client integration, worker layers, and browser storage layers.

## When To Use

- Browser-only apps using Effect programs
- Frontend data fetching with `HttpClient`
- Apps needing browser worker integrations
- Browser key/value persistence via local/session storage
- Browser-native APIs (clipboard, geolocation, permissions)

## Minimal Runtime Wiring

```ts
import { BrowserRuntime } from "@effect/platform-browser";
import { Effect } from "effect";

BrowserRuntime.runMain(
  Effect.sync(() => {
    console.log("browser runtime ready");
  }),
);
```

## Common Layers and Modules

| Module / Layer                                                                      | What it provides                                       |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `BrowserRuntime.runMain`                                                            | Runtime entrypoint for browsers                        |
| `BrowserHttpClient.layerXMLHttpRequest`                                             | Browser `HttpClient` implementation via XMLHttpRequest |
| `BrowserKeyValueStore.layerLocalStorage`                                            | Persistent key/value storage (localStorage)            |
| `BrowserKeyValueStore.layerSessionStorage`                                          | Session-scoped key/value storage (sessionStorage)      |
| `BrowserKeyValueStore.layerIndexedDb`                                               | Async IndexedDB-backed key/value storage               |
| `BrowserPersistence.layerBackingIndexedDb` / `layerIndexedDb`                       | IndexedDB-backed persistence layers                    |
| `IndexedDbDatabase.make` / `IndexedDbVersion.make` / `IndexedDbTable.make`          | Typed database, version, and table definitions         |
| `IndexedDbQueryBuilder.make`                                                        | Typed IndexedDB query builder                          |
| `BrowserWorker.layerPlatform`                                                       | Worker platform layer                                  |
| `BrowserWorker.layer(spawn)`                                                        | Platform worker and spawner layers                     |
| `BrowserSocket.layerWebSocket`                                                      | Browser WebSocket layer                                |
| `BrowserStream.fromEventListenerWindow` / `BrowserStream.fromEventListenerDocument` | Stream integrations from DOM event listeners           |
| `Clipboard.layer`                                                                   | Browser clipboard API                                  |
| `Geolocation.layer`                                                                 | Geolocation API                                        |
| `Permissions.layer`                                                                 | Permissions API                                        |

## HTTP Client Example

```ts
import { HttpClient, HttpClientRequest } from "effect/http";
import { BrowserHttpClient, BrowserRuntime } from "@effect/platform-browser";
import { Effect } from "effect";

const request = HttpClientRequest.get("https://jsonplaceholder.typicode.com/todos/1");

const program = Effect.gen(function* () {
  const response = yield* HttpClient.execute(request);
  return yield* response.json;
}).pipe(Effect.provide(BrowserHttpClient.layerXMLHttpRequest));

BrowserRuntime.runMain(program);
```

## Browser Workers

```ts
import * as Worker from "effect/workers/Worker";
import { BrowserWorker, BrowserRuntime } from "@effect/platform-browser";
import { Effect } from "effect";

const workerLayer = BrowserWorker.layer(
  () => new globalThis.Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

const program = Effect.gen(function* () {
  const platform = yield* Worker.WorkerPlatform;
  const worker = yield* platform.spawn(0);
  yield* worker.run((_message) => Effect.void).pipe(Effect.forkScoped);
  yield* worker.send({ type: "start" });
}).pipe(Effect.scoped, Effect.provide(workerLayer));

BrowserRuntime.runMain(program);
```

## KeyValueStore (Browser Storage)

```ts
import { KeyValueStore } from "effect/persistence";
import { BrowserKeyValueStore, BrowserRuntime } from "@effect/platform-browser";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const kv = yield* KeyValueStore.KeyValueStore;
  yield* kv.set("session:1", "ok");
  return yield* kv.get("session:1");
}).pipe(Effect.provide(BrowserKeyValueStore.layerLocalStorage));

BrowserRuntime.runMain(program);
```

## Notes

- Import `HttpClient` from `effect/http` and the browser adapter (`BrowserHttpClient`) from
  `@effect/platform-browser`.
- Workers in browsers use `import.meta.url` for the worker script URL.
- `BrowserSocket.layerWebSocket` provides WebSocket support in browser environments.
