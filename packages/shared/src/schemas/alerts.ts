import { Schema } from "effect"

export const AlertSeveritySchema = Schema.Literals(["warning", "critical"])
export const AlertStateSchema = Schema.Literals(["active", "acknowledged", "resolved"])
export const AlertOperatorSchema = Schema.Literals([">", "<", "=", "!="])

export const AlertRuleSchema = Schema.Struct({
  id: Schema.String,
  metric: Schema.String,
  operator: AlertOperatorSchema,
  threshold: Schema.Number,
  consecutiveCount: Schema.Number,
  severity: AlertSeveritySchema,
  enabled: Schema.Boolean,
  createdAt: Schema.Number,
})

export const AlertSchema = Schema.Struct({
  id: Schema.String,
  ruleId: Schema.String,
  systemId: Schema.String,
  state: AlertStateSchema,
  severity: AlertSeveritySchema,
  metric: Schema.String,
  value: Schema.Number,
  triggeredAt: Schema.Number,
  acknowledgedAt: Schema.NullOr(Schema.Number),
  resolvedAt: Schema.NullOr(Schema.Number),
})

/**
 * Stream event payload for alerts.subscribe — tagged union of the two
 * state transitions the UI cares about.
 */
export const AlertEventSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("triggered"),
    alert: AlertSchema,
  }),
  Schema.Struct({
    _tag: Schema.Literal("resolved"),
    alert: AlertSchema,
  }),
  Schema.Struct({
    _tag: Schema.Literal("acknowledged"),
    alert: AlertSchema,
  }),
])

export type Alert = typeof AlertSchema.Type
export type AlertRule = typeof AlertRuleSchema.Type
export type AlertSeverity = typeof AlertSeveritySchema.Type
export type AlertState = typeof AlertStateSchema.Type
export type AlertEvent = typeof AlertEventSchema.Type
