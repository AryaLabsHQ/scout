/**
 * Duplex RPC Socket adapter.
 *
 * `@effect/rpc`'s built-in socket transports (`RpcServer.layerProtocolWebsocket`
 * and `RpcClient.layerProtocolSocket`) each take exclusive ownership of the
 * underlying `Socket.Socket` — they call `socket.runRaw(handler)` with a
 * role-specific handler. This prevents a single WebSocket from carrying
 * RPCs in both directions (both peers initiating requests).
 *
 * Scout needs exactly this for the hub↔agent channel: the agent dials
 * one WS to the hub, and both sides call RPCs on the other (hub invokes
 * management commands on the agent; agent pushes `agent.report` metrics
 * to the hub).
 *
 * This adapter takes a single `Socket.Socket` and constructs two
 * `Protocol` services — one `RpcServer.Protocol` (for handling inbound
 * requests of the "serverGroup") and one `RpcClient.Protocol` (for
 * initiating requests of the "clientGroup"). Both share:
 *   - a single `socket.runRaw` reader (dispatches inbound messages by
 *     `_tag`: Request/Ack/Interrupt/Eof/Ping → server role, everything
 *     else → client role)
 *   - a single `socket.writer` for outbound bytes
 *   - a single `RpcSerialization` parser instance (NDJSON etc.)
 *
 * The two Protocol services are returned as `Layer`s ready to be provided
 * to `RpcServer.layer(serverGroup)` and `RpcClient.make(clientGroup)`
 * respectively.
 *
 * Tag discrimination safety: `FromClientEncoded` tags (Request, Ack,
 * Interrupt, Eof, Ping) and `FromServerEncoded` tags (Chunk, Exit, Defect,
 * Pong, ClientProtocolError) are disjoint — verified in
 * `effect/unstable/rpc/RpcMessage.ts`.
 */

import { Effect, Layer, Option, Queue } from "effect"
import type * as Scope from "effect/Scope"
import type * as Socket from "effect/unstable/socket/Socket"
import type {
  FromClientEncoded,
  FromServerEncoded,
} from "effect/unstable/rpc/RpcMessage"
import * as RpcClient from "effect/unstable/rpc/RpcClient"
import { RpcClientDefect, RpcClientError } from "effect/unstable/rpc/RpcClientError"
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization"
import * as RpcServer from "effect/unstable/rpc/RpcServer"

/**
 * Returns `true` if the encoded RPC message represents a "from client"
 * message (i.e. a request the peer is making of us as a server), vs a
 * "from server" message (a response to a request we made as a client).
 *
 * Scout's RPC adapter uses this to route each inbound message on the
 * shared socket to either the server-role protocol or the client-role
 * protocol.
 */
const isFromClientEncoded = (
  msg: FromClientEncoded | FromServerEncoded,
): msg is FromClientEncoded => {
  switch (msg._tag) {
    case "Request":
    case "Ack":
    case "Interrupt":
    case "Eof":
    case "Ping":
      return true
    default:
      return false
  }
}

/**
 * Build an `RpcServer.Protocol` and an `RpcClient.Protocol` that share
 * one underlying WebSocket. Returns them as Layers that can be provided
 * to `RpcServer.layer(...)` and `RpcClient.make(...)` independently.
 *
 * The caller is responsible for providing a `Socket.Socket` scoped to
 * the lifetime of the desired RPC session, plus an `RpcSerialization`
 * layer (typically `RpcSerialization.layerNdjson`).
 *
 * The returned layers MUST share the same `socket` instance — do not
 * call this helper twice with the same socket.
 */
export const makeDuplexRpcProtocols = (
  socket: Socket.Socket,
): Effect.Effect<
  {
    readonly serverProtocol: Layer.Layer<RpcServer.Protocol>
    readonly clientProtocol: Layer.Layer<RpcClient.Protocol>
  },
  never,
  RpcSerialization.RpcSerialization | Scope.Scope
> =>
  Effect.gen(function* () {
    const serialization = yield* RpcSerialization.RpcSerialization
    const parser = serialization.makeUnsafe()
    const writeRaw = yield* socket.writer

    // Routing callbacks installed by each Protocol's `run(f)` invocation
    // via withRun's buffer. Until installed, inbound messages for that
    // side are no-ops — but in practice RpcServer/RpcClient call `run`
    // during layer construction, well before any message arrives.
    let routeToServer: (
      clientId: number,
      data: FromClientEncoded,
    ) => Effect.Effect<void> = () => Effect.void
    let routeToClient: (
      data: FromServerEncoded,
    ) => Effect.Effect<void> = () => Effect.void

    // Server-side clientId is fixed at 0 — the duplex adapter has exactly
    // one peer (the other end of the WS).
    const PEER_CLIENT_ID = 0

    // disconnects queue is part of the RpcServer.Protocol surface.
    // Consumers drain it to learn when a client hangs up.
    const disconnects = yield* Queue.make<number>()

    // Fire a disconnect event when the scope closes (socket torn down).
    yield* Effect.addFinalizer(() =>
      Queue.offer(disconnects, PEER_CLIENT_ID).pipe(Effect.orDie),
    )

    // Fork the socket reader loop. Each parsed frame is dispatched to
    // either the server- or client-side handler by _tag.
    const noop: (value: void) => void = () => {}
    yield* Effect.forkScoped(
      socket
        .runRaw((data) => {
          try {
            const decoded = parser.decode(data) as ReadonlyArray<
              FromClientEncoded | FromServerEncoded
            >
            if (decoded.length === 0) return Effect.void
            let i = 0
            return Effect.whileLoop({
              while: () => i < decoded.length,
              body: () => {
                const msg = decoded[i++]!
                return isFromClientEncoded(msg)
                  ? routeToServer(PEER_CLIENT_ID, msg)
                  : routeToClient(msg)
              },
              step: noop,
            })
          } catch {
            // Decode errors drop the frame rather than tearing down the
            // whole connection. The RPC engine's per-request timeout will
            // surface any downstream consequences.
            return Effect.void
          }
        })
        .pipe(Effect.ignore),
    )

    // ── Outbound send functions ─────────────────────────────────────────

    const sendFromServer = (
      _clientId: number,
      response: FromServerEncoded,
    ): Effect.Effect<void> => {
      try {
        const encoded = parser.encode(response)
        if (encoded === undefined) return Effect.void
        return Effect.orDie(writeRaw(encoded))
      } catch {
        return Effect.void
      }
    }

    const toClientError = (message: string, cause: unknown): RpcClientError =>
      new RpcClientError({
        reason: new RpcClientDefect({ message, cause }),
      })

    const sendFromClient = (
      request: FromClientEncoded,
    ): Effect.Effect<void, RpcClientError> => {
      try {
        const encoded = parser.encode(request)
        if (encoded === undefined) return Effect.void
        return writeRaw(encoded).pipe(
          Effect.mapError((cause) =>
            toClientError("duplex socket write failed", cause),
          ),
        )
      } catch (cause) {
        return Effect.fail(toClientError("duplex socket encode failed", cause))
      }
    }

    // ── Build the Protocol services ─────────────────────────────────────

    const serverProtocolService = yield* RpcServer.Protocol.make((writeRequest) => {
      routeToServer = writeRequest
      return Effect.succeed({
        disconnects,
        send: sendFromServer,
        end: (_clientId: number) => Effect.void,
        clientIds: Effect.sync(() => new Set<number>([PEER_CLIENT_ID])),
        initialMessage: Effect.succeed(Option.none()),
        supportsAck: true,
        supportsTransferables: false,
        supportsSpanPropagation: false,
      })
    })

    const clientProtocolService = yield* RpcClient.Protocol.make((writeResponse) => {
      routeToClient = writeResponse
      return Effect.succeed({
        send: sendFromClient,
        supportsAck: true,
        supportsTransferables: false,
      })
    })

    return {
      serverProtocol: Layer.succeed(RpcServer.Protocol, serverProtocolService),
      clientProtocol: Layer.succeed(RpcClient.Protocol, clientProtocolService),
    } as const
  })
