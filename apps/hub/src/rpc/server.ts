/**
 * RPC server layer composition.
 *
 * Exposes two WebSocket endpoints:
 *   /ws/rpc       — ClientHubRpcs (browsers)
 *   /ws/rpc/agent — AgentHubRpcs  (agents via DuplexRpcSocket)
 *
 * The old /ws/client and /ws/agent handlers in routes.ts are NOT modified
 * (they stay for Phase E / Phase I cleanup).
 */

import { Effect, Layer } from "effect"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import * as RpcServer from "effect/unstable/rpc/RpcServer"
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization"
import { ClientHubRpcs } from "@scout/shared"
import { AuthMiddlewareLive } from "./auth.js"
import { ClientHandlersLive } from "./client-handlers.js"
import { AgentRpcRegistry, handleAgentRpcWebSocket } from "./agent-bridge.js"

// ── ClientHubRpcs server at /ws/rpc ──────────────────────────────────────────

/**
 * Serves all ClientHubRpcs over a WebSocket at /ws/rpc.
 * Requires: HttpRouter, all service layers from AppLayer.
 */
export const ClientRpcServerLayer = RpcServer.layer(ClientHubRpcs, {
  disableFatalDefects: true,
}).pipe(
  Layer.provide(ClientHandlersLive),
  Layer.provide(AuthMiddlewareLive),
  Layer.provide(RpcServer.layerProtocolWebsocket({ path: "/ws/rpc" })),
  Layer.provide(RpcSerialization.layerNdjson),
)

// ── AgentRpcRegistry ──────────────────────────────────────────────────────────

/**
 * The registry of per-agent HubAgentRpcs clients.
 * Populated by the WS bridge when an agent connects via /ws/rpc/agent.
 */
export const AgentRegistryLayer = AgentRpcRegistry.layer

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
export const RpcLayer = Layer.mergeAll(
  ClientRpcServerLayer,
  AgentRegistryLayer,
  AgentRpcRoute,
)
