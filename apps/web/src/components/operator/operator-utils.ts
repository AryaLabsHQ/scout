import type {
  OperatorApprovalRequest,
  OperatorSessionDetail,
  OperatorSessionEvent,
  OperatorTerminalProjection,
} from "@scout/shared"

export type OperatorShellVariant = "page" | "drawer"

export const SESSION_LIST_REACTIVITY_KEY = "operator:sessions"

export function applyOperatorEvent(
  detail: OperatorSessionDetail,
  event: OperatorSessionEvent,
): OperatorSessionDetail {
  if (detail.events.some((existingEvent) => existingEvent.id === event.id)) {
    return detail
  }

  const nextSession = {
    ...detail.session,
    updatedAt: Math.max(detail.session.updatedAt, event.at),
    lastEventSeq: Math.max(detail.session.lastEventSeq, event.seq),
  }

  if (event.type === "approval.requested") {
    nextSession.status = "waiting_for_user"
  }

  if (
    event.type === "approval.resolved" ||
    (event.type === "message.created" && event.message?.role === "user")
  ) {
    nextSession.status = "active"
  }

  if (event.type === "session.completed" && event.status) {
    nextSession.status = event.status
    if (event.summary) {
      nextSession.summary = event.summary
    }
  }

  if (event.type === "skills.updated") {
    nextSession.attachedSkillIds = event.skillIds ?? []
  }

  const nextApprovals = event.approval
    ? [
        ...detail.approvals.filter((approval) => approval.id !== event.approval?.id),
        event.approval,
      ]
    : detail.approvals

  const nextToolCalls = event.toolCall
    ? [
        ...detail.toolCalls.filter((toolCall) => toolCall.id !== event.toolCall?.id),
        event.toolCall,
      ]
    : detail.toolCalls

  const nextTerminalProjections = event.projection
    ? [
        ...detail.terminalProjections.filter(
          (projection) => projection.id !== event.projection?.id,
        ),
        event.projection,
      ]
    : detail.terminalProjections

  const nextPlanSnapshots = event.plan
    ? [
        ...detail.planSnapshots.filter((plan) => plan.id !== event.plan?.id),
        {
          id: event.plan.id,
          sessionId: event.plan.sessionId,
          status: event.plan.status,
          summary: event.plan.summary,
          data: event.plan,
          updatedAt: event.plan.updatedAt,
        },
      ]
    : detail.planSnapshots

  return {
    session: nextSession,
    events: [...detail.events, event],
    entries: detail.entries,
    toolCalls: nextToolCalls,
    approvals: nextApprovals,
    terminalProjections: nextTerminalProjections,
    planSnapshots: nextPlanSnapshots,
    availableSkills: detail.availableSkills,
    availableResources: detail.availableResources,
    availableModels: detail.availableModels,
  }
}

export function getApprovalStateMap(
  approvalRecords: ReadonlyArray<OperatorApprovalRequest>,
): Map<string, OperatorApprovalRequest> {
  const approvalMap = new Map<string, OperatorApprovalRequest>()
  for (const approval of approvalRecords) {
    approvalMap.set(approval.id, approval)
  }
  return approvalMap
}

export function getProjectionMap(
  projectionRecords: ReadonlyArray<OperatorTerminalProjection>,
): Map<string, OperatorTerminalProjection> {
  const projectionMap = new Map<string, OperatorTerminalProjection>()
  for (const projection of projectionRecords) {
    projectionMap.set(projection.toolCallId, projection)
  }
  return projectionMap
}

export function getEntryIdBySourceEventMap(
  detail: OperatorSessionDetail | null | undefined,
): Map<string, string> {
  const entries = new Map<string, string>()
  for (const entry of detail?.entries ?? []) {
    if (entry.sourceEventId) {
      entries.set(entry.sourceEventId, entry.id)
    }
  }
  return entries
}

export function getProjectionBase64Chunks(
  events: ReadonlyArray<OperatorSessionEvent>,
  toolCallId: string,
): string[] {
  return events
    .filter((event) => event.toolCallId === toolCallId && event.outputBase64)
    .map((event) => event.outputBase64!)
}

export const formatDuration = (startedAt: number, finishedAt?: number): string => {
  const end = finishedAt ?? Date.now()
  const durationMs = Math.max(0, end - startedAt)
  if (durationMs < 1000) return `${durationMs}ms`
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.floor((durationMs % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

export const defaultSessionTitle = (selectedCount: number): string =>
  selectedCount > 0
    ? `Operator session for ${selectedCount} node${selectedCount === 1 ? "" : "s"}`
    : "Operator session"
