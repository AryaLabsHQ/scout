import { Schema } from "effect"

export const PluginApiVersionSchema = Schema.Literal("v0alpha1")

export const PluginRuntimeSchema = Schema.Literals(["agent", "hub", "web"])

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

export const PluginCapabilityStatusSchema = Schema.Literals([
  "available",
  "degraded",
  "unsupported",
])

export const MetricKindSchema = Schema.Literals(["gauge", "counter", "state"])

export const StreamKindSchema = Schema.Literals([
  "logs",
  "session",
  "events",
  "custom",
])

export const ViewKindSchema = Schema.Literals(["dashboard", "list", "detail"])

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
  runtimes: Schema.Array(PluginRuntimeSchema),
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

export const StreamChunkSchema = Schema.Union([
  LogChunkSchema,
  SessionChunkSchema,
  EventChunkSchema,
])

export const ViewValueSourceSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("field"),
    path: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal("metric"),
    metricId: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal("label"),
    key: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal("status"),
  }),
])

export const ViewColumnSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  source: ViewValueSourceSchema,
})

export const ViewMetricRefSchema = Schema.Struct({
  metricId: Schema.String,
  label: Schema.optionalKey(Schema.String),
  unit: Schema.optionalKey(Schema.String),
})

export const ViewActionRefSchema = Schema.Struct({
  actionId: Schema.String,
  label: Schema.optionalKey(Schema.String),
})

export const ViewSectionSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("stat-grid"),
    title: Schema.optionalKey(Schema.String),
    metrics: Schema.Array(ViewMetricRefSchema),
  }),
  Schema.Struct({
    _tag: Schema.Literal("timeseries"),
    title: Schema.optionalKey(Schema.String),
    metrics: Schema.Array(ViewMetricRefSchema),
  }),
  Schema.Struct({
    _tag: Schema.Literal("entity-table"),
    title: Schema.optionalKey(Schema.String),
    entityKind: Schema.String,
    columns: Schema.Array(ViewColumnSchema),
    actions: Schema.optionalKey(Schema.Array(ViewActionRefSchema)),
  }),
  Schema.Struct({
    _tag: Schema.Literal("detail"),
    title: Schema.optionalKey(Schema.String),
    fields: Schema.Array(ViewColumnSchema),
  }),
  Schema.Struct({
    _tag: Schema.Literal("actions"),
    title: Schema.optionalKey(Schema.String),
    actions: Schema.Array(ViewActionRefSchema),
  }),
  Schema.Struct({
    _tag: Schema.Literal("logs"),
    title: Schema.optionalKey(Schema.String),
    streamId: Schema.String,
  }),
])

export const ViewDefinitionSchema = Schema.Struct({
  id: Schema.String,
  pluginId: Schema.String,
  kind: ViewKindSchema,
  title: Schema.String,
  entityKind: Schema.optionalKey(Schema.String),
  sections: Schema.Array(ViewSectionSchema),
})

export class PluginExecutionError extends Schema.ErrorClass<PluginExecutionError>(
  "PluginExecutionError",
)({
  code: Schema.String,
  message: Schema.String,
  pluginId: Schema.optionalKey(Schema.String),
  actionId: Schema.optionalKey(Schema.String),
  streamId: Schema.optionalKey(Schema.String),
}) {}

export class PluginLoadError extends Schema.ErrorClass<PluginLoadError>(
  "PluginLoadError",
)({
  code: Schema.String,
  message: Schema.String,
  pluginId: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
}) {}

export type PluginApiVersion = typeof PluginApiVersionSchema.Type
export type PluginRuntime = typeof PluginRuntimeSchema.Type
export type PluginPermission = typeof PluginPermissionSchema.Type
export type PluginCapabilityStatus = typeof PluginCapabilityStatusSchema.Type
export type MetricKind = typeof MetricKindSchema.Type
export type StreamKind = typeof StreamKindSchema.Type
export type ViewKind = typeof ViewKindSchema.Type
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
export type ViewValueSource = typeof ViewValueSourceSchema.Type
export type ViewColumn = typeof ViewColumnSchema.Type
export type ViewMetricRef = typeof ViewMetricRefSchema.Type
export type ViewActionRef = typeof ViewActionRefSchema.Type
export type ViewSection = typeof ViewSectionSchema.Type
export type ViewDefinition = typeof ViewDefinitionSchema.Type

export const decodePluginManifest = Schema.decodeUnknownEffect(PluginManifestSchema)
export const decodeEntitySnapshot = Schema.decodeUnknownEffect(EntitySnapshotSchema)
export const decodeMetricPoint = Schema.decodeUnknownEffect(MetricPointSchema)
export const decodePluginCollectionResult = Schema.decodeUnknownEffect(
  PluginCollectionResultSchema,
)
export const decodeActionRequest = Schema.decodeUnknownEffect(ActionRequestSchema)
export const decodeViewDefinition = Schema.decodeUnknownEffect(ViewDefinitionSchema)
