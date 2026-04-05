import { createContext, useContext } from "react"
import { useScoutWs, type ScoutWsExtended, type SystemState } from "@/hooks/use-scout-ws"
import type { Alert, System } from "@scout/shared"

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
  initialAlerts?: Alert[]
}

export function ScoutProvider({ children, initialSystems, initialAlerts }: ScoutProviderProps) {
  const state = useScoutWs(initialSystems, initialAlerts)
  return <ScoutContext.Provider value={state}>{children}</ScoutContext.Provider>
}

export function useScout(): ScoutWsExtended {
  return useContext(ScoutContext)
}

export function useSystemState(systemId: string): SystemState | undefined {
  const { systems } = useContext(ScoutContext)
  return systems[systemId]
}
