import { Schema } from "effect"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import { ClientAuthMiddleware } from "./client-auth.js"

import {
  OperatorApprovalResolveParamsSchema,
  OperatorModelDescriptorSchema,
  OperatorPromptParamsSchema,
  OperatorSessionCreateParamsSchema,
  OperatorSessionDetailSchema,
  OperatorSessionForkParamsSchema,
  OperatorSessionIdParamsSchema,
  OperatorSessionSetApprovalModeParamsSchema,
  OperatorSessionSetPlanModeParamsSchema,
  OperatorSessionSetSkillsParamsSchema,
  OperatorSessionSetTitleParamsSchema,
  OperatorSkillSchema,
  OperatorSessionSummarySchema,
} from "../schemas/operator.js"
import { AlertEventSchema, AlertSchema, AlertRuleSchema } from "../schemas/alerts.js"
import { LogBatchSchema } from "../schemas/logs.js"
import {
  ManagementError,
  PluginActionResultSchema,
  PluginLogsParamsSchema,
  PluginRunActionParamsSchema,
} from "../schemas/management.js"
import {
  EntitySnapshotSchema,
  EventRecordSchema,
  MetricPointSchema,
} from "@scout/plugin-sdk/schemas"
import {
  PluginEntitiesParamsSchema,
  PluginEventsParamsSchema,
  PluginMetricsParamsSchema,
} from "../schemas/plugin-data.js"
import { SystemSchema } from "../schemas/system.js"
import { SystemMetricsSampleSchema } from "../schemas/system-metrics.js"
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
 * Every RPC runs behind `ClientAuthMiddleware`, which fails with
 * `Unauthorized` unless the hub verified the caller's identity.
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
  Rpc.make("operator.sessions.list", {
    success: Schema.Array(OperatorSessionSummarySchema),
  }),
  Rpc.make("operator.sessions.get", {
    payload: OperatorSessionIdParamsSchema,
    success: Schema.NullOr(OperatorSessionDetailSchema),
  }),
  Rpc.make("operator.skills.list", {
    success: Schema.Array(OperatorSkillSchema),
  }),
  Rpc.make("operator.models.list", {
    success: Schema.Array(OperatorModelDescriptorSchema),
  }),
  Rpc.make("operator.sessions.fork", {
    payload: OperatorSessionForkParamsSchema,
    success: OperatorSessionDetailSchema,
    error: ManagementError,
  }),
  Rpc.make("systems.metrics", {
    payload: Schema.Struct({
      id: Schema.String,
      range: MetricsRangeSchema,
    }),
    success: Schema.Array(SystemMetricsSampleSchema),
  }),
  Rpc.make("alerts.list", {
    success: Schema.Array(AlertSchema),
  }),
  Rpc.make("alertRules.list", {
    success: Schema.Array(AlertRuleSchema),
  }),
  /** Latest entity snapshots a plugin reported for one system (e.g. systemd units, k8s workloads). */
  Rpc.make("plugins.entities", {
    payload: PluginEntitiesParamsSchema,
    success: Schema.Array(EntitySnapshotSchema),
  }),
  /** Plugin metric points for one system over a look-back window. */
  Rpc.make("plugins.metrics", {
    payload: PluginMetricsParamsSchema,
    success: Schema.Array(MetricPointSchema),
  }),
  /** Plugin events (e.g. k8s warnings) for one system over a look-back window. */
  Rpc.make("plugins.events", {
    payload: PluginEventsParamsSchema,
    success: Schema.Array(EventRecordSchema),
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

  // Alert rule edits (settings page)
  Rpc.make("alertRules.update", {
    payload: Schema.Struct({
      id: Schema.String,
      threshold: Schema.optional(Schema.Number),
      consecutiveCount: Schema.optional(Schema.Number),
      severity: Schema.optional(Schema.Literals(["warning", "critical"])),
      enabled: Schema.optional(Schema.Boolean),
    }),
    success: AlertRuleSchema,
    error: ManagementError,
  }),

  // System removal (settings page; fails if agent is currently connected)
  Rpc.make("systems.remove", {
    payload: Schema.Struct({ id: Schema.String }),
    error: ManagementError,
  }),
  Rpc.make("operator.sessions.create", {
    payload: OperatorSessionCreateParamsSchema,
    success: OperatorSessionDetailSchema,
    error: ManagementError,
  }),
  Rpc.make("operator.sessions.setTitle", {
    payload: OperatorSessionSetTitleParamsSchema,
    error: ManagementError,
  }),
  Rpc.make("operator.prompt", {
    payload: OperatorPromptParamsSchema,
    error: ManagementError,
  }),
  Rpc.make("operator.sessions.abort", {
    payload: OperatorSessionIdParamsSchema,
    error: ManagementError,
  }),
  Rpc.make("operator.approvals.resolve", {
    payload: OperatorApprovalResolveParamsSchema,
    error: ManagementError,
  }),
  Rpc.make("operator.sessions.setApprovalMode", {
    payload: OperatorSessionSetApprovalModeParamsSchema,
    error: ManagementError,
  }),
  Rpc.make("operator.sessions.setPlanMode", {
    payload: OperatorSessionSetPlanModeParamsSchema,
    error: ManagementError,
  }),
  Rpc.make("operator.sessions.setSkills", {
    payload: OperatorSessionSetSkillsParamsSchema,
    success: OperatorSessionDetailSchema,
    error: ManagementError,
  }),
  Rpc.make("operator.sessions.archive", {
    payload: OperatorSessionIdParamsSchema,
    error: ManagementError,
  }),
  Rpc.make("operator.sessions.delete", {
    payload: OperatorSessionIdParamsSchema,
    error: ManagementError,
  }),

  // Generic plugin control
  Rpc.make("plugins.runAction", {
    payload: PluginRunActionParamsSchema,
    success: PluginActionResultSchema,
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

  /** Fire-hose of core metrics samples from every connected agent, coalesced at 100ms. */
  Rpc.make("metrics.subscribe", {
    success: SystemMetricsSampleSchema,
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
  /** The session's projected detail: one snapshot on subscribe, then one per durable change (coalesced). */
  Rpc.make("operator.sessions.watch", {
    payload: OperatorSessionIdParamsSchema,
    success: OperatorSessionDetailSchema,
    error: ManagementError,
    stream: true,
  }),

  Rpc.make("plugins.logs", {
    payload: PluginLogsParamsSchema,
    success: LogBatchSchema,
    error: ManagementError,
    stream: true,
  }),

  /**
   * Open a terminal session. First chunk carries the allocated sessionId;
   * subsequent chunks are output, and a final `exit` chunk may be emitted
   * before the stream closes. Input flows via the `terminal.input`
   * mutation using the sessionId from the first chunk.
   */
  Rpc.make("terminal.open", {
    payload: TerminalOpenParamsSchema,
    success: TerminalOutputSchema,
    error: ManagementError,
    stream: true,
  }),
).middleware(ClientAuthMiddleware)
