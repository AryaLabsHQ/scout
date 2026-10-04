/**
 * Hub connection for the new @effect/rpc protocol.
 *
 * Opens a WebSocket to the hub's /ws/rpc/agent path (authenticated with
 * `Authorization: Bearer <SCOUT_TOKEN>` on the upgrade), wraps it with
 * makeDuplexRpcProtocols, starts an RpcServer for HubAgentRpcs (so the
 * agent handles hub-initiated commands), and builds an RpcClient for
 * AgentHubRpcs (so the agent can call agent.connect + agent.report).
 *
 * After a successful agent.connect call the RpcClient is exposed as the
 * `HubClient` service for use by Reporter.
 *
 * Liveness: the socket close event covers a hub that exits, and an RPC
 * heartbeat covers a hub that stops answering without closing the stream.
 * Either ends the session, clears `HubClient`, and logs the disconnect.
 *
 * Reconnects immediately after a session ends, then backs off exponentially
 * (capped, ±20% jitter) while the hub stays unreachable. The backoff starts
 * over after every successful handshake.
 */

import { Cause, Data, Duration, Effect, Fiber, Layer, Ref, Schedule, Scope } from "effect"
import * as Context from "effect/Context"
import * as Socket from "effect/socket/Socket"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcServer from "effect/rpc/RpcServer"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import type { RpcClientError } from "effect/rpc/RpcClientError"
import { AgentHubRpcs, type DuplexCloseReason, HubAgentRpcs, makeDuplexRpcProtocols } from "@scout/shared"
import { AgentConfig } from "../config.js"
import { CollectorRegistry } from "../services/collector-registry.js"
import { AgentPluginHost } from "../services/plugin-host.js"
import { HubAgentHandlersLive } from "./handlers.js"

// ── HubClient service ─────────────────────────────────────────────────────────

export type HubAgentRpcClient = RpcClient.RpcClient<RpcGroup.Rpcs<typeof AgentHubRpcs>, RpcClientError>

/**
 * The typed RPC client for calls the agent makes to the hub
 * (agent.connect, agent.report). Available after the connection is
 * established and agent.connect succeeds.
 */
export class HubClient extends Context.Service<HubClient, HubAgentRpcClient>()("@scout/HubClient") {}

class HubHandshakeAborted extends Data.TaggedError("HubHandshakeAborted")<{
  readonly reason: DuplexCloseReason
}> {}

// ── Timing ────────────────────────────────────────────────────────────────────

export interface HubConnectionTiming {
  /** RPC ping interval; a silent hub is detected within two intervals. */
  readonly heartbeatInterval: Duration.Input
  /** Maximum time for the socket to open and `agent.connect` to answer. */
  readonly handshakeTimeout: Duration.Input
  /** First retry delay while the hub is unreachable. */
  readonly retryBase: Duration.Input
  /** Retry delay ceiling before ±20% jitter. */
  readonly retryCap: Duration.Input
  /** How long to wait for a dead session to release its resources. */
  readonly teardownTimeout: Duration.Input
}

/**
 * Defaults keep detection under 10s and the reconnect gap under 5s once
 * the hub is reachable again.
 */
export const defaultHubConnectionTiming: HubConnectionTiming = {
  heartbeatInterval: "4 seconds",
  handshakeTimeout: "10 seconds",
  retryBase: "500 millis",
  retryCap: "4 seconds",
  teardownTimeout: "5 seconds",
}

// ── Single session ────────────────────────────────────────────────────────────

/**
 * Dial the hub, handshake, and serve hub-initiated RPCs until the session
 * ends.
 *
 * Fails when the session never got past the handshake, so the caller backs
 * off. Succeeds once an established session ends, so the caller reconnects
 * right away with a fresh backoff.
 */
const runSession = (
  wsUrl: string,
  clientRef: Ref.Ref<HubAgentRpcClient | null>,
  timing: HubConnectionTiming,
) =>
  Effect.gen(function* () {
    const config = yield* AgentConfig.load
    const registry = yield* CollectorRegistry
    const pluginHost = yield* AgentPluginHost

    const capabilities = yield* registry.discover()
    const pluginCapabilities = yield* pluginHost.listCapabilities()

    yield* Effect.logInfo("HubConnection: connecting", { url: wsUrl })

    // Bun's WebSocket accepts upgrade headers; the hub rejects the upgrade
    // unless it carries the agent token.
    const socket = yield* Socket.makeWebSocket(wsUrl, {
      openTimeout: timing.handshakeTimeout,
    }).pipe(
      Effect.provideService(
        Socket.WebSocketConstructor,
        (url) =>
          new globalThis.WebSocket(url, {
            headers: { authorization: `Bearer ${config.token}` },
          }),
      ),
    )

    // The session owns a scope that is closed explicitly below, so a
    // finalizer that never finishes cannot hold up the reconnect.
    const scope = yield* Scope.make()
    const session = Effect.gen(function* () {
      const { serverProtocol, clientProtocol, closed } = yield* makeDuplexRpcProtocols(socket, {
        heartbeatInterval: timing.heartbeatInterval,
      })

      // ── RPC client (agent → hub) ────────────────────────────────────────
      const agentHubClient = yield* RpcClient.make(AgentHubRpcs).pipe(Effect.provide(clientProtocol))

      // ── Handshake ───────────────────────────────────────────────────────
      const { systemId } = yield* agentHubClient["agent.connect"]({
        token: config.token,
        hostname: config.hostname,
        version: "0.0.1",
        platform: process.platform,
        capabilities,
        pluginCapabilities,
      }).pipe(
        Effect.raceFirst(
          closed.pipe(Effect.flatMap((reason) => Effect.fail(new HubHandshakeAborted({ reason })))),
        ),
        Effect.timeout(timing.handshakeTimeout),
      )

      yield* Effect.logInfo("HubConnection: connected", {
        hostname: config.hostname,
        systemId,
      })
      yield* Ref.set(clientRef, agentHubClient)

      // ── RPC server (hub → agent) until the session ends ─────────────────
      // The server runs in the session scope rather than racing `closed`
      // directly: interrupting it waits for every in-flight handler to
      // release (plugin streams stop their child processes), and that wait
      // belongs to the bounded teardown below, not to noticing the drop.
      const server = yield* RpcServer.make(HubAgentRpcs, {
        disableFatalDefects: true,
      }).pipe(
        Effect.provide(HubAgentHandlersLive.pipe(Layer.provide(Layer.succeed(AgentPluginHost, pluginHost)))),
        Effect.provide(serverProtocol),
        Effect.forkScoped,
      )
      const reason = yield* closed.pipe(Effect.raceFirst(Fiber.join(server)))

      // Unpublish before teardown so callers fail fast instead of writing
      // into a dead session.
      yield* Ref.set(clientRef, null)
      yield* Effect.logWarning("HubConnection: disconnected", { reason })
    }).pipe(Effect.provide(RpcSerialization.layerNdjson), Scope.provide(scope))

    const exit = yield* Effect.exit(session)
    yield* Ref.set(clientRef, null)

    const teardown = yield* Scope.close(scope, exit).pipe(Effect.forkDetach)
    yield* Fiber.await(teardown).pipe(
      Effect.timeoutOrElse({
        duration: timing.teardownTimeout,
        orElse: () =>
          Effect.logWarning("HubConnection: session teardown is still running; reconnecting anyway"),
      }),
    )

    return yield* exit
  })

// ── HubConnectionLayer ────────────────────────────────────────────────────────

/**
 * Runs the hub connection fiber and provides `HubClient`.
 *
 * The fiber reconnects indefinitely for as long as the layer is alive.
 */
export const makeHubConnectionLayer = (timing: HubConnectionTiming) =>
  Layer.effect(
    HubClient,
    Effect.gen(function* () {
      const config = yield* AgentConfig.load
      const clientRef = yield* Ref.make<HubAgentRpcClient | null>(null)

      const wsUrl = config.hubUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws/rpc/agent"

      const retrySchedule = Schedule.min([
        Schedule.exponential(timing.retryBase),
        Schedule.spaced(timing.retryCap),
      ]).pipe(Schedule.jittered)

      // Each retry run starts a fresh schedule, so the backoff resets after
      // every established session.
      yield* runSession(wsUrl, clientRef, timing).pipe(
        Effect.tapCause((cause) =>
          Effect.logWarning("HubConnection: attempt failed, will retry", { error: Cause.pretty(cause) }),
        ),
        Effect.retry(retrySchedule),
        Effect.forever,
        Effect.forkScoped,
      )

      // Proxy: each method call reads the live clientRef at invocation time
      const proxy: HubAgentRpcClient = new Proxy({} as HubAgentRpcClient, {
        get(_target, prop: string) {
          return (payload: unknown, options?: unknown) =>
            Effect.gen(function* () {
              const live = yield* Ref.get(clientRef)
              if (live === null) {
                return yield* Effect.die(new Error("HubClient: not connected"))
              }
              const method = (live as Record<string, unknown>)[prop]
              if (typeof method !== "function") {
                return yield* Effect.die(new Error(`HubClient: unknown method ${prop}`))
              }
              return yield* (method as (...args: unknown[]) => Effect.Effect<unknown>).call(
                live,
                payload,
                options,
              )
            })
        },
      })

      return proxy
    }),
  )

export const HubConnectionLayer = makeHubConnectionLayer(defaultHubConnectionTiming)
