# Platform (HTTP)

## Table of Contents

- [When To Use](#when-to-use)
- [Runtime Matrix](#runtime-matrix)
- [Minimal HTTP Server (Node)](#minimal-http-server-node)
- [Minimal HTTP Server (Bun)](#minimal-http-server-bun)
- [HTTP Client](#http-client)
- [Key Modules (effect/http)](#key-modules-effecthttp)
- [HttpApi (typed API builders)](#httpapi-typed-api-builders)
- [Other Platform Services](#other-platform-services)

**Source:**

`effect/http/HttpRouter.ts` - see `~/Developer/effect/packages/effect/src/http/HttpRouter.ts`

**Source:** `effect/http/HttpClient.ts` - see
`~/Developer/effect/packages/effect/src/http/HttpClient.ts`

> **API stability: `@stability unstable`.** In v4, the HTTP stack moved from `@effect/platform` into
> `effect/http`. Runtime adapters remain in platform-specific packages.

Use `effect/http` for the HTTP server, client, and router abstractions. Provide a platform-specific
runtime layer to run.

## When To Use

- Backend HTTP APIs (Node, Bun)
- HTTP clients for external services
- Typed API routes with HttpApi/OpenApi
- WebSocket servers via Socket

## Runtime Matrix

| Runtime | HTTP Server adapter                              | HTTP Client adapter                                                  |
| ------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| Node.js | `NodeHttpServer.layer` (`@effect/platform-node`) | `NodeHttpClient.layerUndici` (`@effect/platform-node`)               |
| Bun     | `BunHttpServer.layer` (`@effect/platform-bun`)   | `BunHttpClient.layer` (`@effect/platform-bun`)                       |
| Deno    | `DenoHttpServer.layer` (`@effect/platform-deno`) | `DenoHttpClient.layer` (`@effect/platform-deno`)                     |
| Browser | N/A                                              | `BrowserHttpClient.layerXMLHttpRequest` (`@effect/platform-browser`) |

## Minimal HTTP Server (Node)

```ts
import { HttpRouter, HttpServerResponse } from "effect/http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { createServer } from "node:http";

// Create routes using HttpRouter.use to access the router service
const Routes = HttpRouter.use(
  Effect.fn(function* (router) {
    yield* router.add("GET", "/health", Effect.succeed(HttpServerResponse.text("ok")));
  }),
);

// HttpRouter.serve takes a Layer (not routes directly)
const HttpLive = HttpRouter.serve(Routes).pipe(
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: 3000 })),
);

NodeRuntime.runMain(Layer.launch(HttpLive));
```

## Minimal HTTP Server (Bun)

```ts
import { HttpRouter, HttpServerResponse } from "effect/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";

// Create routes using HttpRouter.use to access the router service
const Routes = HttpRouter.use(
  Effect.fn(function* (router) {
    yield* router.add("GET", "/health", Effect.succeed(HttpServerResponse.text("ok")));
  }),
);

// HttpRouter.serve takes a Layer (not routes directly)
const HttpLive = HttpRouter.serve(Routes).pipe(Layer.provide(BunHttpServer.layer({ port: 3000 })));

BunRuntime.runMain(Layer.launch(HttpLive));
```

## HTTP Client

```ts
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { Effect, Schema } from "effect";

const Todo = Schema.Struct({
  userId: Schema.Number,
  id: Schema.Number,
  title: Schema.String,
  completed: Schema.Boolean,
});

const request = HttpClientRequest.get("/todos/1").pipe(
  HttpClientRequest.prependUrl("https://jsonplaceholder.typicode.com"),
);

const program = Effect.gen(function* () {
  const response = yield* HttpClient.execute(request);
  return yield* HttpClientResponse.schemaJson(Todo)(response);
});
```

Provide a concrete client layer before running: `NodeHttpClient.layerUndici` on Node,
`BunHttpClient.layer` on Bun, `DenoHttpClient.layer` on Deno, or
`BrowserHttpClient.layerXMLHttpRequest` in browsers.

### Adapter Boundary Shape

In application and provider code, wrap each outgoing call in a named effect that owns the full
boundary: construct the request, attach auth and headers, execute it, classify status, decode the
body with Schema, and map transport/status/decode failures to typed domain errors. Apply retry or
rate-limit policy at this boundary where the operation is idempotent. Keep raw provider/network
effects out of business services and database transactions so a transport failure never leaks
untyped into domain logic or aborts a transaction mid-flight.

### Useful Client APIs

Beyond `HttpClient.execute`:

- `HttpClient.get` / `post` / `put` / `patch` / `del` — service accessors that build and run a
  request in one call.
- `HttpClient.mapRequest` / `mapRequestEffect` — apply a configured (or effectful) transform to
  every request on a client instance, e.g. base URL, auth, or default headers.
- `HttpClientRequest.prependUrl` — set a base URL; `bearerToken` — attach `Authorization: Bearer`;
  `acceptJson` — request a JSON response.
- `HttpClientRequest.bodyJson` — effectful JSON body encoding; `HttpClientRequest.schemaBodyJson` —
  schema-backed JSON body encoding.
- `HttpClient.filterStatusOk` / `HttpClientResponse.filterStatusOk` — treat non-2xx as a typed
  `HttpClientError` before decoding.
- `HttpClientResponse.schemaBodyJson` — decode the JSON body only (re-exported from
  `HttpIncomingMessage`); `HttpClientResponse.schemaJson` — decode status + headers + body;
  `HttpClientResponse.schemaNoBody` — decode status + headers only. (`HttpClientRequest` has its own
  `schemaBodyJson` for _encoding_ request bodies.)

A configured client composes these transforms once, then reuses it:

```ts
import { HttpClient, HttpClientRequest } from "effect/http";
import { Effect } from "effect";

const makeApiClient = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  return client.pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl("https://api.example.com")),
    HttpClient.mapRequest(HttpClientRequest.acceptJson),
    HttpClient.filterStatusOk,
    HttpClient.retryTransient({ times: 3 }),
  );
});
```

### Retry And Rate Limiting

- `HttpClient.retryTransient(...)` retries common transient failures — transport errors, timeouts,
  and `408` / `429` / `500` / `502` / `503` / `504` responses. It retries both errors and transient
  responses by default; pass
  `{ retryOn: "errors-only" | "response-only" | "errors-and-responses", schedule, times, while }` to
  narrow the scope or supply a custom schedule.
- `HttpClient.withRateLimiter(...)` paces requests proactively and learns from rate-limit /
  `Retry-After` headers. It requires a `RateLimiter` (`effect/persistence/RateLimiter`) plus an
  initial `window`, `limit`, and `key` (options also include `algorithm` — `"fixed-window"` default
  or `"token-bucket"` — `tokens`, `disableResponseInspection`, and `disableAdaptiveLearning`). It
  adds `RateLimiterError` to the error channel and automatically retries `429` responses (including
  an `HttpClientError` wrapping a `429`) back through the limiter.
- Operation-level `Effect.retry(...)` when the retry decision depends on domain-typed errors,
  provider payloads, or idempotency rules rather than raw transport status. See
  [retry/schedule.md](../retry/schedule.md) for `retryAfterMs`-aware schedules.

### Raw fetch (deliberate exception)

Prefer the Effect HTTP client. Reach for raw `fetch` only deliberately — implementing a platform
transport, adapting an API that cannot depend on the Effect HTTP modules, or a runtime/library
boundary where they are not an appropriate dependency. If unavoidable, keep it inside an adapter
service and hold the same boundary discipline: wire the `AbortSignal` from `Effect.tryPromise` into
`fetch`, classify status before decoding, decode unknown bodies with Schema, map to typed errors
carrying the cause and the domain data that failed, redact secrets, and retry only idempotent
operations.

```ts
import { Effect, Schema } from "effect";

class ProviderUnreachable extends Schema.TaggedError<ProviderUnreachable>()("ProviderUnreachable", {
  cause: Schema.Defect(),
}) {}

class ProviderRejected extends Schema.TaggedError<ProviderRejected>()("ProviderRejected", {
  status: Schema.Number,
}) {}

class ProviderResponseInvalid extends Schema.TaggedError<ProviderResponseInvalid>()(
  "ProviderResponseInvalid",
  { cause: Schema.Defect() },
) {}

const request = Effect.fn("Provider.request")(function* (input: RequestInput) {
  const response = yield* Effect.tryPromise({
    try: (signal) => fetch(input.url, { signal, headers: input.headers }),
    catch: (cause) => new ProviderUnreachable({ cause }),
  });

  if (!response.ok) {
    return yield* Effect.fail(new ProviderRejected({ status: response.status }));
  }

  const json = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) => new ProviderResponseInvalid({ cause }),
  });

  return yield* Schema.decodeUnknownEffect(ResponseSchema)(json).pipe(
    Effect.mapError((cause) => new ProviderResponseInvalid({ cause })),
  );
});
```

Replace this with the Effect HttpClient before adding more behavior — the client provides status
classification, schema decoding, and retry/rate-limit transforms that this boundary must otherwise
reimplement by hand.

## Key Modules (effect/http)

| Module               | What it provides                                          |
| -------------------- | --------------------------------------------------------- |
| `HttpRouter`         | Route matcher and builder                                 |
| `HttpServer`         | HTTP server with `serve`                                  |
| `HttpServerResponse` | Response builders (`text`, `json`, `html`, `stream`)      |
| `HttpClient`         | HTTP client with `execute`                                |
| `HttpClientRequest`  | Request builders and modifiers                            |
| `HttpClientResponse` | Response parsing (`text`, `json`, `stream`, `schemaJson`) |
| `HttpStatus`         | Named HTTP status literals                                |
| `HttpMiddleware`     | Middleware stack                                          |
| `HttpEffect`         | Effect-based request handlers                             |
| `HttpBody`           | Request body types and parsers                            |

## HttpApi (typed API builders)

Use with OpenApi for full-stack type safety:

```ts
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

const TodosApi = HttpApi.make("todos").add(
  HttpApiGroup.make("todos").add(
    HttpApiEndpoint.get("list", "/todos", { success: Schema.Array(Schema.String) }),
  ),
);
```

The contract is data. Handlers live on `HttpApiBuilder`, not on `HttpApiEndpoint.get`. See
[httpapi.md](httpapi.md).

## Other Platform Services

The package also exports these non-HTTP domain subpaths (provide platform-specific layers):

| Module           | Purpose                    |
| ---------------- | -------------------------- |
| `effect/workers` | Worker threads/pools       |
| `effect/socket`  | WebSocket/stream transport |
| `effect/cli`     | Command-line interface     |
| `effect/cluster` | Clustering                 |

> Note: In v4, `@effect/platform` no longer exists as a separate package. Its modules are split
> between `effect/http` (HTTP stack) and platform-specific packages (Node/Bun/Browser adapters).
