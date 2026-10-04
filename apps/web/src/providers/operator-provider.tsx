import { createContext, useCallback, useContext, useMemo, useState } from "react"
import type { OperatorSessionDetail } from "@scout/shared"

interface OpenOperatorOptions {
  sessionId?: string | null
}

interface OperatorState {
  isDrawerOpen: boolean
  activeSessionId: string | null
  optimisticSession: OperatorSessionDetail | null
  openDrawer: (options?: OpenOperatorOptions) => void
  closeDrawer: () => void
  toggleDrawer: () => void
  setActiveSessionId: (sessionId: string | null) => void
  setOptimisticSession: (session: OperatorSessionDetail | null) => void
}

const OperatorContext = createContext<OperatorState>({
  isDrawerOpen: false,
  activeSessionId: null,
  optimisticSession: null,
  openDrawer: () => {},
  closeDrawer: () => {},
  toggleDrawer: () => {},
  setActiveSessionId: () => {},
  setOptimisticSession: () => {},
})

export function OperatorProvider({ children }: { children: React.ReactNode }) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null)
  const [optimisticSession, setOptimisticSessionState] = useState<OperatorSessionDetail | null>(null)

  const setActiveSessionId = useCallback((sessionId: string | null) => {
    setActiveSessionIdState(sessionId)
  }, [])

  const setOptimisticSession = useCallback((session: OperatorSessionDetail | null) => {
    setOptimisticSessionState(session)
    if (session) {
      setActiveSessionIdState(session.session.id)
    }
  }, [])

  const openDrawer = useCallback((options?: OpenOperatorOptions) => {
    if (options?.sessionId) {
      setActiveSessionIdState(options.sessionId)
    }
    setIsDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false)
  }, [])

  const toggleDrawer = useCallback(() => {
    setIsDrawerOpen((prev) => !prev)
  }, [])

  const value = useMemo<OperatorState>(
    () => ({
      isDrawerOpen,
      activeSessionId,
      optimisticSession,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      setActiveSessionId,
      setOptimisticSession,
    }),
    [
      isDrawerOpen,
      activeSessionId,
      optimisticSession,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      setActiveSessionId,
      setOptimisticSession,
    ],
  )

  return <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>
}

export function useOperator(): OperatorState {
  return useContext(OperatorContext)
}
