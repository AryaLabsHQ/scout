import { createContext, useContext, useState, useCallback, useRef } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import type { TerminalMode } from "@scout/shared"

export interface InteractiveTerminalTab {
  id: string
  kind: "interactive"
  label: string
  agentId: string
  mode: TerminalMode
}

export interface OperatorProjectionTab {
  id: string
  kind: "operator_projection"
  projectionId: string
  sessionId: string
  toolCallId: string
  nodeId: string
  label: string
  base64Chunks: string[]
}

export type TerminalTab = InteractiveTerminalTab | OperatorProjectionTab

export interface OpenSessionParams {
  agentId: string
  mode: TerminalMode
  label: string
}

export interface OperatorProjectionParams {
  projectionId: string
  sessionId: string
  toolCallId: string
  nodeId: string
  label: string
  base64Chunks: string[]
}

export interface TerminalState {
  sessions: TerminalTab[]
  activeTab: string | null
  isOpen: boolean
  openSession: (params: OpenSessionParams) => void
  openOperatorProjection: (params: OperatorProjectionParams) => void
  updateOperatorProjection: (params: OperatorProjectionParams) => void
  closeSession: (tabId: string) => void
  closeOtherSessions: (tabId: string) => void
  renameSession: (tabId: string, label: string) => void
  setActiveTab: (tabId: string) => void
  togglePanel: () => void
  openPanel: () => void
}

const TerminalContext = createContext<TerminalState>({
  sessions: [],
  activeTab: null,
  isOpen: false,
  openSession: () => {},
  openOperatorProjection: () => {},
  updateOperatorProjection: () => {},
  closeSession: () => {},
  closeOtherSessions: () => {},
  renameSession: () => {},
  setActiveTab: () => {},
  togglePanel: () => {},
  openPanel: () => {},
})

function nextActiveTabId(
  sessions: ReadonlyArray<TerminalTab>,
  closedTabId: string,
): string | null {
  const idx = sessions.findIndex((session) => session.id === closedTabId)
  const remaining = sessions.filter((session) => session.id !== closedTabId)
  if (remaining.length === 0) return null
  const nextIdx = Math.min(Math.max(idx, 0), remaining.length - 1)
  return remaining[nextIdx]?.id ?? null
}

export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<TerminalTab[]>([])
  const [activeTab, setActiveTabState] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const sessionCounter = useRef(0)

  const openSession = useCallback((params: OpenSessionParams) => {
    sessionCounter.current += 1
    const id = `term-${sessionCounter.current}-${crypto.randomUUID()}`
    const tab: InteractiveTerminalTab = {
      id,
      kind: "interactive",
      label: params.label,
      agentId: params.agentId,
      mode: params.mode,
    }
    setSessions((prev) => [...prev, tab])
    setActiveTabState(id)
    setIsOpen(true)
  }, [])

  const openOperatorProjection = useCallback((params: OperatorProjectionParams) => {
    const projectionTabId = `operator-projection:${params.projectionId}`

    setSessions((prev) => {
      const existing = prev.find((session) => session.id === projectionTabId)
      if (existing && existing.kind === "operator_projection") {
        return prev.map((session) =>
          session.id === projectionTabId
            ? {
                ...session,
                label: params.label,
                nodeId: params.nodeId,
                base64Chunks: params.base64Chunks,
              }
            : session,
        )
      }

      const tab: OperatorProjectionTab = {
        id: projectionTabId,
        kind: "operator_projection",
        projectionId: params.projectionId,
        sessionId: params.sessionId,
        toolCallId: params.toolCallId,
        nodeId: params.nodeId,
        label: params.label,
        base64Chunks: params.base64Chunks,
      }

      return [...prev, tab]
    })

    setActiveTabState(projectionTabId)
    setIsOpen(true)
  }, [])

  const updateOperatorProjection = useCallback((params: OperatorProjectionParams) => {
    const projectionTabId = `operator-projection:${params.projectionId}`
    setSessions((prev) =>
      prev.map((session) =>
        session.id === projectionTabId && session.kind === "operator_projection"
          ? {
              ...session,
              label: params.label,
              nodeId: params.nodeId,
              base64Chunks: params.base64Chunks,
            }
          : session,
      ),
    )
  }, [])

  const closeSession = useCallback((tabId: string) => {
    setSessions((prev) => {
      const next = prev.filter((session) => session.id !== tabId)
      setActiveTabState((currentActiveTab) =>
        currentActiveTab === tabId ? nextActiveTabId(prev, tabId) : currentActiveTab,
      )
      return next
    })
  }, [])

  const closeOtherSessions = useCallback((tabId: string) => {
    setSessions((prev) => prev.filter((session) => session.id === tabId))
    setActiveTabState(tabId)
  }, [])

  const renameSession = useCallback((tabId: string, label: string) => {
    const trimmed = label.trim()
    if (trimmed.length === 0) return
    setSessions((prev) =>
      prev.map((session) =>
        session.id === tabId && session.kind === "interactive"
          ? { ...session, label: trimmed }
          : session,
      ),
    )
  }, [])

  const setActiveTab = useCallback((tabId: string) => {
    setActiveTabState(tabId)
  }, [])

  const togglePanel = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  const openPanel = useCallback(() => {
    setIsOpen(true)
  }, [])

  useHotkeys("ctrl+`", () => {
    setIsOpen((prev) => !prev)
  }, { preventDefault: true, enableOnFormTags: true, enableOnContentEditable: true })

  return (
    <TerminalContext.Provider
      value={{
        sessions,
        activeTab,
        isOpen,
        openSession,
        openOperatorProjection,
        updateOperatorProjection,
        closeSession,
        closeOtherSessions,
        renameSession,
        setActiveTab,
        togglePanel,
        openPanel,
      }}
    >
      {children}
    </TerminalContext.Provider>
  )
}

export function useTerminalPanel(): TerminalState {
  return useContext(TerminalContext)
}
