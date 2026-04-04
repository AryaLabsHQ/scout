import { Cause, Deferred, Duration, Effect, Layer, Queue, Ref, Schedule, Stream } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import * as Socket from "effect/unstable/socket/Socket"
import type { ScoutMessage, RpcError, AgentCapabilities } from "@scout/shared"
import { isRpcEvent, isRpcResponse } from "@scout/shared"
import { Data } from "effect"
import { AgentConfig } from "../config.js"

// ── Errors ────────────────────────────────────────────────────────────────────

export class RpcTimeoutError extends Data.TaggedError("RpcTimeoutError")<{
  readonly method: string
  readonly timeoutMs: number
}> {}

export class HubConnectError extends Data.TaggedError("HubConnectError")<{
  readonly reason: string
}> {}

// ── Capabilities context tag ──────────────────────────────────────────────────

// Inject discovered capabilities at layer-composition time
export class AgentCapabilitiesCtx extends ServiceMap.Service<AgentCapabilitiesCtx, AgentCapabilities>()(
  "@scout/AgentCapabilitiesCtx"
) {}

// ── Service ───────────────────────────────────────────────────────────────────

// WebSocket client to hub. Auto-reconnect with exponential backoff.
export class HubConnection extends ServiceMap.Service<HubConnection, {
  /**
   * Send a message to the hub.
   */
  readonly send: (message: ScoutMessage) => Effect.Effect<void>
  /**
   * Stream of inbound messages from the hub.
   */
  readonly onMessage: Stream.Stream<ScoutMessage>
  /**
   * Current connection status.
   */
  readonly status: Effect.Effect<"connected" | "connecting" | "disconnected">
  /**
   * Invoke an RPC method on the hub and await the response.
   * Fails with RpcError if the hub returns an error, or RpcTimeoutError on timeout.
   */
  readonly invoke: (
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ) => Effect.Effect<unknown, RpcError | RpcTimeoutError>
}>()(
  "@scout/HubConnection",
  {
    make: Effect.gen(function* () {
      const config = yield* AgentConfig.load
      const capabilities = yield* AgentCapabilitiesCtx

      // Backing queue for inbound messages (routed to onMessage stream)
      const messageQueue = yield* Queue.unbounded<ScoutMessage>()

      // Pending RPC call deferreds, keyed by request ID
      type PendingDeferred = Deferred.Deferred<unknown, RpcError | RpcTimeoutError>
      const pending = yield* Ref.make(new Map<string, PendingDeferred>())

      // Current connection status
      const statusRef = yield* Ref.make<"connected" | "connecting" | "disconnected">("disconnected")

      // Current writer — set when connected, null otherwise
      const writerRef = yield* Ref.make<((data: string) => Effect.Effect<void, Socket.SocketError>) | null>(null)

      // ── send ────────────────────────────────────────────────────────────────

      const send = (message: ScoutMessage): Effect.Effect<void> =>
        Effect.gen(function* () {
          const writer = yield* Ref.get(writerRef)
          if (writer === null) return
          yield* writer(JSON.stringify(message)).pipe(Effect.ignore)
        })

      // ── resolve pending RPC call ────────────────────────────────────────────

      const resolveCall = (id: string, ok: boolean, result: unknown, error: RpcError | undefined): Effect.Effect<void> =>
        Effect.gen(function* () {
          const map = yield* Ref.get(pending)
          const deferred = map.get(id)
          if (!deferred) return
          yield* Ref.update(pending, (m) => {
            const next = new Map(m)
            next.delete(id)
            return next
          })
          if (ok) {
            yield* Deferred.succeed(deferred, result)
          } else {
            yield* Deferred.fail(deferred, error ?? { code: "UNKNOWN", message: "Unknown RPC error" })
          }
        })

      // ── invoke ──────────────────────────────────────────────────────────────

      const invoke = (
        method: string,
        params?: Record<string, unknown>,
        timeoutMs = 30_000,
      ): Effect.Effect<unknown, RpcError | RpcTimeoutError> =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          const deferred = yield* Deferred.make<unknown, RpcError | RpcTimeoutError>()
          yield* Ref.update(pending, (m) => new Map(m).set(id, deferred))

          const request: ScoutMessage = { id, method, params }
          yield* send(request)

          return yield* Effect.timeoutOrElse(Deferred.await(deferred), {
            duration: timeoutMs,
            orElse: () =>
              Ref.update(pending, (m) => {
                const next = new Map(m)
                next.delete(id)
                return next
              }).pipe(
                Effect.flatMap(() =>
                  Effect.fail(new RpcTimeoutError({ method, timeoutMs }))
                )
              ),
          })
        })

      // ── single connection attempt ────────────────────────────────────────────

      const wsUrl = config.hubUrl.replace(/^http/, "ws") + "/ws/agent"

      const connectOnce: Effect.Effect<void, Socket.SocketError | HubConnectError> =
        Effect.gen(function* () {
          yield* Ref.set(statusRef, "connecting")
          yield* Effect.log("HubConnection: connecting to " + wsUrl)

          const socket = yield* Socket.makeWebSocket(wsUrl).pipe(
            Effect.provide(
              Layer.succeed(Socket.WebSocketConstructor)(
                (url, protocols) => new globalThis.WebSocket(url, protocols)
              )
            )
          )

          // Acquire writer (scoped to connection lifetime)
          const writer = yield* Effect.scoped(socket.writer)
          yield* Ref.set(writerRef, (data: string) => writer(data))

          // Send connect RPC request
          const connectId = crypto.randomUUID()
          const connectMsg: ScoutMessage = {
            id: connectId,
            method: "connect",
            params: {
              token: config.token,
              hostname: config.hostname,
              version: "0.0.1",
              platform: process.platform,
              capabilities,
            },
          }
          yield* writer(JSON.stringify(connectMsg))

          // Deferred for connect acknowledgment
          const connectDeferred = yield* Deferred.make<void, HubConnectError>()

          // Last tick time for watchdog
          const lastTickRef = yield* Ref.make(Date.now())

          // Message receive loop
          const receiveLoop = socket.runRaw((raw) =>
            Effect.gen(function* () {
              const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw)
              let msg: ScoutMessage
              try {
                msg = JSON.parse(text) as ScoutMessage
              } catch {
                yield* Effect.logWarning("HubConnection: failed to parse message")
                return
              }

              if (isRpcEvent(msg)) {
                if (msg.event === "tick") {
                  yield* Ref.set(lastTickRef, Date.now())
                  return
                }
                yield* Queue.offer(messageQueue, msg)
                return
              }

              if (isRpcResponse(msg)) {
                if (msg.id === connectId) {
                  if (!msg.ok) {
                    yield* Deferred.fail(
                      connectDeferred,
                      new HubConnectError({ reason: msg.error?.message ?? "connect rejected" })
                    )
                  } else {
                    yield* Ref.set(statusRef, "connected")
                    yield* Effect.log("HubConnection: connected as " + config.hostname)
                    yield* Deferred.succeed(connectDeferred, void 0)
                  }
                  return
                }
                yield* resolveCall(msg.id, msg.ok, msg.result, msg.error)
                return
              }

              // RpcRequest (hub → agent command) — forward to message stream
              yield* Queue.offer(messageQueue, msg)
            })
          )

          // Tick watchdog: fail if no tick in 60s after connect
          const tickWatchdog: Effect.Effect<never, Socket.SocketError> = Deferred.await(connectDeferred).pipe(
            Effect.catchCause(() => Effect.never),
            Effect.flatMap(() =>
              Effect.forever(
                Effect.gen(function* () {
                  yield* Effect.sleep(Duration.seconds(10))
                  const last = yield* Ref.get(lastTickRef)
                  if (Date.now() - last > 60_000) {
                    yield* Effect.fail(
                      new Socket.SocketError({
                        reason: new Socket.SocketCloseError({ code: 4001, closeReason: "tick timeout" }),
                      })
                    )
                  }
                })
              )
            )
          )

          // Run receive loop; the tick watchdog races alongside it
          yield* Effect.race(receiveLoop, tickWatchdog)
        }).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              yield* Ref.set(writerRef, null)
              yield* Ref.set(statusRef, "disconnected")
              yield* Effect.log("HubConnection: disconnected")
            })
          )
        )

      // ── Reconnect loop with exponential backoff ──────────────────────────────

      // 1s → 2s → 4s → 8s → 16s → 30s (cap), ±20% jitter applied via modifyDelay
      const reconnectSchedule = Schedule.exponential("1 second").pipe(
        Schedule.modifyDelay((_, delay) => {
          const millis = Duration.toMillis(Duration.fromInputUnsafe(delay))
          const capped = Math.min(millis, 30_000)
          const jitter = capped * 0.2 * (Math.random() * 2 - 1)
          return Effect.succeed(Duration.millis(Math.max(100, capped + jitter)))
        })
      )

      yield* connectOnce.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(
            "HubConnection: connection failed, will retry",
            { error: Cause.pretty(cause) }
          )
        ),
        Effect.retry(reconnectSchedule),
        Effect.forkDetach
      )

      return {
        send,
        onMessage: Stream.fromQueue(messageQueue),
        status: Ref.get(statusRef),
        invoke,
      }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
