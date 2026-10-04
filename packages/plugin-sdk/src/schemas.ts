import { Schema } from "effect"

export const PluginApiVersionSchema = Schema.Literal("v0alpha1")

export const PluginPermissionSchema = Schema.Literals([
  "node:read-files",
  "node:write-files",
  "node:spawn-process",
  "node:open-session",
  "node:stream-logs",
  "node:docker-socket",
  "node:k8s-api",
  "node:systemd",
  "node:network-egress",
  "node:read-env",
])

export const PluginCapabilityStatusSchema = Schema.Literals(["available", "degraded", "unsupported"])

export const MetricKindSchema = Schema.Literals(["gauge", "counter", "state"])

export const StreamKindSchema = Schema.Literals(["logs", "session", "events", "custom"])

export const PluginUiScreenKindSchema = Schema.Literals(["overview", "entity-list", "entity-detail"])

export const EventSeveritySchema = Schema.Literals(["info", "warning", "error"])

export const PluginCapabilityDefinitionSchema = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  description: Schema.optionalKey(Schema.String),
})

export const EntityKindDefinitionSchema = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  pluralDisplayName: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
})

export const MetricDefinitionSchema = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  description: Schema.optionalKey(Schema.String),
  kind: MetricKindSchema,
  entityKinds: Schema.optionalKey(Schema.Array(Schema.String)),
  unit: Schema.optionalKey(Schema.String),
})

export const ActionDefinitionSchema = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  description: Schema.optionalKey(Schema.String),
  targetKinds: Schema.Array(Schema.String),
  permissions: Schema.Array(PluginPermissionSchema),
  requiresConfirmation: Schema.Boolean,
})

export const StreamDefinitionSchema = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  description: Schema.optionalKey(Schema.String),
  kind: StreamKindSchema,
  targetKinds: Schema.Array(Schema.String),
  permissions: Schema.Array(PluginPermissionSchema),
})

export const PluginAlertDefinitionSchema = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  description: Schema.optionalKey(Schema.String),
  severity: Schema.optionalKey(Schema.Literals(["warning", "critical"])),
  entityKinds: Schema.optionalKey(Schema.Array(Schema.String)),
  metricIds: Schema.optionalKey(Schema.Array(Schema.String)),
})

export const PluginManifestSchema = Schema.Struct({
  apiVersion: PluginApiVersionSchema,
  id: Schema.String,
  displayName: Schema.String,
  version: Schema.String,
  description: Schema.String,
  permissions: Schema.Array(PluginPermissionSchema),
  capabilities: Schema.Array(PluginCapabilityDefinitionSchema),
  entityKinds: Schema.Array(EntityKindDefinitionSchema),
  metrics: Schema.Array(MetricDefinitionSchema),
  actions: Schema.Array(ActionDefinitionSchema),
  streams: Schema.Array(StreamDefinitionSchema),
  alerts: Schema.Array(PluginAlertDefinitionSchema),
})

export const PluginCapabilitySchema = Schema.Struct({
  pluginId: Schema.String,
  version: Schema.String,
  status: PluginCapabilityStatusSchema,
  features: Schema.Array(Schema.String),
  reason: Schema.optionalKey(Schema.String),
})

export const EntityRefSchema = Schema.Struct({
  pluginId: Schema.String,
  kind: Schema.String,
  nodeId: Schema.String,
  id: Schema.String,
})

export const EntityRelationshipSchema = Schema.Struct({
  type: Schema.String,
  target: EntityRefSchema,
})

export const EntitySnapshotSchema = Schema.Struct({
  ref: EntityRefSchema,
  ts: Schema.Number,
  displayName: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  labels: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  spec: Schema.optionalKey(Schema.Unknown),
  state: Schema.optionalKey(Schema.Unknown),
  relationships: Schema.optionalKey(Schema.Array(EntityRelationshipSchema)),
})

export const MetricPointSchema = Schema.Struct({
  pluginId: Schema.String,
  metricId: Schema.String,
  ts: Schema.Number,
  entity: Schema.optionalKey(EntityRefSchema),
  value: Schema.Number,
  unit: Schema.optionalKey(Schema.String),
  tags: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})

export const EventRecordSchema = Schema.Struct({
  pluginId: Schema.String,
  eventId: Schema.String,
  ts: Schema.Number,
  entity: Schema.optionalKey(EntityRefSchema),
  severity: EventSeveritySchema,
  message: Schema.optionalKey(Schema.String),
  payload: Schema.optionalKey(Schema.Unknown),
})

export const PluginCollectionResultSchema = Schema.Struct({
  entities: Schema.optionalKey(Schema.Array(EntitySnapshotSchema)),
  metrics: Schema.optionalKey(Schema.Array(MetricPointSchema)),
  events: Schema.optionalKey(Schema.Array(EventRecordSchema)),
})

export const ActionTargetSchema = Schema.Struct({
  nodeId: Schema.String,
  entity: Schema.optionalKey(EntityRefSchema),
})

export const ActionRequestSchema = Schema.Struct({
  pluginId: Schema.String,
  actionId: Schema.String,
  target: ActionTargetSchema,
  input: Schema.optionalKey(Schema.Unknown),
})

export const ActionResultSchema = Schema.Struct({
  success: Schema.Boolean,
  output: Schema.optionalKey(Schema.Unknown),
  summary: Schema.optionalKey(Schema.String),
})

export const StreamRequestSchema = Schema.Struct({
  pluginId: Schema.String,
  streamId: Schema.String,
  target: ActionTargetSchema,
  input: Schema.optionalKey(Schema.Unknown),
})

export const LogChunkSchema = Schema.Struct({
  lines: Schema.Array(Schema.String),
  ts: Schema.Number,
})

export const SessionChunkSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("session-start"),
    sessionId: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal("output"),
    dataBase64: Schema.String,
  }),
])

export const EventChunkSchema = Schema.Struct({
  event: EventRecordSchema,
})

export const StreamChunkSchema = Schema.Union([LogChunkSchema, SessionChunkSchema, EventChunkSchema])

export const PluginUiActionConfirmSchema = Schema.Struct({
  title: Schema.String,
  message: Schema.String,
  confirmLabel: Schema.optionalKey(Schema.String),
  cancelLabel: Schema.optionalKey(Schema.String),
  variant: Schema.optionalKey(Schema.Literals(["default", "danger"])),
})

export const PluginUiActionSuccessSchema = Schema.Union([
  Schema.Struct({
    navigate: Schema.String,
  }),
  Schema.Struct({
    set: Schema.Record(Schema.String, Schema.Unknown),
  }),
  Schema.Struct({
    action: Schema.String,
  }),
])

export const PluginUiActionErrorSchema = Schema.Union([
  Schema.Struct({
    set: Schema.Record(Schema.String, Schema.Unknown),
  }),
  Schema.Struct({
    action: Schema.String,
  }),
])

export const PluginUiActionBindingSchema = Schema.Struct({
  action: Schema.String,
  params: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  confirm: Schema.optionalKey(PluginUiActionConfirmSchema),
  onSuccess: Schema.optionalKey(PluginUiActionSuccessSchema),
  onError: Schema.optionalKey(PluginUiActionErrorSchema),
  preventDefault: Schema.optionalKey(Schema.Boolean),
})

export const PluginUiRepeatSchema = Schema.Struct({
  statePath: Schema.String,
  key: Schema.optionalKey(Schema.String),
})

export const PluginUiActionBindingOrBindingsSchema = Schema.Union([
  PluginUiActionBindingSchema,
  Schema.Array(PluginUiActionBindingSchema),
])

export const PluginUiElementSchema = Schema.Struct({
  type: Schema.String,
  props: Schema.Record(Schema.String, Schema.Unknown),
  children: Schema.optionalKey(Schema.Array(Schema.String)),
  visible: Schema.optionalKey(Schema.Unknown),
  on: Schema.optionalKey(Schema.Record(Schema.String, PluginUiActionBindingOrBindingsSchema)),
  repeat: Schema.optionalKey(PluginUiRepeatSchema),
  watch: Schema.optionalKey(Schema.Record(Schema.String, PluginUiActionBindingOrBindingsSchema)),
})

export const PluginUiSpecSchema = Schema.Struct({
  root: Schema.String,
  elements: Schema.Record(Schema.String, PluginUiElementSchema),
  state: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
})

export const PluginUiScreenSchema = Schema.Struct({
  id: Schema.String,
  pluginId: Schema.String,
  kind: PluginUiScreenKindSchema,
  title: Schema.String,
  entityKind: Schema.optionalKey(Schema.String),
  spec: PluginUiSpecSchema,
})

export class PluginExecutionError extends Schema.Error<PluginExecutionError>("PluginExecutionError")({
  code: Schema.String,
  message: Schema.String,
  pluginId: Schema.optionalKey(Schema.String),
  actionId: Schema.optionalKey(Schema.String),
  streamId: Schema.optionalKey(Schema.String),
}) {}

export class PluginLoadError extends Schema.Error<PluginLoadError>("PluginLoadError")({
  code: Schema.String,
  message: Schema.String,
  pluginId: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
}) {}

export type PluginApiVersion = typeof PluginApiVersionSchema.Type
export type PluginPermission = typeof PluginPermissionSchema.Type
export type PluginCapabilityStatus = typeof PluginCapabilityStatusSchema.Type
export type MetricKind = typeof MetricKindSchema.Type
export type StreamKind = typeof StreamKindSchema.Type
export type PluginUiScreenKind = typeof PluginUiScreenKindSchema.Type
export type EventSeverity = typeof EventSeveritySchema.Type
export type PluginCapabilityDefinition = typeof PluginCapabilityDefinitionSchema.Type
export type EntityKindDefinition = typeof EntityKindDefinitionSchema.Type
export type MetricDefinition = typeof MetricDefinitionSchema.Type
export type ActionDefinition = typeof ActionDefinitionSchema.Type
export type StreamDefinition = typeof StreamDefinitionSchema.Type
export type PluginAlertDefinition = typeof PluginAlertDefinitionSchema.Type
export type PluginManifest = typeof PluginManifestSchema.Type
export type PluginCapability = typeof PluginCapabilitySchema.Type
export type EntityRef = typeof EntityRefSchema.Type
export type EntityRelationship = typeof EntityRelationshipSchema.Type
export type EntitySnapshot = typeof EntitySnapshotSchema.Type
export type MetricPoint = typeof MetricPointSchema.Type
export type EventRecord = typeof EventRecordSchema.Type
export type PluginCollectionResult = typeof PluginCollectionResultSchema.Type
export type ActionTarget = typeof ActionTargetSchema.Type
export type ActionRequest = typeof ActionRequestSchema.Type
export type ActionResult = typeof ActionResultSchema.Type
export type StreamRequest = typeof StreamRequestSchema.Type
export type LogChunk = typeof LogChunkSchema.Type
export type SessionChunk = typeof SessionChunkSchema.Type
export type EventChunk = typeof EventChunkSchema.Type
export type StreamChunk = typeof StreamChunkSchema.Type
export type PluginUiActionConfirm = typeof PluginUiActionConfirmSchema.Type
export type PluginUiActionSuccess = typeof PluginUiActionSuccessSchema.Type
export type PluginUiActionError = typeof PluginUiActionErrorSchema.Type
export type PluginUiActionBinding = typeof PluginUiActionBindingSchema.Type
export type PluginUiRepeat = typeof PluginUiRepeatSchema.Type
export type PluginUiElement = typeof PluginUiElementSchema.Type
export type PluginUiSpec = typeof PluginUiSpecSchema.Type
export type PluginUiScreen = typeof PluginUiScreenSchema.Type

export const decodePluginManifest = Schema.decodeUnknownEffect(PluginManifestSchema)
export const decodeEntitySnapshot = Schema.decodeUnknownEffect(EntitySnapshotSchema)
export const decodeMetricPoint = Schema.decodeUnknownEffect(MetricPointSchema)
export const decodePluginCollectionResult = Schema.decodeUnknownEffect(PluginCollectionResultSchema)
export const decodeActionRequest = Schema.decodeUnknownEffect(ActionRequestSchema)
export const decodePluginUiScreen = Schema.decodeUnknownEffect(PluginUiScreenSchema)
