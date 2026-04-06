import { Schema } from "effect"
import { PluginCapabilitySchema } from "@scout/plugin-sdk/schemas"

export const SystemStatusSchema = Schema.Literals(["online", "offline", "pending"])

export const AgentCapabilitiesSchema = Schema.Struct({
  system: Schema.Boolean,
  network: Schema.Boolean,
  process: Schema.Boolean,
  temperature: Schema.Boolean,
  gpu: Schema.Boolean,
  smart: Schema.Boolean,
})

export const SystemSchema = Schema.Struct({
  id: Schema.String,
  hostname: Schema.String,
  tailscaleIp: Schema.NullOr(Schema.String),
  status: SystemStatusSchema,
  capabilities: AgentCapabilitiesSchema,
  pluginCapabilities: Schema.optionalKey(Schema.Array(PluginCapabilitySchema)),
  lastSeen: Schema.Number,
  createdAt: Schema.Number,
})

export const AgentInfoSchema = Schema.Struct({
  systemId: Schema.String,
  hostname: Schema.String,
  version: Schema.String,
  platform: Schema.String,
})

export type System = typeof SystemSchema.Type
export type SystemStatus = typeof SystemStatusSchema.Type
export type AgentCapabilities = typeof AgentCapabilitiesSchema.Type
export type AgentInfo = typeof AgentInfoSchema.Type
