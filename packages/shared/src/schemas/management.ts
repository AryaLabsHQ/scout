import { Schema } from "effect"
import { ActionResultSchema } from "@scout/plugin-sdk/schemas"

// ─── Generic plugin control ───────────────────────────────────────────────

export const PluginEntityTargetSchema = Schema.Struct({
  pluginId: Schema.String,
  kind: Schema.String,
  id: Schema.String,
})

export const PluginRunActionParamsSchema = Schema.Struct({
  agentId: Schema.String,
  pluginId: Schema.String,
  actionId: Schema.String,
  entity: Schema.optionalKey(PluginEntityTargetSchema),
  input: Schema.optionalKey(Schema.Unknown),
})

export const PluginRunActionLocalParamsSchema = Schema.Struct({
  pluginId: Schema.String,
  actionId: Schema.String,
  entity: Schema.optionalKey(PluginEntityTargetSchema),
  input: Schema.optionalKey(Schema.Unknown),
})

export const PluginActionResultSchema = ActionResultSchema

export const PluginLogsParamsSchema = Schema.Struct({
  agentId: Schema.String,
  pluginId: Schema.String,
  streamId: Schema.String,
  entity: Schema.optionalKey(PluginEntityTargetSchema),
  input: Schema.optionalKey(Schema.Unknown),
})

export const PluginLogsLocalParamsSchema = Schema.Struct({
  pluginId: Schema.String,
  streamId: Schema.String,
  entity: Schema.optionalKey(PluginEntityTargetSchema),
  input: Schema.optionalKey(Schema.Unknown),
})

// ─── Errors ───────────────────────────────────────────────────────────────

/**
 * Generic management error the hub/agent can return for any of the
 * management RPCs. Carries a machine-readable code and human message.
 */
export class ManagementError extends Schema.ErrorClass<ManagementError>(
  "ManagementError",
)({
  code: Schema.String,
  message: Schema.String,
}) {}

export type PluginRunActionParams = typeof PluginRunActionParamsSchema.Type
export type PluginLogsParams = typeof PluginLogsParamsSchema.Type
