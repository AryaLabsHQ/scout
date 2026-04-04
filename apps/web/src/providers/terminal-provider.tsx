import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react"
import type { TerminalMode } from "@scout/shared"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TerminalTab {
  id: string
  label: string
  agentId: string
  mode: TerminalMode
  podName?: string
  namespace?: string
}

export interface OpenSessionParams {
  agentId: string
  mode: TerminalMode
  label: string
  podName?: string
  namespace?: string
}

export interface TerminalState {
  sessions: TerminalTab[]
  activeTab: string | null
  isOpen: boolean
  openSession: (params: OpenSessionParams) => void
  closeSession: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  togglePanel: () => void
  openPanel: () => void
}

// ── Context ───────────────────────────────────────────────────────────────────

const TerminalContext = createContext<TerminalState>({
  sessions: [],
  activeTab: null,
  isOpen: false,
  openSession: () => {},
  closeSession: () => {},
  setActiveTab: () => {},
  togglePanel: () => {},
  openPanel: () => {},
})

// ── Provider ──────────────────────────────────────────────────────────────────

export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<TerminalTab[]>([])
  const [activeTab, setActiveTabState] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const sessionCounter = useRef(0)

  const openSession = useCallback((params: OpenSessionParams) => {
    sessionCounter.current += 1
    const id = `term-${sessionCounter.current}-${crypto.randomUUID()}`
    const tab: TerminalTab = {
      id,
      label: params.label,
      agentId: params.agentId,
      mode: params.mode,
      podName: params.podName,
      namespace: params.namespace,
    }
    setSessions((prev) => [...prev, tab])
    setActiveTabState(id)
    setIsOpen(true)
  }, [])

  const closeSession = useCallback((tabId: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== tabId)
      return next
    })
    setActiveTabState((prev) => {
      if (prev !== tabId) return prev
      // Switch to adjacent tab
      const idx = sessions.findIndex((s) => s.id === tabId)
      const remaining = sessions.filter((s) => s.id !== tabId)
      if (remaining.length === 0) return null
      const nextIdx = Math.min(idx, remaining.length - 1)
      return remaining[nextIdx]?.id ?? null
    })
  }, [sessions])

  const setActiveTab = useCallback((tabId: string) => {
    setActiveTabState(tabId)
  }, [])

  const togglePanel = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  const openPanel = useCallback(() => {
    setIsOpen(true)
  }, [])

  // Keyboard shortcut: Ctrl+` to toggle panel
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault()
        setIsOpen((prev) => !prev)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <TerminalContext.Provider
      value={{ sessions, activeTab, isOpen, openSession, closeSession, setActiveTab, togglePanel, openPanel }}
    >
      {children}
    </TerminalContext.Provider>
  )
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTerminalPanel(): TerminalState {
  return useContext(TerminalContext)
}
