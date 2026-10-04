import { Schema } from "effect"

// ─── Read-only plugin data (browser → hub) ──────────────────────────────────
//
// The hub persists what agents collect for each plugin (entities, metric points,
// events). These params select one plugin on one system; the snapshots
// themselves use the plugin SDK schemas.

export const PluginEntitiesParamsSchema = Schema.Struct({
  systemId: Schema.String,
  pluginId: Schema.String,
  kind: Schema.optionalKey(Schema.String),
})

export const PluginMetricsParamsSchema = Schema.Struct({
  systemId: Schema.String,
  pluginId: Schema.String,
  /** Look-back window; the hub clamps it to 1..720 hours. */
  hours: Schema.Number,
  metricId: Schema.optionalKey(Schema.String),
})

export const PluginEventsParamsSchema = Schema.Struct({
  systemId: Schema.String,
  pluginId: Schema.String,
  /** Look-back window; the hub clamps it to 1..720 hours. */
  hours: Schema.Number,
  eventId: Schema.optionalKey(Schema.String),
})

export type PluginEntitiesParams = typeof PluginEntitiesParamsSchema.Type
export type PluginMetricsParams = typeof PluginMetricsParamsSchema.Type
export type PluginEventsParams = typeof PluginEventsParamsSchema.Type
