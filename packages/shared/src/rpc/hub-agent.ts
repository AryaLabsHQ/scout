import { Schema } from "effect"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import {
  ManagementError,
  PluginActionResultSchema,
  PluginLogsLocalParamsSchema,
  PluginRunActionLocalParamsSchema,
} from "../schemas/management.js"
import { TerminalOutputSchema } from "../schemas/terminal.js"
import { LogBatchSchema } from "../schemas/logs.js"

/**
 * HubAgentRpcs — the RPC group that the **hub** calls on the **agent**.
 *
 * Used on the hub→agent direction of the shared duplex WebSocket. The
 * hub acts as the RPC client; the agent acts as the RPC server.
 *
 * All payloads here are agent-local (no `agentId` — the target is implicit
 * in which connection the hub is calling on). The client-facing hub RPC
 * layer takes an `agentId` and routes to the right agent's RpcClient.
 */

// ─── Terminal targets (without agentId — session is bound to this conn) ──

const TerminalOpenLocalParams = Schema.Struct({
  mode: Schema.Literal("shell"),
  cols: Schema.Number,
  rows: Schema.Number,
})

const TerminalInputLocalParams = Schema.Struct({
  sessionId: Schema.String,
  dataBase64: Schema.String,
})

const TerminalResizeLocalParams = Schema.Struct({
  sessionId: Schema.String,
  cols: Schema.Number,
  rows: Schema.Number,
})

const TerminalCloseLocalParams = Schema.Struct({
  sessionId: Schema.String,
})

// ─── RPC group ────────────────────────────────────────────────────────────

export const HubAgentRpcs = RpcGroup.make(
  Rpc.make("plugins.runAction", {
    payload: PluginRunActionLocalParamsSchema,
    success: PluginActionResultSchema,
    error: ManagementError,
  }),

  // Terminal — open is a stream, input/resize/close are mutations
  Rpc.make("terminal.open", {
    payload: TerminalOpenLocalParams,
    success: TerminalOutputSchema,
    error: ManagementError,
    stream: true,
  }),
  Rpc.make("terminal.input", {
    payload: TerminalInputLocalParams,
    error: ManagementError,
  }),
  Rpc.make("terminal.resize", {
    payload: TerminalResizeLocalParams,
    error: ManagementError,
  }),
  Rpc.make("terminal.close", {
    payload: TerminalCloseLocalParams,
    error: ManagementError,
  }),

  Rpc.make("plugins.logs", {
    payload: PluginLogsLocalParamsSchema,
    success: LogBatchSchema,
    error: ManagementError,
    stream: true,
  }),
)
