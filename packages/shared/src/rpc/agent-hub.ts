import { Schema } from "effect"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import { AgentCapabilitiesSchema } from "../schemas/system.js"
import { AgentReportSchema } from "../schemas/agent-report.js"

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
})

export const AgentConnectResult = Schema.Struct({
  systemId: Schema.String,
})

export class AgentConnectError extends Schema.ErrorClass<AgentConnectError>(
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
    payload: AgentReportSchema,
  }),
)
