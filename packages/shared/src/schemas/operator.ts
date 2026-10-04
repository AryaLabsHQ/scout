import { Schema } from "effect"

/**
 * Operator wire contract. The hub runs sessions on pi-durable; these shapes are projections of a
 * session's durable state (transcript, live generation/tool round, approval document, session metadata).
 */

/** Derived: archived flag, pending approval, a running generation/tool round, or a failed last answer. */
export const OperatorSessionStatusSchema = Schema.Literals([
  "idle",
  "running",
  "waiting_for_user",
  "failed",
  "archived",
])

export const OperatorApprovalModeSchema = Schema.Literals([
  "confirm_each_mutation",
  "auto_approve_reads",
  "auto_approve_all",
])

export const OperatorPlanModeSchema = Schema.Literals(["off", "plan_first"])

export const OperatorApprovalKindSchema = Schema.Literals(["mutation", "clarification"])

export const OperatorApprovalStatusSchema = Schema.Literals([
  "pending",
  "approved",
  "rejected",
  /** The call was aborted or interrupted before a decision. */
  "canceled",
])

export const OperatorQuestionSchema = Schema.Struct({
  question: Schema.String,
  header: Schema.String,
  options: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      description: Schema.String,
    }),
  ),
  multiple: Schema.optionalKey(Schema.Boolean),
})

export const OperatorApprovalRequestSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  toolCallId: Schema.String,
  toolName: Schema.String,
  kind: OperatorApprovalKindSchema,
  status: OperatorApprovalStatusSchema,
  reason: Schema.String,
  affectedNodeIds: Schema.Array(Schema.String),
  requestedAt: Schema.Number,
  resolvedAt: Schema.optionalKey(Schema.Number),
  /** Verified identity of whoever decided, when the RPC context carries one. */
  actor: Schema.optionalKey(Schema.String),
  /** The user's answer for clarification requests. */
  answer: Schema.optionalKey(Schema.String),
  question: Schema.optionalKey(OperatorQuestionSchema),
})

export const OperatorToolCallStatusSchema = Schema.Literals(["pending", "running", "completed", "failed"])

/** Raw PTY output of a bash.run call, for mirroring into a terminal tab. */
export const OperatorTerminalOutputSchema = Schema.Struct({
  nodeId: Schema.String,
  terminalSessionId: Schema.String,
  base64Chunks: Schema.Array(Schema.String),
})

export const OperatorTimelineItemSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("user"),
    /** Durable entry id; fork targets. */
    entryId: Schema.String,
    text: Schema.String,
    createdAt: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal("assistant"),
    /** Absent while the answer is still streaming. */
    entryId: Schema.optionalKey(Schema.String),
    text: Schema.String,
    thinking: Schema.optionalKey(Schema.String),
    streaming: Schema.Boolean,
    errorMessage: Schema.optionalKey(Schema.String),
    createdAt: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal("tool"),
    toolCallId: Schema.String,
    /** Result entry once settled. */
    entryId: Schema.optionalKey(Schema.String),
    name: Schema.String,
    args: Schema.Unknown,
    status: OperatorToolCallStatusSchema,
    output: Schema.optionalKey(Schema.String),
    nodeIds: Schema.Array(Schema.String),
    approvalId: Schema.optionalKey(Schema.String),
    terminal: Schema.optionalKey(OperatorTerminalOutputSchema),
    createdAt: Schema.Number,
  }),
])

export const OperatorSkillSourceSchema = Schema.Literals(["builtin", "directory", "plugin"])

export const OperatorSkillSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  source: OperatorSkillSourceSchema,
  content: Schema.String,
})

export const OperatorResourceSourceSchema = Schema.Literals(["builtin", "plugin"])

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
  planMode: OperatorPlanModeSchema,
  modelProviderId: Schema.String,
  modelId: Schema.String,
  parentSessionId: Schema.optionalKey(Schema.String),
  forkedFromEntryId: Schema.optionalKey(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

export const OperatorSessionDetailSchema = Schema.Struct({
  session: OperatorSessionSummarySchema,
  timeline: Schema.Array(OperatorTimelineItemSchema),
  approvals: Schema.Array(OperatorApprovalRequestSchema),
  /** Inputs queued behind the running answer. */
  queuedInputs: Schema.Number,
  availableSkills: Schema.Array(OperatorSkillSchema),
  availableResources: Schema.Array(OperatorResourceSchema),
  availableModels: Schema.Array(OperatorModelDescriptorSchema),
})

export const OperatorSessionCreateParamsSchema = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  selectedNodeIds: Schema.optionalKey(Schema.Array(Schema.String)),
  attachedSkillIds: Schema.optionalKey(Schema.Array(Schema.String)),
})

export const OperatorSessionIdParamsSchema = Schema.Struct({
  sessionId: Schema.String,
})

export const OperatorSessionForkParamsSchema = Schema.Struct({
  sessionId: Schema.String,
  /** The fork sees the parent's transcript through this entry, inclusive. */
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
  /** Client-generated idempotency key: a retried prompt with the same key is admitted once. */
  requestId: Schema.optionalKey(Schema.String),
})

export const OperatorApprovalResolveParamsSchema = Schema.Struct({
  sessionId: Schema.String,
  approvalId: Schema.String,
  decision: Schema.Literals(["approved", "rejected"]),
  /** Answer text for clarification requests; returned to the model verbatim. */
  answer: Schema.optionalKey(Schema.String),
})

export const OperatorSessionSetApprovalModeParamsSchema = Schema.Struct({
  sessionId: Schema.String,
  approvalMode: OperatorApprovalModeSchema,
})

export const OperatorSessionSetPlanModeParamsSchema = Schema.Struct({
  sessionId: Schema.String,
  planMode: OperatorPlanModeSchema,
})

export const OperatorSessionSetTitleParamsSchema = Schema.Struct({
  sessionId: Schema.String,
  title: Schema.String,
})

export type OperatorSessionStatus = typeof OperatorSessionStatusSchema.Type
export type OperatorApprovalMode = typeof OperatorApprovalModeSchema.Type
export type OperatorPlanMode = typeof OperatorPlanModeSchema.Type
export type OperatorApprovalKind = typeof OperatorApprovalKindSchema.Type
export type OperatorApprovalStatus = typeof OperatorApprovalStatusSchema.Type
export type OperatorQuestion = typeof OperatorQuestionSchema.Type
export type OperatorApprovalRequest = typeof OperatorApprovalRequestSchema.Type
export type OperatorToolCallStatus = typeof OperatorToolCallStatusSchema.Type
export type OperatorTerminalOutput = typeof OperatorTerminalOutputSchema.Type
export type OperatorTimelineItem = typeof OperatorTimelineItemSchema.Type
export type OperatorSkill = typeof OperatorSkillSchema.Type
export type OperatorResource = typeof OperatorResourceSchema.Type
export type OperatorModelDescriptor = typeof OperatorModelDescriptorSchema.Type
export type OperatorSessionSummary = typeof OperatorSessionSummarySchema.Type
export type OperatorSessionDetail = typeof OperatorSessionDetailSchema.Type
export type OperatorSessionCreateParams = typeof OperatorSessionCreateParamsSchema.Type
export type OperatorSessionIdParams = typeof OperatorSessionIdParamsSchema.Type
export type OperatorSessionForkParams = typeof OperatorSessionForkParamsSchema.Type
export type OperatorSessionSetSkillsParams = typeof OperatorSessionSetSkillsParamsSchema.Type
export type OperatorPromptParams = typeof OperatorPromptParamsSchema.Type
export type OperatorApprovalResolveParams = typeof OperatorApprovalResolveParamsSchema.Type
export type OperatorSessionSetApprovalModeParams = typeof OperatorSessionSetApprovalModeParamsSchema.Type
export type OperatorSessionSetPlanModeParams = typeof OperatorSessionSetPlanModeParamsSchema.Type
export type OperatorSessionSetTitleParams = typeof OperatorSessionSetTitleParamsSchema.Type
