/**
 * Agent RPC bridge — the /ws/rpc/agent endpoint.
 *
 * On each WS upgrade:
 *   1. Wrap the socket with makeDuplexRpcProtocols
 *   2. Build an RpcClient<HubAgentRpcs> for hub-initiated commands
 *   3. Run an RpcServer<AgentHubRpcs> so agents can call agent.connect
 *      and agent.report
 *   4. When agent.connect succeeds, store the HubAgentClient in
 *      AgentRpcRegistry keyed by systemId
 *   5. On disconnect, remove the entry
 *
 * The `AgentRpcRegistry` maps agentId → RpcClient<HubAgentRpcs> so that
 * management handlers in client-handlers.ts can look up an agent's new-
 * protocol RPC client (replacing the AgentManager.call() bridge).
 */

import { Config, Effect, Layer, Ref } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
import * as RpcClient from "effect/unstable/rpc/RpcClient"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as RpcServer from "effect/unstable/rpc/RpcServer"
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"
import {
  AgentHubRpcs,
  HubAgentRpcs,
  AgentConnectError,
  makeDuplexRpcProtocols,
} from "@scout/shared"
import { AgentHandlersLive } from "./agent-handlers.js"

// ── RPC client type alias ─────────────────────────────────────────────────────

export type HubAgentClient = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof HubAgentRpcs>,
  RpcClientError
>

// ── AgentRpcRegistry service ──────────────────────────────────────────────────

/**
 * Registry of active agent RPC clients keyed by agentId.
 * Populated by the bridge when an agent connects via /ws/rpc/agent.
 */
export class AgentRpcRegistry extends ServiceMap.Service<
  AgentRpcRegistry,
  {
    /** Look up a connected agent's HubAgentRpcs client by agentId. */
    readonly get: (agentId: string) => Effect.Effect<HubAgentClient | null>
    /** Register a new agent client (called by the WS upgrade handler). */
    readonly set: (agentId: string, client: HubAgentClient) => Effect.Effect<void>
    /** Remove an agent client (called on disconnect). */
    readonly delete: (agentId: string) => Effect.Effect<void>
  }
>()(
  "@scout/AgentRpcRegistry",
  {
    make: Effect.gen(function* () {
      const ref = yield* Ref.make(new Map<string, HubAgentClient>())

      return {
        get: (agentId: string) =>
          Ref.get(ref).pipe(Effect.map((m) => m.get(agentId) ?? null)),

        set: (agentId: string, client: HubAgentClient) =>
          Ref.update(ref, (m) => {
            const next = new Map(m)
            next.set(agentId, client)
            return next
          }),

        delete: (agentId: string) =>
          Ref.update(ref, (m) => {
            const next = new Map(m)
            next.delete(agentId)
            return next
          }),
      }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}

// ── Per-connection RegisterAgent service ──────────────────────────────────────

/**
 * Per-connection service injected into the AgentHubRpcs handler so that
 * agent.connect can record the systemId back to the bridge.
 *
 * Returns void; the bridge reads the agentIdRef after agent.connect runs.
 */
export class RegisterAgent extends ServiceMap.Service<
  RegisterAgent,
  (systemId: string) => Effect.Effect<void>
>()(
  "@scout/RegisterAgent",
) {}

// ── Per-connection override for agent.connect ─────────────────────────────────

/**
 * Replaces the Phase-B agent.connect handler with one that:
 *   1. Validates the SCOUT_TOKEN
 *   2. Records the systemId via RegisterAgent
 *
 * This is provided via toLayerHandler so it replaces only agent.connect
 * (agent.report continues to come from AgentHandlersLive).
 */
const AgentConnectHandlerLive = AgentHubRpcs.toLayerHandler(
  "agent.connect",
  Effect.gen(function* () {
    const register = yield* RegisterAgent
    const expectedToken = yield* Config.string("SCOUT_TOKEN")

    return ({ hostname, token, version: _version, platform: _platform, capabilities: _capabilities }) =>
      Effect.gen(function* () {
        if (token !== expectedToken) {
          return yield* Effect.fail(
            new AgentConnectError({
              reason: "invalid-token",
              message: "Invalid SCOUT_TOKEN",
            }),
          )
        }

        yield* Effect.logInfo("agent.connect: accepted", { hostname })
        yield* register(hostname)

        return { systemId: hostname }
      })
  }),
)

// ── WS handler for /ws/rpc/agent ─────────────────────────────────────────────

/**
 * Handle one agent WebSocket connection.
 * Must be called from a route handler with an active Scope and
 * HttpServerRequest + AgentRpcRegistry in context.
 */
export const handleAgentRpcWebSocket = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const registry = yield* AgentRpcRegistry

  const socket = yield* Effect.orDie(request.upgrade)

  // Per-connection agentId slot — set by agent.connect handler
  const agentIdRef = yield* Ref.make<string | null>(null)

  yield* Effect.scoped(
    Effect.gen(function* () {
      const { serverProtocol, clientProtocol } = yield* makeDuplexRpcProtocols(socket)

      // Build the hub→agent RPC client
      const hubAgentClient = yield* RpcClient.make(HubAgentRpcs).pipe(
        Effect.provide(clientProtocol),
      )

      // Per-connection RegisterAgent: stores agentId in the agentIdRef and registry
      const registerAgentFn = (systemId: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* Ref.set(agentIdRef, systemId)
          yield* registry.set(systemId, hubAgentClient)
          yield* Effect.logInfo("agent registered in registry", { systemId })
        })

      const RegisterAgentLive = Layer.succeed(RegisterAgent)(registerAgentFn)

      // Run the agent→hub RpcServer
      // - AgentHandlersLive handles agent.report
      // - AgentConnectHandlerLive overrides agent.connect (validates token, registers)
      yield* RpcServer.make(AgentHubRpcs, {
        disableFatalDefects: true,
      }).pipe(
        Effect.provide(AgentHandlersLive),
        Effect.provide(AgentConnectHandlerLive),
        Effect.provide(RegisterAgentLive),
        Effect.provide(serverProtocol),
      )
    }).pipe(
      Effect.provide(RpcSerialization.layerNdjson),
      Effect.ensuring(
        Effect.gen(function* () {
          const agentId = yield* Ref.get(agentIdRef)
          if (agentId !== null) {
            yield* registry.delete(agentId)
            yield* Effect.logInfo("agent removed from registry", { agentId })
          }
        }),
      ),
    ),
  )
})
