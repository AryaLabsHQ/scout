import { Schema } from "effect"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"

import { AgentReportSchema } from "../schemas/agent-report.js"
import { AlertEventSchema, AlertSchema, AlertRuleSchema } from "../schemas/alerts.js"
import { LogBatchSchema, LogsTailParamsSchema } from "../schemas/logs.js"
import {
  DockerContainerActionParamsSchema,
  DockerInspectResultSchema,
  K8sDescribeParamsSchema,
  K8sDescribeResultSchema,
  K8sRestartPodParamsSchema,
  K8sScaleParamsSchema,
  ManagementError,
  SystemdReloadParamsSchema,
  SystemdUnitActionParamsSchema,
  SystemdUnitFileEditParamsSchema,
  SystemdUnitFileParamsSchema,
  SystemdUnitFileSchema,
} from "../schemas/management.js"
import { SystemSchema } from "../schemas/system.js"
import {
  TerminalCloseParamsSchema,
  TerminalInputParamsSchema,
  TerminalOpenParamsSchema,
  TerminalOutputSchema,
  TerminalResizeParamsSchema,
} from "../schemas/terminal.js"

/**
 * ClientHubRpcs — the RPC group that the **browser** calls on the **hub**.
 *
 * Served by the hub at `/ws/rpc` via `RpcServer.layerProtocolWebsocket`.
 * Consumed by the browser via `AtomRpc.Service` → `HubClient.query` /
 * `HubClient.mutation`.
 *
 * Broadcasts (metrics, alerts, system status) are modeled as Stream RPCs
 * that the browser subscribes to on mount. The hub handler reads from its
 * internal PubSub and yields values into the stream; when the browser
 * closes its atom, the stream finalizes.
 */

// ─── Historical range for metrics queries ─────────────────────────────────

export const MetricsRangeSchema = Schema.Literals(["1h", "6h", "24h", "7d", "30d"])

// ─── System updates (broadcast) ───────────────────────────────────────────

export const SystemUpdateSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("connected"),
    system: SystemSchema,
  }),
  Schema.Struct({
    _tag: Schema.Literal("disconnected"),
    systemId: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal("updated"),
    system: SystemSchema,
  }),
])

// ─── RPC group ────────────────────────────────────────────────────────────

export const ClientHubRpcs = RpcGroup.make(
  // ── Queries (read-only, cacheable) ──
  Rpc.make("systems.list", {
    success: Schema.Array(SystemSchema),
  }),
  Rpc.make("systems.get", {
    payload: Schema.Struct({ id: Schema.String }),
    success: Schema.NullOr(SystemSchema),
  }),
  Rpc.make("systems.metrics", {
    payload: Schema.Struct({
      id: Schema.String,
      range: MetricsRangeSchema,
    }),
    success: Schema.Array(AgentReportSchema),
  }),
  Rpc.make("alerts.list", {
    success: Schema.Array(AlertSchema),
  }),
  Rpc.make("alertRules.list", {
    success: Schema.Array(AlertRuleSchema),
  }),

  // ── Mutations (state-changing) ──
  Rpc.make("alerts.ack", {
    payload: Schema.Struct({ alertId: Schema.String }),
    success: AlertSchema,
    error: ManagementError,
  }),
  Rpc.make("alerts.resolve", {
    payload: Schema.Struct({ alertId: Schema.String }),
    success: AlertSchema,
    error: ManagementError,
  }),

  // Systemd management (forwarded to target agent)
  Rpc.make("systemd.start", { payload: SystemdUnitActionParamsSchema, error: ManagementError }),
  Rpc.make("systemd.stop", { payload: SystemdUnitActionParamsSchema, error: ManagementError }),
  Rpc.make("systemd.restart", { payload: SystemdUnitActionParamsSchema, error: ManagementError }),
  Rpc.make("systemd.enable", { payload: SystemdUnitActionParamsSchema, error: ManagementError }),
  Rpc.make("systemd.disable", { payload: SystemdUnitActionParamsSchema, error: ManagementError }),
  Rpc.make("systemd.reload", { payload: SystemdReloadParamsSchema, error: ManagementError }),
  Rpc.make("systemd.unitFile", {
    payload: SystemdUnitFileParamsSchema,
    success: SystemdUnitFileSchema,
    error: ManagementError,
  }),
  Rpc.make("systemd.unitFileEdit", {
    payload: SystemdUnitFileEditParamsSchema,
    error: ManagementError,
  }),

  // Docker management (forwarded to target agent)
  Rpc.make("docker.start", { payload: DockerContainerActionParamsSchema, error: ManagementError }),
  Rpc.make("docker.stop", { payload: DockerContainerActionParamsSchema, error: ManagementError }),
  Rpc.make("docker.restart", { payload: DockerContainerActionParamsSchema, error: ManagementError }),
  Rpc.make("docker.remove", { payload: DockerContainerActionParamsSchema, error: ManagementError }),
  Rpc.make("docker.inspect", {
    payload: DockerContainerActionParamsSchema,
    success: DockerInspectResultSchema,
    error: ManagementError,
  }),

  // K8s management (forwarded to target agent)
  Rpc.make("k8s.scale", { payload: K8sScaleParamsSchema, error: ManagementError }),
  Rpc.make("k8s.restartPod", { payload: K8sRestartPodParamsSchema, error: ManagementError }),
  Rpc.make("k8s.describe", {
    payload: K8sDescribeParamsSchema,
    success: K8sDescribeResultSchema,
    error: ManagementError,
  }),

  // Terminal input-side mutations (output is delivered via terminal.open stream)
  Rpc.make("terminal.input", {
    payload: TerminalInputParamsSchema,
    error: ManagementError,
  }),
  Rpc.make("terminal.resize", {
    payload: TerminalResizeParamsSchema,
    error: ManagementError,
  }),
  Rpc.make("terminal.close", {
    payload: TerminalCloseParamsSchema,
    error: ManagementError,
  }),

  // ── Streams (server-pushed, subscribed by client) ──

  /** Fire-hose of AgentReports from every connected agent, coalesced at 100ms. */
  Rpc.make("metrics.subscribe", {
    success: AgentReportSchema,
    stream: true,
  }),

  /** Alert lifecycle events (triggered | acknowledged | resolved). */
  Rpc.make("alerts.subscribe", {
    success: AlertEventSchema,
    stream: true,
  }),

  /** System lifecycle events (connected | disconnected | updated). */
  Rpc.make("systems.subscribe", {
    success: SystemUpdateSchema,
    stream: true,
  }),

  /** Tail logs from a specific pod or systemd unit. Finalizes on unsubscribe. */
  Rpc.make("logs.tail", {
    payload: LogsTailParamsSchema,
    success: LogBatchSchema,
    error: ManagementError,
    stream: true,
  }),

  /**
   * Open a terminal session. First chunk carries the allocated sessionId;
   * subsequent chunks are output. Input flows via the `terminal.input`
   * mutation using the sessionId from the first chunk. Stream finalizes
   * when the PTY closes.
   */
  Rpc.make("terminal.open", {
    payload: TerminalOpenParamsSchema,
    success: TerminalOutputSchema,
    error: ManagementError,
    stream: true,
  }),
)
