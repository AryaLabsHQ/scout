import { createContext, useContext } from "react"
import { useScoutWs, type ScoutState, type SystemState } from "@/hooks/use-scout-ws"
import type { System } from "@scout/shared"

const ScoutContext = createContext<ScoutState>({
  systems: {},
  isConnected: false,
  error: null,
})

interface ScoutProviderProps {
  children: React.ReactNode
  initialSystems?: System[]
}

export function ScoutProvider({ children, initialSystems }: ScoutProviderProps) {
  const state = useScoutWs(initialSystems)
  return <ScoutContext.Provider value={state}>{children}</ScoutContext.Provider>
}

export function useScout(): ScoutState {
  return useContext(ScoutContext)
}

export function useSystemState(systemId: string): SystemState | undefined {
  const { systems } = useContext(ScoutContext)
  return systems[systemId]
}
