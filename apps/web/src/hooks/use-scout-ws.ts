import { useState, useEffect, useRef, useCallback } from "react"
import type { System, AgentReport, RpcEvent } from "@scout/shared"

export interface SystemState {
  system: System
  latestMetrics: AgentReport | null
  cpuHistory: number[]
}

export interface ScoutState {
  systems: Record<string, SystemState>
  isConnected: boolean
  error: string | null
}

function getWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:3001/ws/client"
  const hubUrl = (window as Window & { __SCOUT_HUB_URL__?: string }).__SCOUT_HUB_URL__
  if (hubUrl) {
    return hubUrl.replace(/^http/, "ws") + "/ws/client"
  }
  // Default: same host as hub (assumed to be localhost:3001 in dev)
  return "ws://localhost:3001/ws/client"
}

type ScoutAction =
  | { type: "SET_CONNECTED"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "UPDATE_METRICS"; payload: AgentReport }
  | { type: "UPDATE_SYSTEM"; payload: System }
  | { type: "SEED_SYSTEMS"; payload: System[] }

function reducer(state: ScoutState, action: ScoutAction): ScoutState {
  switch (action.type) {
    case "SET_CONNECTED":
      return { ...state, isConnected: action.payload }
    case "SET_ERROR":
      return { ...state, error: action.payload }
    case "SEED_SYSTEMS": {
      const next = { ...state.systems }
      for (const sys of action.payload) {
        if (!next[sys.id]) {
          next[sys.id] = { system: sys, latestMetrics: null, cpuHistory: [] }
        } else {
          next[sys.id] = { ...next[sys.id]!, system: sys }
        }
      }
      return { ...state, systems: next }
    }
    case "UPDATE_SYSTEM": {
      const existing = state.systems[action.payload.id]
      return {
        ...state,
        systems: {
          ...state.systems,
          [action.payload.id]: {
            system: action.payload,
            latestMetrics: existing?.latestMetrics ?? null,
            cpuHistory: existing?.cpuHistory ?? [],
          },
        },
      }
    }
    case "UPDATE_METRICS": {
      const report = action.payload
      const existing = state.systems[report.systemId]
      const prevHistory = existing?.cpuHistory ?? []
      const newHistory = [
        ...prevHistory.slice(-59),
        report.system?.cpu?.usage ?? 0,
      ]
      return {
        ...state,
        systems: {
          ...state.systems,
          [report.systemId]: {
            system: existing?.system ?? {
              id: report.systemId,
              hostname: report.systemId,
              tailscaleIp: null,
              status: "online" as const,
              capabilities: {
                system: true,
                network: true,
                process: false,
                temperature: false,
                gpu: false,
                smart: false,
                systemd: false,
                docker: false,
                k8s: false,
              },
              lastSeen: report.timestamp,
              createdAt: report.timestamp,
            },
            latestMetrics: report,
            cpuHistory: newHistory,
          },
        },
      }
    }
    default:
      return state
  }
}

const INITIAL_STATE: ScoutState = {
  systems: {},
  isConnected: false,
  error: null,
}

const MAX_BACKOFF = 30_000

export function useScoutWs(seedSystems?: System[]): ScoutState {
  const [state, setState] = useState<ScoutState>(INITIAL_STATE)
  const stateRef = useRef<ScoutState>(INITIAL_STATE)
  const dispatch = useCallback((action: ScoutAction) => {
    setState((prev) => {
      const next = reducer(prev, action)
      stateRef.current = next
      return next
    })
  }, [])

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const backoffRef = useRef(1000)
  const unmounted = useRef(false)

  // Seed from SSR data on first mount
  useEffect(() => {
    if (seedSystems && seedSystems.length > 0) {
      dispatch({ type: "SEED_SYSTEMS", payload: seedSystems })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    unmounted.current = false

    function connect() {
      if (unmounted.current) return
      if (typeof window === "undefined") return

      const url = getWsUrl()
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        if (unmounted.current) return
        backoffRef.current = 1000
        dispatch({ type: "SET_CONNECTED", payload: true })
        dispatch({ type: "SET_ERROR", payload: null })
      }

      ws.onmessage = (evt) => {
        if (unmounted.current) return
        try {
          const msg = JSON.parse(String(evt.data)) as RpcEvent
          if (msg.event === "metrics.report" && msg.data) {
            dispatch({ type: "UPDATE_METRICS", payload: msg.data as AgentReport })
          } else if (msg.event === "system.update" && msg.data) {
            dispatch({ type: "UPDATE_SYSTEM", payload: msg.data as System })
          }
        } catch {
          // ignore parse errors
        }
      }

      ws.onerror = () => {
        if (unmounted.current) return
        dispatch({ type: "SET_ERROR", payload: "WebSocket error" })
      }

      ws.onclose = () => {
        if (unmounted.current) return
        dispatch({ type: "SET_CONNECTED", payload: false })
        wsRef.current = null
        // Exponential backoff reconnect
        const delay = Math.min(backoffRef.current, MAX_BACKOFF)
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF)
        reconnectTimer.current = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      unmounted.current = true
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
      }
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [dispatch])

  return state
}
