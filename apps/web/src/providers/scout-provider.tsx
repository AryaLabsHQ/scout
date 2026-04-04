import { createContext, useContext } from "react"
import { useScoutWs, type ScoutWsExtended, type SystemState } from "@/hooks/use-scout-ws"
import type { System } from "@scout/shared"

const ScoutContext = createContext<ScoutWsExtended>({
  systems: {},
  alerts: [],
  activeAlertCount: 0,
  isConnected: false,
  error: null,
  invoke: () => Promise.reject(new Error("Not connected")),
  onStreamEvent: () => () => {},
})

interface ScoutProviderProps {
  children: React.ReactNode
  initialSystems?: System[]
}

export function ScoutProvider({ children, initialSystems }: ScoutProviderProps) {
  const state = useScoutWs(initialSystems)
  return <ScoutContext.Provider value={state}>{children}</ScoutContext.Provider>
}

export function useScout(): ScoutWsExtended {
  return useContext(ScoutContext)
}

export function useSystemState(systemId: string): SystemState | undefined {
  const { systems } = useContext(ScoutContext)
  return systems[systemId]
}
