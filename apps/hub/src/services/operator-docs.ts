import { defineDoc } from "@earendil-works/pi-durable"
import type { OperatorApprovalMode, OperatorPlanMode } from "@scout/shared"

/**
 * Scout's application documents in the operator's pi-durable storage. Documents commit atomically
 * with transcript entries and tool task state, so everything here survives a hub restart.
 */

/** Scout metadata of one operator session (one pi-durable conversation). */
export type OperatorSessionMeta = {
  title: string
  selectedNodeIds: Array<string>
  attachedSkillIds: Array<string>
  approvalMode: OperatorApprovalMode
  planMode: OperatorPlanMode
  archived: boolean
  modelProviderId: string
  modelId: string
  parentSessionId?: string
  forkedFromEntryId?: string
  createdAt: number
  updatedAt: number
}

/** Every Scout session, keyed by conversation id. Deleting a session removes it here. */
export const OperatorSessionsDoc = defineDoc<{ sessions: Record<string, OperatorSessionMeta> }>({
  kind: "scout.operator.sessions",
  version: 1,
  scope: "session",
  initial: () => ({ sessions: {} }),
})

export type OperatorApprovalRecord = {
  /** The tool task id: stable across a replay of the same call. */
  id: string
  toolCallId: string
  toolName: string
  kind: "mutation" | "clarification"
  status: "pending" | "approved" | "rejected" | "canceled"
  reason: string
  affectedNodeIds: Array<string>
  requestedAt: number
  resolvedAt?: number
  actor?: string
  answer?: string
  question?: {
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiple?: boolean
  }
}

/** Approval requests and decisions of one conversation. A fork starts with none. */
export const OperatorApprovalsDoc = defineDoc<{ requests: Record<string, OperatorApprovalRecord> }>({
  kind: "scout.operator.approvals",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ requests: {} }),
})
