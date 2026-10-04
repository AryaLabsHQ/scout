/**
 * Duplex RPC Socket adapter.
 *
 * `effect/rpc`'s built-in socket transports (`RpcServer.layerProtocolWebsocket`
 * and `RpcClient.layerProtocolSocket`) each take exclusive ownership of the
 * underlying `Socket.Socket` — each acquires `socket.reader` and handles
 * every frame in its own role. This prevents a single WebSocket from
 * carrying RPCs in both directions (both peers initiating requests).
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
 *   - a single `socket.reader` pull loop (dispatches inbound messages by
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
 * `effect/rpc/RpcMessage.ts`.
 */

import { Deferred, Effect, Layer, Option, Queue } from "effect"
import { constVoid } from "effect/Function"
import type * as Scope from "effect/Scope"
import type * as Socket from "effect/socket/Socket"
import type {
  FromClientEncoded,
  FromServerEncoded,
} from "effect/rpc/RpcMessage"
import * as RpcClient from "effect/rpc/RpcClient"
import { RpcClientDefect, RpcClientError } from "effect/rpc/RpcClientError"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as RpcServer from "effect/rpc/RpcServer"

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
 * to `RpcServer.layer(...)` and `RpcClient.make(...)` independently, plus a
 * `closed` effect that completes when the socket stops reading.
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
    /** Completes when the underlying socket stops reading (closed or failed). */
    readonly closed: Effect.Effect<void>
  },
  never,
  RpcSerialization.RpcSerialization | Scope.Scope
> =>
  Effect.gen(function* () {
    const serialization = yield* RpcSerialization.RpcSerialization
    const parser = serialization.makeUnsafe()
    const writer = yield* socket.writer

    // Routing callbacks installed by each Protocol's `make(f)` callback.
    // RpcServer/RpcClient buffer inbound messages until their `run` loop
    // starts, so messages arriving before that are replayed, not dropped.
    let routeToServer: (
      clientId: number,
      data: FromClientEncoded,
    ) => Effect.Effect<void> = () => Effect.void
    let routeToClient: (data: FromServerEncoded) => Effect.Effect<void> = () =>
      Effect.void

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

    const processFrame = (data: Uint8Array | string): Effect.Effect<void> => {
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
          step: constVoid,
        })
      } catch {
        // Decode errors drop the frame rather than tearing down the
        // whole connection. The RPC engine's per-request timeout will
        // surface any downstream consequences.
        return Effect.void
      }
    }

    // Completes once the reader loop stops: the socket failed to open, the
    // peer closed it, or the scope closed. Socket writes suspend while
    // disconnected, so callers must race their RPC session against this to
    // notice a dead connection.
    const closed = yield* Deferred.make<void>()

    // Fork the socket reader loop. Acquiring the reader establishes the
    // connection; each pulled frame is dispatched to either the server- or
    // client-side handler by _tag. The pull fails with a SocketError when
    // the connection closes, which ends the loop.
    yield* Effect.forkScoped(
      Effect.gen(function* () {
        const { pull } = yield* socket.reader
        while (true) {
          const frames = yield* pull
          for (const frame of frames) {
            yield* processFrame(frame)
          }
        }
      }).pipe(
        Effect.scoped,
        Effect.ignore,
        Effect.ensuring(Deferred.succeed(closed, undefined)),
      ),
    )

    // ── Outbound send functions ─────────────────────────────────────────

    const sendFromServer = (
      _clientId: number,
      response: FromServerEncoded,
    ): Effect.Effect<void> => {
      try {
        const encoded = parser.encode(response)
        if (encoded === undefined) return Effect.void
        return Effect.orDie(writer.write(encoded))
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
        return writer.write(encoded).pipe(
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
        supportsNotifications: true,
        codecFor: serialization.codecFor,
      })
    })

    // The client side mirrors `RpcClient.makeProtocolSocket`: responses that
    // carry a requestId go to the client that issued the request; anything
    // else is broadcast to every active client on this socket.
    const clientProtocolService = yield* RpcClient.Protocol.make(
      (writeResponse, clientIds) => {
        const requestClients = new Map<string | number, number>()
        routeToClient = (response) => {
          if ("requestId" in response) {
            const clientId = requestClients.get(response.requestId)
            if (clientId !== undefined) {
              if (response._tag === "Exit") requestClients.delete(response.requestId)
              return writeResponse(clientId, response)
            }
          }
          return Effect.forEach(
            clientIds,
            (clientId) => writeResponse(clientId, response),
            { discard: true },
          )
        }
        return Effect.succeed({
          send: (clientId, request) => {
            if (request._tag === "Request") requestClients.set(request.id, clientId)
            return sendFromClient(request)
          },
          supportsAck: true,
          supportsTransferables: false,
          codecFor: serialization.codecFor,
        })
      },
    )

    return {
      serverProtocol: Layer.succeed(RpcServer.Protocol, serverProtocolService),
      clientProtocol: Layer.succeed(RpcClient.Protocol, clientProtocolService),
      closed: Deferred.await(closed),
    } as const
  })
