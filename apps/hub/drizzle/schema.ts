import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core"

export const systems = sqliteTable("systems", {
  id: text("id").primaryKey(),
  hostname: text("hostname").notNull(),
  tailscaleIp: text("tailscale_ip"),
  status: text("status", { enum: ["online", "offline", "pending"] }).notNull().default("pending"),
  capabilities: text("capabilities", { mode: "json" }).notNull().default("{}"),
  lastSeen: integer("last_seen", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

export const systemMetrics = sqliteTable("system_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  systemId: text("system_id").notNull().references(() => systems.id),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
  type: text("type", { enum: ["1m", "10m", "20m", "120m", "480m"] }).notNull().default("1m"),
  data: text("data", { mode: "json" }).notNull(), // JSON blob of AgentReport
}, (table) => [
  index("idx_metrics_system_time_type").on(table.systemId, table.timestamp, table.type),
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
