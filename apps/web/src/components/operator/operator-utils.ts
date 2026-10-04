import type { OperatorSessionStatus } from "@scout/shared"

export type OperatorShellVariant = "page" | "drawer"

export const SESSION_LIST_REACTIVITY_KEY = "operator:sessions"

/** Statuses with a live answer or pending approval that `operator.sessions.abort` can stop. */
export const isOperatorSessionBusy = (status: OperatorSessionStatus): boolean =>
  status === "running" || status === "waiting_for_user"

export const defaultSessionTitle = (selectedCount: number): string =>
  selectedCount > 0
    ? `Operator session for ${selectedCount} node${selectedCount === 1 ? "" : "s"}`
    : "Operator session"
