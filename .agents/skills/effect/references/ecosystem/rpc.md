# RPC

## Table of Contents

- [Decision Tree](#decision-tree)
- [Define a procedure](#define-a-procedure)
- [Build a group](#build-a-group)
- [Implement handlers](#implement-handlers)
- [Run the server (HTTP)](#run-the-server-http)
- [Build a client](#build-a-client)
- [Streaming responses](#streaming-responses)
- [Middleware](#middleware)
- [Serialization](#serialization)
- [Workers](#workers)
- [Testing handlers](#testing-handlers)
- [Typed errors on the client](#typed-errors-on-the-client)
- [Pitfalls](#pitfalls)
- [See Also](#see-also)

  > **API stability: `@stability unstable`.** Typed bidirectional RPC over HTTP/WebSocket/Worker.
  > Module lives at `effect/rpc` — there is no separate `@effect/rpc` package in v4.

**Source:** `effect/rpc/*` - see `~/Developer/effect/packages/effect/src/rpc/`

- `Rpc.ts` — single procedure definition (`Rpc.make`)
- `RpcGroup.ts` — collect procedures into a group; implement handlers (`group.toLayer`)
- `RpcServer.ts` — server runtime (`layer`, `layerHttp`)
- `RpcClient.ts` — client (`make`, `makeNoSerialization`); `Protocol` service
- `RpcSerialization.ts` — JSON / NDJSON / JSON-RPC / `layerSchemaBinary`
- `RpcMiddleware.ts` — typed middleware (auth, logging, etc.)
- `RpcSchema.ts` — `RpcSchema.Stream` for streaming responses
- `RpcWorker.ts` — Web Worker / Worker Thread transport
- `RpcTest.ts` — `makeClient` for tests without network
- `RpcMessage.ts` — wire-level types (`Request`, `Ack`, `Interrupt`)
- `RpcClientError.ts` — `RpcClientError`, `RpcClientDefect`

## Decision Tree

```
What do I need?
├─ Define one procedure                       → Rpc.make("Tag", { payload, success, error })
├─ Collect into a group                       → RpcGroup.make(rpc1, rpc2, ...)
├─ Implement handlers                         → group.toLayer({ Tag: (payload) => Effect... })
├─ Run the server (HTTP route)                → RpcServer.layerHttp({ group, path, protocol })
├─ Run the server (raw protocol, e.g. Worker) → RpcServer.layer(group) + custom Protocol
├─ Build a client                             → RpcClient.make(group)
├─ Stream a response                          → Rpc.make with success: RpcSchema.Stream(...)
├─ Add middleware                             → rpc.middleware(MyMiddleware) / group.middleware(...)
├─ Test handlers without network              → RpcTest.makeClient(group) + provide group.toLayer(...)
└─ Switch serialization                       → provide `layerJson` / `layerNdjson` / `layerJsonRpc` / `layerSchemaBinary`
```

## Define a procedure

```ts
import { Rpc, RpcSchema } from "effect/rpc";
import { Schema } from "effect";

const GetUser = Rpc.make("GetUser", {
  payload: { id: Schema.String }, // Schema.Struct fields are inferred
  success: Schema.Struct({ id: Schema.String, name: Schema.String }),
  error: Schema.String, // optional; defaults to Schema.Never
});

const StreamLogs = Rpc.make("StreamLogs", {
  payload: { service: Schema.String },
  success: Schema.String,
  stream: true, // wraps success in RpcSchema.Stream
});
```

The `payload`, `success`, `error` schemas are typed end-to-end. The client and server share these
definitions via the `Rpc` value (or a `RpcGroup` containing many).

`primaryKey: (payload) => string` — opt-in deduplication key. When provided, identical calls in
flight collapse into one (caching/batching).

## Build a group

```ts
import { RpcGroup } from "effect/rpc";

const UserApi = RpcGroup.make(GetUser, ListUsers, CreateUser, StreamLogs);

// Combinators
UserApi.add(DeleteUser);
UserApi.merge(BillingApi);
UserApi.omit("DeleteUser");
UserApi.prefix("user."); // tags become "user.GetUser", etc.
UserApi.middleware(AuthMiddleware); // applies to all procedures so far
```

## Implement handlers

```ts
import { Effect, Layer, Stream } from "effect";

const UserApiLive = UserApi.toLayer({
  GetUser: ({ id }) =>
    Effect.gen(function* () {
      const db = yield* Database;
      return yield* db.findUser(id);
    }),
  ListUsers: () => Effect.succeed([{ id: "u1", name: "Alice" }]),
  CreateUser: ({ name }) =>
    Effect.gen(function* () {
      const db = yield* Database;
      return yield* db.createUser({ name });
    }),
  StreamLogs: ({ service }) => Stream.fromIterable([`[${service}] ready`, `[${service}] tick`]),
});
// UserApiLive: Layer<Rpc.ToHandler<UserApi>, never, Database>
```

`toLayer` returns a `Layer` that provides the handler service for the group. Dependencies (e.g.
`Database`) bubble up into the layer's requirements.

`toLayer` / `toHandlers` iterate the group's registered RPC definitions — extra keys on the handler
object are ignored. Handlers are registered in group definition order, not object key order.

`toLayerHandler(tag, build)` implements a single handler — useful when handlers live in different
files.

## Run the server (HTTP)

```ts
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { createServer } from "node:http";

const ServerLive = Layer.mergeAll(
  RpcServer.layerHttp({
    group: UserApi,
    path: "/rpc",
    protocol: "http",
  }),
  RpcSerialization.layerJson,
  HttpRouter.layer,
  NodeHttpServer.layer(() => createServer(), { port: 3000 }),
  UserApiLive,
);

NodeRuntime.runMain(Layer.launch(ServerLive));
```

`RpcServer.layer(group, options)` is the lower-level form — use when you bring your own `Protocol`
(e.g. Worker, custom socket).

## Build a client

```ts
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";

const ClientLive = Layer.mergeAll(
  RpcClient.layerProtocolHttp({ url: "http://localhost:3000/rpc" }),
  RpcSerialization.layerJson,
  FetchHttpClient.layer,
);

const program = Effect.gen(function* () {
  const client = yield* RpcClient.make(UserApi);
  const user = yield* client.GetUser({ id: "u1" });
  console.log(user.name);
}).pipe(Effect.provide(ClientLive));
```

The returned `client` is a record indexed by procedure tag. Each method is
`(payload) => Effect<Success, Error | RpcClientError>`. Streaming procedures return `Stream<A, E>`
instead.

## Streaming responses

```ts
import { Rpc, RpcClient, RpcGroup } from "effect/rpc"
import { Effect, Schema, Stream } from "effect"

const Tail = Rpc.make("Tail", {
  payload: { file: Schema.String },
  success: Schema.String,
  stream: true,                                 // server returns Stream / Queue
})

const TailApi = RpcGroup.make(Tail)

// Server handler (toLayer)
const handlers = { Tail: ({ file }) => Stream.fromAsyncIterable(...) }

// Client
const program = Effect.gen(function*() {
  const client = yield* RpcClient.make(TailApi)
  yield* client.Tail({ file: "/var/log/app.log" }).pipe(
    Stream.tap((line) => Effect.logInfo(line)),
    Stream.runDrain,
  )
})
```

`Effect`-of-`Queue.Dequeue` is also accepted as a stream handler return type — useful when the
producer needs explicit lifecycle control.

## Middleware

```ts
import { RpcMiddleware } from "effect/rpc";
import { Context, Effect, Layer, Schema } from "effect";

class CurrentUser extends Context.Service<CurrentUser, { id: string }>()("CurrentUser") {}

class AuthMiddleware extends RpcMiddleware.Service<
  AuthMiddleware,
  {
    provides: CurrentUser;
  }
>()("AuthMiddleware", { error: Schema.String }) {}

const AuthLayer = Layer.succeed(AuthMiddleware)(
  AuthMiddleware.of((effect, options) => {
    const auth = options.headers.authorization;
    if (auth === undefined) return Effect.fail("missing auth");
    return Effect.provideService(effect, CurrentUser, { id: parseUserId(auth) });
  }),
);

const SecureApi = UserApi.middleware(AuthMiddleware);
// All procedures in SecureApi now receive CurrentUser in their handler context.
```

## Serialization

```ts
import { RpcSerialization } from "effect/rpc";

RpcSerialization.json; // serializer value used by layerJson
RpcSerialization.ndjson; // newline-delimited JSON
RpcSerialization.jsonRpc(); // JSON-RPC 2.0 wire format
RpcSerialization.layerSchemaBinary({ maxFrameSize: 16 * 1024 * 1024 });
```

Provide `layerJson`, `layerNdjson`, or `layerJsonRpc(...)` on both server and client. The
`layerSchemaBinary(...)` constructor is also a Layer. Wire format must match. Custom serializers
must implement `codecFor`; built-in JSON codecs already do.

> SchemaBinary is the current compact binary option. It fingerprints RPC envelopes, allows optional
> payload fingerprints, and defaults to a 16 MiB frame limit; use `"unbounded"` only when the
> transport already supplies an appropriate limit.

## Workers

```ts
import { RpcWorker } from "effect/rpc";
import { Effect, Schema } from "effect";

// Client side: encode an initial message for the worker.
class WorkerInit extends Schema.Class<WorkerInit>("WorkerInit")({
  config: Schema.String,
}) {}

const InitLayer = RpcWorker.layerInitialMessage(
  WorkerInit,
  Effect.succeed(new WorkerInit({ config: "worker-config" })),
);
// The worker side reads it with RpcWorker.initialMessage(WorkerInit).
```

Pair with `RpcServer.layer` (no HTTP) and a Worker-flavored `Protocol`.

## Testing handlers

```ts
import { Effect } from "effect";
import { RpcTest } from "effect/rpc";

const Handlers = UserApi.toLayer({
  GetUser: ({ id }) => Effect.succeed({ id, name: "test" }),
  // ...rest
});

const program = Effect.gen(function* () {
  const testClient = yield* RpcTest.makeClient(UserApi).pipe(Effect.provide(Handlers));
  return yield* testClient.GetUser({ id: "u1" });
});
// No network, no serialization. Direct dispatch.
```

## Typed errors on the client

```ts
import { RpcClientError } from "effect/rpc"

const program = client.GetUser({ id: "u1" }).pipe(
  Effect.catchTag("RpcClientError", (e) => Effect.logError("rpc failed", e)),
  Effect.catchTag("RpcClientDefect", (e) => /* unrecoverable */),
)
```

`RpcClientError` covers serialization, transport, and protocol failures. `RpcClientDefect` is for
hard programming errors (e.g. bad codec). HTTP clients now defect if the response stream closes
before a terminal RPC response message arrives; do not treat early-close as a typed service error.

## Pitfalls

- **Server and client must share the same `RpcGroup` value.** Define procedures in a shared package;
  import from both.
- **Serialization on both ends.** Forgetting to provide the same `RpcSerialization.layer*` on the
  client is the most common "it just hangs" bug.
- **Stream handlers must consume their downstream.** A handler returning a `Stream` that's never
  started won't push data. Use `RpcSchema.Stream` and ensure the producer is lazy.
- **WebSocket vs HTTP.** `protocol: "http"` is request/response. `protocol: "websocket"` is the only
  way to support streaming + interruption. If you don't stream, HTTP is simpler.
- **Middleware type-leak.** `group.middleware(M)` mutates the requirements of every procedure.
  Putting middleware behind `prefix` is fine; mixing prefixed and unprefixed in the same group with
  different middleware sets gets confusing fast — split into multiple groups.

## See Also

- [Platform](./platform.md) — `HttpRouter`, `HttpClient` services that the HTTP RPC transport builds
  on
- [Schema](../schema/schema.md) — payload / success / error schemas
- [Stream](../streaming/stream.md) — streaming RPC results
