/**
 * RPC server layer composition.
 *
 * Exposes two WebSocket endpoints:
 *   /ws/rpc       — ClientHubRpcs (browsers, Cloudflare Access identity)
 *   /ws/rpc/agent — AgentHubRpcs  (agents via DuplexRpcSocket, SCOUT_TOKEN)
 *
 * Both upgrades are authenticated by `HttpAuthGate` before they reach these
 * routes; `ClientAuthMiddlewareLive` re-verifies each browser RPC.
 */

import { Effect, Layer } from "effect"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as RpcServer from "effect/rpc/RpcServer"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import { ClientHubRpcs } from "@scout/shared"
import { ClientAuthMiddlewareLive } from "./auth.js"
import { ClientHandlersLive } from "./client-handlers.js"
import { AgentRegistry, handleAgentRpcWebSocket } from "./agent-bridge.js"

// ── ClientHubRpcs server at /ws/rpc ──────────────────────────────────────────

/**
 * Serves all ClientHubRpcs over a WebSocket at /ws/rpc.
 * Requires: HttpRouter, BrowserAuth, all service layers from AppLayer.
 */
export const ClientRpcServerLayer = RpcServer.layer(ClientHubRpcs, {
  disableFatalDefects: true,
}).pipe(
  Layer.provide(ClientHandlersLive),
  Layer.provide(ClientAuthMiddlewareLive),
  Layer.provide(RpcServer.layerProtocolWebsocket({ path: "/ws/rpc" })),
  Layer.provide(RpcSerialization.layerNdjson),
)

// ── AgentRegistry ─────────────────────────────────────────────────────────────

/**
 * Single source of truth for connected agents: owns DB lifecycle (online/
 * offline status + 5-second grace period + capabilities persistence) and
 * stores the per-agent typed HubAgentRpcs client used by management calls.
 * Populated by the WS bridge when an agent connects via /ws/rpc/agent.
 */
export const AgentRegistryLayer = AgentRegistry.layer

// ── /ws/rpc/agent route ───────────────────────────────────────────────────────

/**
 * HTTP route that upgrades agent connections to the duplex RPC protocol.
 * Each new WS connection runs its own RpcServer + RpcClient pair.
 */
export const AgentRpcRoute = HttpRouter.add(
  "GET",
  "/ws/rpc/agent",
  Effect.gen(function* () {
    yield* handleAgentRpcWebSocket.pipe(Effect.ignore)
    return HttpServerResponse.empty()
  }),
)

// ── Combined RPC layer ────────────────────────────────────────────────────────

/**
 * Full RPC layer to add to AppLayer.
 * Includes the client-facing WS server, the agent registry, and the
 * /ws/rpc/agent route layer.
 */
export const RpcLayer = Layer.mergeAll(ClientRpcServerLayer, AgentRegistryLayer, AgentRpcRoute)
