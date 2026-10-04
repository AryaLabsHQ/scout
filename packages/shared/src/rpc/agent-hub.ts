import { Schema } from "effect"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import { AgentCapabilitiesSchema } from "../schemas/system.js"
import { CoreMetricsPayloadSchema } from "../schemas/system-metrics.js"
import {
  PluginCapabilitySchema,
  PluginCollectionResultSchema,
} from "@scout/plugin-sdk/schemas"

/**
 * AgentHubRpcs — the RPC group that the **agent** calls on the **hub**.
 *
 * Used on the agent→hub direction of the shared duplex WebSocket. The
 * agent acts as the RPC client; the hub acts as the RPC server.
 */

export const AgentConnectPayload = Schema.Struct({
  token: Schema.String,
  hostname: Schema.String,
  version: Schema.String,
  platform: Schema.String,
  capabilities: AgentCapabilitiesSchema,
  pluginCapabilities: Schema.optionalKey(Schema.Array(PluginCapabilitySchema)),
})

export const AgentConnectResult = Schema.Struct({
  systemId: Schema.String,
})

export const AgentPluginCollectionPayload = Schema.Struct({
  systemId: Schema.String,
  collection: PluginCollectionResultSchema,
})

export class AgentConnectError extends Schema.Error<AgentConnectError>(
  "AgentConnectError",
)({
  _tag: Schema.tag("AgentConnectError"),
  reason: Schema.Literals(["invalid-token", "internal"]),
  message: Schema.String,
}) {}

export const AgentHubRpcs = RpcGroup.make(
  Rpc.make("agent.connect", {
    payload: AgentConnectPayload,
    success: AgentConnectResult,
    error: AgentConnectError,
  }),
  Rpc.make("agent.report", {
    payload: CoreMetricsPayloadSchema,
  }),
  Rpc.make("agent.reportPluginCollection", {
    payload: AgentPluginCollectionPayload,
  }),
)
