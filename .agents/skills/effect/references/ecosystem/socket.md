# Socket

`effect/socket` is the current pull-based transport abstraction. A `Socket` exposes a scoped
`reader` and `writer`; the reader pulls non-empty batches, and the writer applies transport
backpressure.

```ts
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Socket from "effect/socket/Socket";

const handle = (_frames: ReadonlyArray<Uint8Array | string>) => Effect.void;

const consume = Effect.gen(function* () {
  const socket = yield* Socket.Socket;
  const { pull } = yield* socket.reader;
  while (true) {
    yield* handle(yield* pull);
  }
}).pipe(Effect.scoped, Effect.retry({ schedule: Schedule.exponential("200 millis") }));
```

Use `writer.write` for one frame and `writer.writeAll` for a non-empty batch. Clean transport
termination is reported as a `SocketError`, so reconnecting is an ordinary retry around the scoped
consume loop. Closing the scope also interrupts a suspended pull.

`Reader.upgrade(options?)` performs an in-place TLS upgrade where the adapter supports it. The Node
shared adapter provides `NodeSocket.layerNet`, `NodeSocket.layerTls`, and corresponding server
layers; browser and runtime-specific WebSocket layers remain in their platform packages.

The old push-style `run`, `runString`, and `runRaw` APIs are not part of the current source. Keep
the reader/writer boundary visible when adapting a protocol.

## Channel and Stream Adapters

- `Socket.toChannel(socket)` is the bidirectional binary adapter;
  `toChannelString(socket, encoding?)` decodes frames as strings.
- `Socket.toStream(socket)` exposes read-only binary pulls. `Socket.makeChannel()` obtains the
  `Socket` service from the environment and builds the same binary channel.
- Channel inputs and outputs are non-empty batches. Use the channel when reads and writes must be
  composed together; use `toStream` for a read-only consumer.

## WebSockets

`Socket.makeWebSocket(url, options?)` creates a socket through the `WebSocketConstructor` service;
`Socket.fromWebSocket(acquire, options?)` adapts an already-scoped WebSocket-like value. For a
channel, use `Socket.makeWebSocketChannel(url, options?)`; for dependency injection, provide
`Socket.layerWebSocket(url, options?)`. Browser-compatible construction is available through
`Socket.layerWebSocketConstructorGlobal`.

## Socket Servers

`SocketServer.SocketServer` exposes the bound `address` and a long-running `run(handler)` that hands
each accepted `Socket.Socket` to the handler. Platform packages provide the concrete TCP or Unix
socket server layer; keep the server scope alive for the duration of the accept loop and handle
`SocketServer.SocketServerError` at the process boundary.
