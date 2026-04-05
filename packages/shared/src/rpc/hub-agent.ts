import { Schema } from "effect"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import { ManagementError, SystemdUnitFileSchema, DockerInspectResultSchema, K8sDescribeResultSchema } from "../schemas/management.js"
import { TerminalOutputSchema } from "../schemas/terminal.js"
import { LogBatchSchema, LogSourceSchema } from "../schemas/logs.js"

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

// ─── Systemd unit targets (without agentId) ───────────────────────────────

const UnitParams = Schema.Struct({ unit: Schema.String })
const UnitContentParams = Schema.Struct({
  unit: Schema.String,
  content: Schema.String,
})
const VoidParams = Schema.Struct({})

// ─── Docker container targets (without agentId) ───────────────────────────

const ContainerParams = Schema.Struct({ containerId: Schema.String })

// ─── K8s targets (without agentId) ────────────────────────────────────────

const K8sScaleLocalParams = Schema.Struct({
  namespace: Schema.String,
  deployment: Schema.String,
  replicas: Schema.Number,
})

const K8sPodLocalParams = Schema.Struct({
  namespace: Schema.String,
  pod: Schema.String,
})

const K8sDescribeLocalParams = Schema.Struct({
  resource: Schema.String,
  name: Schema.String,
  namespace: Schema.String,
})

// ─── Terminal targets (without agentId — session is bound to this conn) ──

const TerminalOpenLocalParams = Schema.Struct({
  mode: Schema.Literals(["shell", "podExec"]),
  cols: Schema.Number,
  rows: Schema.Number,
  podName: Schema.optionalKey(Schema.String),
  namespace: Schema.optionalKey(Schema.String),
  container: Schema.optionalKey(Schema.String),
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

// ─── Logs targets (without agentId) ───────────────────────────────────────

const LogsTailLocalParams = Schema.Struct({
  source: LogSourceSchema,
  target: Schema.String,
  namespace: Schema.optionalKey(Schema.String),
  container: Schema.optionalKey(Schema.String),
  tail: Schema.optionalKey(Schema.Number),
})

// ─── RPC group ────────────────────────────────────────────────────────────

export const HubAgentRpcs = RpcGroup.make(
  // Systemd mutations
  Rpc.make("systemd.start", { payload: UnitParams, error: ManagementError }),
  Rpc.make("systemd.stop", { payload: UnitParams, error: ManagementError }),
  Rpc.make("systemd.restart", { payload: UnitParams, error: ManagementError }),
  Rpc.make("systemd.enable", { payload: UnitParams, error: ManagementError }),
  Rpc.make("systemd.disable", { payload: UnitParams, error: ManagementError }),
  Rpc.make("systemd.reload", { payload: VoidParams, error: ManagementError }),
  Rpc.make("systemd.unitFile", {
    payload: UnitParams,
    success: SystemdUnitFileSchema,
    error: ManagementError,
  }),
  Rpc.make("systemd.unitFileEdit", {
    payload: UnitContentParams,
    error: ManagementError,
  }),

  // Docker mutations
  Rpc.make("docker.start", { payload: ContainerParams, error: ManagementError }),
  Rpc.make("docker.stop", { payload: ContainerParams, error: ManagementError }),
  Rpc.make("docker.restart", { payload: ContainerParams, error: ManagementError }),
  Rpc.make("docker.remove", { payload: ContainerParams, error: ManagementError }),
  Rpc.make("docker.inspect", {
    payload: ContainerParams,
    success: DockerInspectResultSchema,
    error: ManagementError,
  }),

  // K8s mutations
  Rpc.make("k8s.scale", { payload: K8sScaleLocalParams, error: ManagementError }),
  Rpc.make("k8s.restartPod", { payload: K8sPodLocalParams, error: ManagementError }),
  Rpc.make("k8s.describe", {
    payload: K8sDescribeLocalParams,
    success: K8sDescribeResultSchema,
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

  // Logs — single stream RPC, lifecycle tied to subscription scope
  Rpc.make("logs.tail", {
    payload: LogsTailLocalParams,
    success: LogBatchSchema,
    error: ManagementError,
    stream: true,
  }),
)
