import type { OperatorApprovalMode, OperatorSessionStatus } from "@scout/shared"

export type OperatorShellVariant = "page" | "drawer"

export const SESSION_LIST_REACTIVITY_KEY = "operator:sessions"

/** Statuses with a live answer or pending approval that `operator.sessions.abort` can stop. */
export const isOperatorSessionBusy = (status: OperatorSessionStatus): boolean =>
  status === "running" || status === "waiting_for_user"

export const defaultSessionTitle = (selectedCount: number): string =>
  selectedCount > 0
    ? `Operator session for ${selectedCount} node${selectedCount === 1 ? "" : "s"}`
    : "Operator session"

/** Human labels and status-dot tones for session states; never show the raw enum. */
export const SESSION_STATUS: Record<OperatorSessionStatus, { readonly label: string; readonly tone: "ok" | "warn" | "err" | "off" }> = {
  idle: { label: "Idle", tone: "off" },
  running: { label: "Working", tone: "ok" },
  waiting_for_user: { label: "Awaiting your decision", tone: "warn" },
  failed: { label: "Failed", tone: "err" },
  archived: { label: "Archived", tone: "off" },
}

export const APPROVAL_MODE_LABEL: Record<OperatorApprovalMode, string> = {
  confirm_each_mutation: "Approve each change",
  auto_approve_reads: "Auto-approve reads",
  auto_approve_all: "Auto-approve everything",
}
