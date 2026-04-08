import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core"

export const systems = sqliteTable("systems", {
  id: text("id").primaryKey(),
  hostname: text("hostname").notNull(),
  tailscaleIp: text("tailscale_ip"),
  status: text("status", { enum: ["online", "offline", "pending"] }).notNull().default("pending"),
  capabilities: text("capabilities", { mode: "json" }).notNull().default("{}"),
  pluginCapabilities: text("plugin_capabilities", { mode: "json" }).notNull().default("[]"),
  lastSeen: integer("last_seen", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

export const systemMetrics = sqliteTable("system_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  systemId: text("system_id").notNull().references(() => systems.id),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
  type: text("type", { enum: ["1m", "10m", "20m", "120m", "480m"] }).notNull().default("1m"),
  data: text("data", { mode: "json" }).notNull(), // JSON blob of SystemMetricsSample
}, (table) => [
  index("idx_metrics_system_time_type").on(table.systemId, table.timestamp, table.type),
])

export const pluginEntities = sqliteTable("plugin_entities", {
  key: text("key").primaryKey(),
  systemId: text("system_id").notNull().references(() => systems.id, { onDelete: "cascade" }),
  pluginId: text("plugin_id").notNull(),
  kind: text("kind").notNull(),
  entityId: text("entity_id").notNull(),
  observedAt: integer("observed_at", { mode: "timestamp_ms" }).notNull(),
  displayName: text("display_name"),
  status: text("status"),
  labels: text("labels", { mode: "json" }),
  spec: text("spec", { mode: "json" }),
  state: text("state", { mode: "json" }),
  relationships: text("relationships", { mode: "json" }),
}, (table) => [
  index("idx_plugin_entities_system_plugin_kind").on(table.systemId, table.pluginId, table.kind),
  index("idx_plugin_entities_system_plugin_observed").on(table.systemId, table.pluginId, table.observedAt),
])

export const pluginMetricPoints = sqliteTable("plugin_metric_points", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  systemId: text("system_id").notNull().references(() => systems.id, { onDelete: "cascade" }),
  pluginId: text("plugin_id").notNull(),
  metricId: text("metric_id").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
  entityKind: text("entity_kind"),
  entityId: text("entity_id"),
  value: real("value").notNull(),
  unit: text("unit"),
  tags: text("tags", { mode: "json" }),
}, (table) => [
  index("idx_plugin_metric_points_system_plugin_metric_time").on(
    table.systemId,
    table.pluginId,
    table.metricId,
    table.timestamp,
  ),
  index("idx_plugin_metric_points_system_plugin_entity_time").on(
    table.systemId,
    table.pluginId,
    table.entityKind,
    table.entityId,
    table.timestamp,
  ),
])

export const pluginEvents = sqliteTable("plugin_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  systemId: text("system_id").notNull().references(() => systems.id, { onDelete: "cascade" }),
  pluginId: text("plugin_id").notNull(),
  eventId: text("event_id").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
  entityKind: text("entity_kind"),
  entityId: text("entity_id"),
  severity: text("severity", { enum: ["info", "warning", "error"] }).notNull(),
  message: text("message"),
  payload: text("payload", { mode: "json" }),
}, (table) => [
  index("idx_plugin_events_system_plugin_time").on(
    table.systemId,
    table.pluginId,
    table.timestamp,
  ),
  index("idx_plugin_events_system_plugin_event_time").on(
    table.systemId,
    table.pluginId,
    table.eventId,
    table.timestamp,
  ),
])

export const alertRules = sqliteTable("alert_rules", {
  id: text("id").primaryKey(),
  metric: text("metric").notNull(),
  operator: text("operator", { enum: [">", "<", "=", "!="] }).notNull(),
  threshold: real("threshold").notNull(),
  consecutiveCount: integer("consecutive_count").notNull().default(3),
  severity: text("severity", { enum: ["warning", "critical"] }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  ruleId: text("rule_id").notNull().references(() => alertRules.id),
  systemId: text("system_id").notNull().references(() => systems.id),
  state: text("state", { enum: ["active", "acknowledged", "resolved"] }).notNull().default("active"),
  severity: text("severity", { enum: ["warning", "critical"] }).notNull(),
  metric: text("metric").notNull(),
  value: real("value").notNull(),
  triggeredAt: integer("triggered_at", { mode: "timestamp_ms" }).notNull(),
  acknowledgedAt: integer("acknowledged_at", { mode: "timestamp_ms" }),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
}, (table) => [
  index("idx_alerts_system_state").on(table.systemId, table.state),
])

export const operatorSessions = sqliteTable("operator_sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  selectedNodeIds: text("selected_node_ids", { mode: "json" }).notNull().default("[]"),
  attachedSkillIds: text("attached_skill_ids", { mode: "json" }).notNull().default("[]"),
  approvalMode: text("approval_mode").notNull(),
  bypassMode: text("bypass_mode").notNull(),
  bypassExpiresAt: integer("bypass_expires_at", { mode: "timestamp_ms" }),
  summary: text("summary"),
  modelProviderId: text("model_provider_id").notNull(),
  modelId: text("model_id").notNull(),
  parentSessionId: text("parent_session_id"),
  forkedFromEntryId: text("forked_from_entry_id"),
  currentLeafEntryId: text("current_leaf_entry_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  lastEventSeq: integer("last_event_seq").notNull().default(0),
}, (table) => [
  index("idx_operator_sessions_updated_at").on(table.updatedAt),
  index("idx_operator_sessions_status").on(table.status),
  index("idx_operator_sessions_parent_session").on(table.parentSessionId),
  index("idx_operator_sessions_current_leaf").on(table.currentLeafEntryId),
])

export const operatorSessionEvents = sqliteTable("operator_session_events", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => operatorSessions.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  at: integer("at", { mode: "timestamp_ms" }).notNull(),
  type: text("type").notNull(),
  payload: text("payload", { mode: "json" }).notNull(),
}, (table) => [
  index("idx_operator_session_events_session_seq").on(table.sessionId, table.seq),
  index("idx_operator_session_events_session_at").on(table.sessionId, table.at),
])

export const operatorEntries = sqliteTable("operator_entries", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => operatorSessions.id, { onDelete: "cascade" }),
  parentEntryId: text("parent_entry_id"),
  sourceEventId: text("source_event_id"),
  kind: text("kind").notNull(),
  role: text("role"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  data: text("data", { mode: "json" }).notNull(),
}, (table) => [
  index("idx_operator_entries_session_created").on(table.sessionId, table.createdAt),
  index("idx_operator_entries_session_parent").on(table.sessionId, table.parentEntryId),
  index("idx_operator_entries_session_kind").on(table.sessionId, table.kind),
])

export const operatorToolCalls = sqliteTable("operator_tool_calls", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => operatorSessions.id, { onDelete: "cascade" }),
  entryId: text("entry_id"),
  nodeIds: text("node_ids", { mode: "json" }).notNull().default("[]"),
  name: text("name").notNull(),
  status: text("status").notNull(),
  summary: text("summary"),
  input: text("input", { mode: "json" }),
  output: text("output", { mode: "json" }),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
}, (table) => [
  index("idx_operator_tool_calls_session_started").on(table.sessionId, table.startedAt),
  index("idx_operator_tool_calls_session_status").on(table.sessionId, table.status),
  index("idx_operator_tool_calls_session_name").on(table.sessionId, table.name),
])

export const operatorApprovals = sqliteTable("operator_approvals", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => operatorSessions.id, { onDelete: "cascade" }),
  entryId: text("entry_id"),
  toolCallId: text("tool_call_id"),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  affectedNodeIds: text("affected_node_ids", { mode: "json" }).notNull().default("[]"),
  requestedAt: integer("requested_at", { mode: "timestamp_ms" }).notNull(),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
}, (table) => [
  index("idx_operator_approvals_session_status").on(table.sessionId, table.status),
  index("idx_operator_approvals_session_requested").on(table.sessionId, table.requestedAt),
  index("idx_operator_approvals_tool_call").on(table.toolCallId),
])

export const operatorTerminalProjections = sqliteTable("operator_terminal_projections", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => operatorSessions.id, { onDelete: "cascade" }),
  toolCallId: text("tool_call_id").notNull(),
  entryId: text("entry_id"),
  nodeId: text("node_id").notNull(),
  mode: text("mode").notNull(),
  streamRef: text("stream_ref").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("idx_operator_terminal_projections_session_tool_call").on(table.sessionId, table.toolCallId),
  index("idx_operator_terminal_projections_session_created").on(table.sessionId, table.createdAt),
])

export const operatorPlanSnapshots = sqliteTable("operator_plan_snapshots", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => operatorSessions.id, { onDelete: "cascade" }),
  entryId: text("entry_id"),
  status: text("status").notNull(),
  summary: text("summary").notNull(),
  data: text("data", { mode: "json" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("idx_operator_plan_snapshots_session_updated").on(table.sessionId, table.updatedAt),
])
