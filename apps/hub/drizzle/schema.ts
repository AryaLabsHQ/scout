import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core"

export const systems = sqliteTable("systems", {
  id: text("id").primaryKey(),
  hostname: text("hostname").notNull(),
  tailscaleIp: text("tailscale_ip"),
  status: text("status", { enum: ["online", "offline", "pending"] })
    .notNull()
    .default("pending"),
  capabilities: text("capabilities", { mode: "json" }).notNull().default("{}"),
  pluginCapabilities: text("plugin_capabilities", { mode: "json" }).notNull().default("[]"),
  lastSeen: integer("last_seen", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

export const systemMetrics = sqliteTable(
  "system_metrics",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    systemId: text("system_id")
      .notNull()
      .references(() => systems.id),
    timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
    type: text("type", { enum: ["1m", "10m", "20m", "120m", "480m"] })
      .notNull()
      .default("1m"),
    data: text("data", { mode: "json" }).notNull(), // JSON blob of SystemMetricsSample
  },
  (table) => [index("idx_metrics_system_time_type").on(table.systemId, table.timestamp, table.type)],
)

export const pluginEntities = sqliteTable(
  "plugin_entities",
  {
    key: text("key").primaryKey(),
    systemId: text("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
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
  },
  (table) => [
    index("idx_plugin_entities_system_plugin_kind").on(table.systemId, table.pluginId, table.kind),
    index("idx_plugin_entities_system_plugin_observed").on(table.systemId, table.pluginId, table.observedAt),
  ],
)

export const pluginMetricPoints = sqliteTable(
  "plugin_metric_points",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    systemId: text("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    pluginId: text("plugin_id").notNull(),
    metricId: text("metric_id").notNull(),
    timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
    entityKind: text("entity_kind"),
    entityId: text("entity_id"),
    value: real("value").notNull(),
    unit: text("unit"),
    tags: text("tags", { mode: "json" }),
  },
  (table) => [
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
  ],
)

export const pluginEvents = sqliteTable(
  "plugin_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    systemId: text("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    pluginId: text("plugin_id").notNull(),
    eventId: text("event_id").notNull(),
    timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
    entityKind: text("entity_kind"),
    entityId: text("entity_id"),
    severity: text("severity", { enum: ["info", "warning", "error"] }).notNull(),
    message: text("message"),
    payload: text("payload", { mode: "json" }),
  },
  (table) => [
    index("idx_plugin_events_system_plugin_time").on(table.systemId, table.pluginId, table.timestamp),
    index("idx_plugin_events_system_plugin_event_time").on(
      table.systemId,
      table.pluginId,
      table.eventId,
      table.timestamp,
    ),
  ],
)

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

export const alerts = sqliteTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => alertRules.id),
    systemId: text("system_id")
      .notNull()
      .references(() => systems.id),
    state: text("state", { enum: ["active", "acknowledged", "resolved"] })
      .notNull()
      .default("active"),
    severity: text("severity", { enum: ["warning", "critical"] }).notNull(),
    metric: text("metric").notNull(),
    value: real("value").notNull(),
    triggeredAt: integer("triggered_at", { mode: "timestamp_ms" }).notNull(),
    acknowledgedAt: integer("acknowledged_at", { mode: "timestamp_ms" }),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("idx_alerts_system_state").on(table.systemId, table.state)],
)
