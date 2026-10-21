import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { PromptDraftController } from "./operator-prompt-drafts"

const PromptDraftsContext = createContext<Map<string, PromptDraftController> | null>(null)

export function OperatorPromptDraftProvider({ children }: { children: ReactNode }) {
  const [drafts] = useState(() => new Map<string, PromptDraftController>())
  return <PromptDraftsContext value={drafts}>{children}</PromptDraftsContext>
}

export function useOperatorPromptDraft(sessionId: string) {
  const drafts = useContext(PromptDraftsContext)
  const [controller] = useState(() => {
    const existing = drafts?.get(sessionId)
    if (existing) return existing
    let database: IDBFactory | undefined
    try {
      database = globalThis.indexedDB
    } catch {
      /* Restricted browser contexts can deny even the getter. */
    }
    const created = new PromptDraftController(sessionId, database)
    drafts?.set(sessionId, created)
    return created
  })
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => {
    void controller.restore()
  }, [controller])
  return { controller, ...state }
}
