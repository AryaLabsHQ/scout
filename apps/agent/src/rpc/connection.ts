/**
 * Hub connection for the new @effect/rpc protocol.
 *
 * Opens a WebSocket to the hub's /ws/rpc/agent path, wraps it with
 * makeDuplexRpcProtocols, starts an RpcServer for HubAgentRpcs (so the
 * agent handles hub-initiated commands), and builds an RpcClient for
 * AgentHubRpcs (so the agent can call agent.connect + agent.report).
 *
 * After a successful agent.connect call the RpcClient is exposed as the
 * `HubClient` service for use by Reporter.
 *
 * Reconnects with exponential backoff (1s→2s→4s→8s→16s→30s cap ±20% jitter)
 * on any socket error or disconnect.
 */

import { Cause, Duration, Effect, Layer, Ref, Schedule } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import * as Socket from "effect/unstable/socket/Socket"
import * as RpcClient from "effect/unstable/rpc/RpcClient"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as RpcServer from "effect/unstable/rpc/RpcServer"
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"
import {
  AgentHubRpcs,
  HubAgentRpcs,
  makeDuplexRpcProtocols,
} from "@scout/shared"
import { AgentConfig } from "../config.js"
import { CollectorRegistry } from "../services/collector-registry.js"
import { AgentPluginHost } from "../services/plugin-host.js"
import { HubAgentHandlersLive } from "./handlers.js"

// ── HubClient service ─────────────────────────────────────────────────────────

export type HubAgentRpcClient = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof AgentHubRpcs>,
  RpcClientError
>

/**
 * The typed RPC client for calls the agent makes to the hub
 * (agent.connect, agent.report). Available after the connection is
 * established and agent.connect succeeds.
 */
export class HubClient extends ServiceMap.Service<HubClient, HubAgentRpcClient>()(
  "@scout/HubClient",
) {}

// ── Backoff schedule ──────────────────────────────────────────────────────────

const reconnectSchedule = Schedule.exponential("1 second").pipe(
  Schedule.modifyDelay((_, delay) => {
    const millis = Duration.toMillis(Duration.fromInputUnsafe(delay))
    const capped = Math.min(millis, 30_000)
    const jitter = capped * 0.2 * (Math.random() * 2 - 1)
    return Effect.succeed(Duration.millis(Math.max(100, capped + jitter)))
  }),
)

// ── Single connection attempt ─────────────────────────────────────────────────

/**
 * One attempt to dial the hub, handshake, and run server+client concurrently.
 */
const makeConnectOnce = (
  wsUrl: string,
  clientRef: Ref.Ref<HubAgentRpcClient | null>,
) =>
  Effect.gen(function* () {
    const config = yield* AgentConfig.load
    const registry = yield* CollectorRegistry
    const pluginHost = yield* AgentPluginHost

    const capabilities = yield* registry.discover()
    const pluginCapabilities = yield* pluginHost.listCapabilities()

    yield* Effect.logInfo("HubConnection: connecting", { url: wsUrl })

    // Build a WebSocket socket using globalThis.WebSocket (available in Bun)
    const socket = yield* Socket.makeWebSocket(Effect.succeed(wsUrl)).pipe(
      Effect.provide(
        Layer.succeed(Socket.WebSocketConstructor)(
          (url, protocols) => new globalThis.WebSocket(url, protocols),
        ),
      ),
    )

    // All per-connection work runs in a scoped region so finalizers clean up
    yield* Effect.scoped(
      Effect.gen(function* () {
        // Build dual-direction protocols over the single socket
        const { serverProtocol, clientProtocol } = yield* makeDuplexRpcProtocols(socket)

        // ── RPC client (agent → hub) ──────────────────────────────────────────
        const agentHubClient = yield* RpcClient.make(AgentHubRpcs).pipe(
          Effect.provide(clientProtocol),
        )

        // ── Handshake ─────────────────────────────────────────────────────────
        const { systemId } = yield* agentHubClient["agent.connect"]({
          token: config.token,
          hostname: config.hostname,
          version: "0.0.1",
          platform: process.platform,
          capabilities,
          pluginCapabilities,
        })

        yield* Effect.logInfo("HubConnection: connected", {
          hostname: config.hostname,
          systemId,
        })

        // Publish the client so Reporter can use it
        yield* Ref.set(clientRef, agentHubClient)

        // ── RPC server (hub → agent) ──────────────────────────────────────────
        // RpcServer.make runs forever until the scope is closed
        yield* RpcServer.make(HubAgentRpcs, {
          disableFatalDefects: true,
        }).pipe(
          Effect.provide(
            HubAgentHandlersLive.pipe(
              Layer.provide(Layer.succeed(AgentPluginHost, pluginHost)),
            ),
          ),
          Effect.provide(serverProtocol),
        )
      }).pipe(
        Effect.provide(RpcSerialization.layerNdjson),
        Effect.ensuring(
          Ref.set(clientRef, null).pipe(
            Effect.flatMap(() =>
              Effect.logInfo("HubConnection: disconnected"),
            ),
          ),
        ),
      ),
    )
  })

// ── HubConnectionLayer ────────────────────────────────────────────────────────

/**
 * Runs the hub connection fiber and provides `HubClient`.
 *
 * The fiber reconnects indefinitely with exponential backoff until the
 * process exits.
 */
export const HubConnectionLayer = Layer.effect(
  HubClient,
  Effect.gen(function* () {
    const config = yield* AgentConfig.load
    const clientRef = yield* Ref.make<HubAgentRpcClient | null>(null)

    const wsUrl =
      config.hubUrl.replace(/^http/, "ws").replace(/\/$/, "") +
      "/ws/rpc/agent"

    // Fork the reconnect loop as a detached fiber
    yield* makeConnectOnce(wsUrl, clientRef).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning(
          "HubConnection: attempt failed, will retry",
          { error: Cause.pretty(cause) },
        ),
      ),
      Effect.retry(reconnectSchedule),
      Effect.forkDetach,
    )

    // Proxy: each method call reads the live clientRef at invocation time
    const proxy: HubAgentRpcClient = new Proxy({} as HubAgentRpcClient, {
      get(_target, prop: string) {
        return (payload: unknown, options?: unknown) =>
          Effect.gen(function* () {
            const live = yield* Ref.get(clientRef)
            if (live === null) {
              return yield* Effect.die(
                new Error("HubClient: not connected"),
              )
            }
            const method = (live as Record<string, unknown>)[prop]
            if (typeof method !== "function") {
              return yield* Effect.die(
                new Error(`HubClient: unknown method ${prop}`),
              )
            }
            return yield* (method as (...args: unknown[]) => Effect.Effect<unknown>).call(live, payload, options)
          })
      },
    })

    return proxy
  }),
)
