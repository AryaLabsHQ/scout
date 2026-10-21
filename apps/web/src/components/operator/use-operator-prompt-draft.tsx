import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { PromptDraftController } from "./operator-prompt-drafts"

const PromptDraftsContext = createContext<Map<string, PromptDraftController> | null>(null)

export function OperatorPromptDraftProvider({ children }: { children: ReactNode }) {
  const [drafts] = useState(() => new Map<string, PromptDraftController>())
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "hidden") return
      for (const controller of drafts.values()) void controller.refresh()
    }
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [drafts])
  return <PromptDraftsContext value={drafts}>{children}</PromptDraftsContext>
}

export function useOperatorPromptDraft(sessionId: string) {
  const drafts = useContext(PromptDraftsContext)
  if (!drafts) throw new Error("OperatorPromptDraftProvider must wrap all operator shells")
  const controller = useMemo(() => {
    const existing = drafts.get(sessionId)
    if (existing) return existing
    let database: IDBFactory | undefined
    try {
      database = globalThis.indexedDB
    } catch {
      /* Restricted browser contexts can deny even the getter. */
    }
    const created = new PromptDraftController(sessionId, database)
    drafts.set(sessionId, created)
    return created
  }, [drafts, sessionId])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => {
    void controller.restore()
  }, [controller])
  return { controller, ...state }
}
