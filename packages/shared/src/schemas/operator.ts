import { Schema } from "effect"

export const OperatorSessionStatusSchema = Schema.Literals([
  "active",
  "waiting_for_user",
  "completed",
  "failed",
  "canceled",
  "archived",
])

export const OperatorApprovalModeSchema = Schema.Literals(["confirm_each_mutation", "auto_approve_reads", "auto_approve_all"])

export const OperatorMessageRoleSchema = Schema.Literals(["user", "assistant", "system"])

export const OperatorMessageSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  role: OperatorMessageRoleSchema,
  content: Schema.String,
  contentBlocks: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  turnId: Schema.optionalKey(Schema.String),
  createdAt: Schema.Number,
})

export const OperatorEntryKindSchema = Schema.Literals([
  "message",
  "tool_result",
  "branch_summary",
  "compaction",
  "model_change",
  "skill_change",
  "thinking_level_change",
  "custom",
  "custom_message",
  "scope_change",
])

export const OperatorEntrySchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  parentEntryId: Schema.optionalKey(Schema.String),
  sourceEventId: Schema.optionalKey(Schema.String),
  kind: OperatorEntryKindSchema,
  role: Schema.optionalKey(OperatorMessageRoleSchema),
  createdAt: Schema.Number,
  data: Schema.Unknown,
})

export const OperatorPlanStepStatusSchema = Schema.Literals([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "blocked",
])

export const OperatorPlanStatusSchema = Schema.Literals([
  "draft",
  "active",
  "completed",
  "failed",
])

export const OperatorPlanStepSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  status: OperatorPlanStepStatusSchema,
  nodeIds: Schema.Array(Schema.String),
  mutating: Schema.Boolean,
})

export const OperatorPlanSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  status: OperatorPlanStatusSchema,
  summary: Schema.String,
  steps: Schema.Array(OperatorPlanStepSchema),
  updatedAt: Schema.Number,
})

export const OperatorApprovalKindSchema = Schema.Literals([
  "scope_expansion",
  "mutation",
  "bypass_mode",
  "clarification",
])

export const OperatorApprovalStatusSchema = Schema.Literals([
  "pending",
  "approved",
  "rejected",
  "expired",
])

export const OperatorApprovalRequestSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  entryId: Schema.optionalKey(Schema.String),
  toolCallId: Schema.optionalKey(Schema.String),
  reason: Schema.String,
  affectedNodeIds: Schema.Array(Schema.String),
  kind: OperatorApprovalKindSchema,
  status: OperatorApprovalStatusSchema,
  requestedAt: Schema.Number,
  resolvedAt: Schema.optionalKey(Schema.Number),
  questionData: Schema.optionalKey(Schema.Struct({
    question: Schema.String,
    header: Schema.String,
    options: Schema.Array(Schema.Struct({
      label: Schema.String,
      description: Schema.String,
    })),
    multiple: Schema.optionalKey(Schema.Boolean),
  })),
})

export const OperatorToolCallStatusSchema = Schema.Literals([
  "running",
  "completed",
  "failed",
  "blocked",
  "canceled",
])

export const OperatorToolCallSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  entryId: Schema.optionalKey(Schema.String),
  name: Schema.String,
  status: OperatorToolCallStatusSchema,
  nodeIds: Schema.Array(Schema.String),
  summary: Schema.optionalKey(Schema.String),
  input: Schema.optionalKey(Schema.Unknown),
  output: Schema.optionalKey(Schema.Unknown),
  startedAt: Schema.Number,
  finishedAt: Schema.optionalKey(Schema.Number),
})

export const OperatorTerminalProjectionModeSchema = Schema.Literals(["inline", "dock"])

export const OperatorTerminalProjectionSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  toolCallId: Schema.String,
  entryId: Schema.optionalKey(Schema.String),
  nodeId: Schema.String,
  mode: OperatorTerminalProjectionModeSchema,
  streamRef: Schema.String,
  createdAt: Schema.optionalKey(Schema.Number),
})

export const OperatorPlanSnapshotSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  entryId: Schema.optionalKey(Schema.String),
  status: OperatorPlanStatusSchema,
  summary: Schema.String,
  data: Schema.Unknown,
  updatedAt: Schema.Number,
})

export const OperatorSkillSourceSchema = Schema.Literals([
  "builtin",
  "directory",
  "plugin",
])

export const OperatorSkillSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  source: OperatorSkillSourceSchema,
  content: Schema.String,
})

export const OperatorResourceSourceSchema = Schema.Literals([
  "builtin",
  "plugin",
])

export const OperatorResourceSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  source: OperatorResourceSourceSchema,
  content: Schema.String,
})

export const OperatorModelDescriptorSchema = Schema.Struct({
  providerId: Schema.String,
  modelId: Schema.String,
  label: Schema.String,
  reasoning: Schema.Boolean,
 })

export const OperatorSessionSummarySchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: OperatorSessionStatusSchema,
  selectedNodeIds: Schema.Array(Schema.String),
  attachedSkillIds: Schema.Array(Schema.String),
  approvalMode: OperatorApprovalModeSchema,
  planMode: Schema.optionalKey(Schema.Literals(["off", "plan_first"])),
  summary: Schema.optionalKey(Schema.String),
  modelProviderId: Schema.String,
  modelId: Schema.String,
  parentSessionId: Schema.optionalKey(Schema.String),
  forkedFromEntryId: Schema.optionalKey(Schema.String),
  currentLeafEntryId: Schema.optionalKey(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  lastEventSeq: Schema.Number,
})

export const OperatorSessionEventSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  seq: Schema.Number,
  at: Schema.Number,
  type: Schema.String,
  message: Schema.optionalKey(OperatorMessageSchema),
  plan: Schema.optionalKey(OperatorPlanSchema),
  approval: Schema.optionalKey(OperatorApprovalRequestSchema),
  toolCall: Schema.optionalKey(OperatorToolCallSchema),
  toolCallId: Schema.optionalKey(Schema.String),
  summary: Schema.optionalKey(Schema.String),
  outputText: Schema.optionalKey(Schema.String),
  outputBase64: Schema.optionalKey(Schema.String),
  projection: Schema.optionalKey(OperatorTerminalProjectionSchema),
  status: Schema.optionalKey(OperatorSessionStatusSchema),
  skillIds: Schema.optionalKey(Schema.Array(Schema.String)),
})

export const OperatorSessionDetailSchema = Schema.Struct({
  session: OperatorSessionSummarySchema,
  events: Schema.Array(OperatorSessionEventSchema),
  entries: Schema.Array(OperatorEntrySchema),
  toolCalls: Schema.Array(OperatorToolCallSchema),
  approvals: Schema.Array(OperatorApprovalRequestSchema),
  terminalProjections: Schema.Array(OperatorTerminalProjectionSchema),
  planSnapshots: Schema.Array(OperatorPlanSnapshotSchema),
  availableSkills: Schema.Array(OperatorSkillSchema),
  availableResources: Schema.Array(OperatorResourceSchema),
  availableModels: Schema.Array(OperatorModelDescriptorSchema),
})

export const OperatorSessionCreateParamsSchema = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  selectedNodeIds: Schema.optionalKey(Schema.Array(Schema.String)),
  attachedSkillIds: Schema.optionalKey(Schema.Array(Schema.String)),
})

export const OperatorSessionGetParamsSchema = Schema.Struct({
  sessionId: Schema.String,
})

export const OperatorSessionBranchParamsSchema = Schema.Struct({
  sessionId: Schema.String,
  entryId: Schema.NullOr(Schema.String),
})

export const OperatorSessionForkParamsSchema = Schema.Struct({
  sessionId: Schema.String,
  entryId: Schema.String,
  title: Schema.optionalKey(Schema.String),
})

export const OperatorSessionSetSkillsParamsSchema = Schema.Struct({
  sessionId: Schema.String,
  skillIds: Schema.Array(Schema.String),
})

export const OperatorPromptParamsSchema = Schema.Struct({
  sessionId: Schema.String,
  text: Schema.String,
})

export const OperatorApprovalResolveParamsSchema = Schema.Struct({
  sessionId: Schema.String,
  approvalId: Schema.String,
  decision: Schema.Literals(["approved", "rejected"]),
})

export const OperatorSessionSetApprovalModeParamsSchema = Schema.Struct({
  sessionId: Schema.String,
  approvalMode: OperatorApprovalModeSchema,
})

export const OperatorSessionSetPlanModeParamsSchema = Schema.Struct({
  sessionId: Schema.String,
  planMode: Schema.Literals(["off", "plan_first"]),
})

export const OperatorSessionSetTitleParamsSchema = Schema.Struct({
  sessionId: Schema.String,
  title: Schema.String,
})

export const OperatorSessionArchiveParamsSchema = Schema.Struct({
  sessionId: Schema.String,
})

export const OperatorSessionDeleteParamsSchema = Schema.Struct({
  sessionId: Schema.String,
})

export const OperatorEventsSubscribeParamsSchema = Schema.Struct({
  sessionId: Schema.String,
  afterSeq: Schema.optionalKey(Schema.Number),
})

export type OperatorSessionStatus = typeof OperatorSessionStatusSchema.Type
export type OperatorApprovalMode = typeof OperatorApprovalModeSchema.Type
export type OperatorMessage = typeof OperatorMessageSchema.Type
export type OperatorEntryKind = typeof OperatorEntryKindSchema.Type
export type OperatorEntry = typeof OperatorEntrySchema.Type
export type OperatorPlan = typeof OperatorPlanSchema.Type
export type OperatorPlanStep = typeof OperatorPlanStepSchema.Type
export type OperatorApprovalRequest = typeof OperatorApprovalRequestSchema.Type
export type OperatorToolCall = typeof OperatorToolCallSchema.Type
export type OperatorTerminalProjection = typeof OperatorTerminalProjectionSchema.Type
export type OperatorPlanSnapshot = typeof OperatorPlanSnapshotSchema.Type
export type OperatorSkill = typeof OperatorSkillSchema.Type
export type OperatorResource = typeof OperatorResourceSchema.Type
export type OperatorModelDescriptor = typeof OperatorModelDescriptorSchema.Type
export type OperatorSessionSummary = typeof OperatorSessionSummarySchema.Type
export type OperatorSessionEvent = typeof OperatorSessionEventSchema.Type
export type OperatorSessionDetail = typeof OperatorSessionDetailSchema.Type
export type OperatorSessionCreateParams = typeof OperatorSessionCreateParamsSchema.Type
export type OperatorSessionGetParams = typeof OperatorSessionGetParamsSchema.Type
export type OperatorSessionBranchParams = typeof OperatorSessionBranchParamsSchema.Type
export type OperatorSessionForkParams = typeof OperatorSessionForkParamsSchema.Type
export type OperatorSessionSetSkillsParams = typeof OperatorSessionSetSkillsParamsSchema.Type
export type OperatorPromptParams = typeof OperatorPromptParamsSchema.Type
export type OperatorApprovalResolveParams = typeof OperatorApprovalResolveParamsSchema.Type
export type OperatorSessionSetApprovalModeParams = typeof OperatorSessionSetApprovalModeParamsSchema.Type
export type OperatorSessionSetPlanModeParams = typeof OperatorSessionSetPlanModeParamsSchema.Type
export type OperatorSessionSetTitleParams = typeof OperatorSessionSetTitleParamsSchema.Type
export type OperatorSessionArchiveParams = typeof OperatorSessionArchiveParamsSchema.Type
export type OperatorSessionDeleteParams = typeof OperatorSessionDeleteParamsSchema.Type
export type OperatorEventsSubscribeParams = typeof OperatorEventsSubscribeParamsSchema.Type
