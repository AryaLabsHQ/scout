import { useState, useEffect, useRef, useCallback } from "react"
import type { System, AgentReport, Alert, RpcEvent } from "@scout/shared"

export interface SystemState {
  system: System
  latestMetrics: AgentReport | null
  cpuHistory: number[]
}

export interface ScoutState {
  systems: Record<string, SystemState>
  alerts: Alert[]
  activeAlertCount: number
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
  | { type: "SEED_ALERTS"; payload: Alert[] }
  | { type: "ALERT_TRIGGERED"; payload: Alert }
  | { type: "ALERT_RESOLVED"; payload: Alert }

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
    case "SEED_ALERTS": {
      // Merge seeded alerts with any already received via WS, deduped by id.
      // Existing entries win over seed data (WS is authoritative for live state).
      const byId = new Map<string, Alert>()
      for (const a of action.payload) byId.set(a.id, a)
      for (const a of state.alerts) byId.set(a.id, a)
      const alerts = Array.from(byId.values())
      const activeAlertCount = alerts.filter(
        (a) => a.state === "active" || a.state === "acknowledged",
      ).length
      return { ...state, alerts, activeAlertCount }
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
    case "ALERT_TRIGGERED": {
      const alert = action.payload
      const existing = state.alerts.find((a) => a.id === alert.id)
      const alerts = existing
        ? state.alerts.map((a) => (a.id === alert.id ? alert : a))
        : [alert, ...state.alerts]
      const activeAlertCount = alerts.filter((a) => a.state === "active" || a.state === "acknowledged").length
      return { ...state, alerts, activeAlertCount }
    }
    case "ALERT_RESOLVED": {
      const alert = action.payload
      const alerts = state.alerts.map((a) => (a.id === alert.id ? alert : a))
      const activeAlertCount = alerts.filter((a) => a.state === "active" || a.state === "acknowledged").length
      return { ...state, alerts, activeAlertCount }
    }
    default:
      return state
  }
}

const INITIAL_STATE: ScoutState = {
  systems: {},
  alerts: [],
  activeAlertCount: 0,
  isConnected: false,
  error: null,
}

const MAX_BACKOFF = 30_000

// ── RPC invoke / stream event types ──────────────────────────────────────────

export type WsInvoke = (method: string, params?: Record<string, unknown>) => Promise<unknown>
export type OnStreamEvent = (streamId: string, callback: (data: unknown) => void) => () => void

export interface ScoutWsExtended extends ScoutState {
  invoke: WsInvoke
  onStreamEvent: OnStreamEvent
}

export function useScoutWs(
  seedSystems?: System[],
  seedAlerts?: Alert[],
): ScoutWsExtended {
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

  // Pending RPC calls: id → { resolve, reject, timer }
  const pendingCalls = useRef<Map<string, {
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
    timer: ReturnType<typeof setTimeout>
  }>>(new Map())

  // Stream event listeners: streamId → Set<callback>
  const streamListeners = useRef<Map<string, Set<(data: unknown) => void>>>(new Map())

  // Seed from SSR data on first mount
  useEffect(() => {
    if (seedSystems && seedSystems.length > 0) {
      dispatch({ type: "SEED_SYSTEMS", payload: seedSystems })
    }
    if (seedAlerts && seedAlerts.length > 0) {
      dispatch({ type: "SEED_ALERTS", payload: seedAlerts })
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
          const msg = JSON.parse(String(evt.data)) as RpcEvent & {
            id?: string
            ok?: boolean
            result?: unknown
            error?: { code: string; message: string }
          }

          // RPC response (for invoke calls)
          if (typeof msg.id === "string" && typeof msg.ok === "boolean") {
            const pending = pendingCalls.current.get(msg.id)
            if (pending) {
              clearTimeout(pending.timer)
              pendingCalls.current.delete(msg.id)
              if (msg.ok) {
                pending.resolve(msg.result)
              } else {
                pending.reject(msg.error ?? { code: "UNKNOWN", message: "RPC error" })
              }
            }
            return
          }

          // Stream event (logs.data or terminal.output)
          if ((msg.event === "logs.data" || msg.event === "terminal.output") && msg.streamId) {
            const listeners = streamListeners.current.get(msg.streamId)
            if (listeners) {
              for (const cb of listeners) {
                // For terminal.output pass the whole msg so the hook can access dataBase64
                cb(msg.event === "terminal.output" ? msg : msg.data)
              }
            }
            return
          }

          // Standard broadcast events
          if (msg.event === "metrics.report" && msg.data) {
            dispatch({ type: "UPDATE_METRICS", payload: msg.data as AgentReport })
          } else if (msg.event === "metrics.data" && Array.isArray(msg.data)) {
            // Batch of reports — take the latest
            const reports = msg.data as AgentReport[]
            if (reports.length > 0) {
              dispatch({ type: "UPDATE_METRICS", payload: reports[reports.length - 1]! })
            }
          } else if (msg.event === "system.update" && msg.data) {
            dispatch({ type: "UPDATE_SYSTEM", payload: msg.data as System })
          } else if (msg.event === "alert.triggered" && msg.data) {
            const alert = msg.data as Alert
            dispatch({ type: "ALERT_TRIGGERED", payload: alert })
            // Toast notification
            import("sonner").then(({ toast }) => {
              const hostname = stateRef.current.systems[alert.systemId]?.system.hostname ?? alert.systemId
              toast.error(`${alert.severity.toUpperCase()}: ${alert.metric} on ${hostname}`, {
                duration: 5000,
              })
            }).catch(() => {})
          } else if (msg.event === "alert.resolved" && msg.data) {
            dispatch({ type: "ALERT_RESOLVED", payload: msg.data as Alert })
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
      // Reject all pending calls
      for (const [, pending] of pendingCalls.current) {
        clearTimeout(pending.timer)
        pending.reject(new Error("WebSocket closed"))
      }
      pendingCalls.current.clear()
    }
  }, [dispatch])

  // ── invoke ──────────────────────────────────────────────────────────────────

  const invoke = useCallback<WsInvoke>((method, params) => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"))
        return
      }

      const id = crypto.randomUUID()

      const timer = setTimeout(() => {
        pendingCalls.current.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, 30_000)

      pendingCalls.current.set(id, { resolve, reject, timer })
      ws.send(JSON.stringify({ id, method, params: params ?? {} }))
    })
  }, [])

  // ── onStreamEvent ────────────────────────────────────────────────────────────

  const onStreamEvent = useCallback<OnStreamEvent>((streamId, callback) => {
    if (!streamListeners.current.has(streamId)) {
      streamListeners.current.set(streamId, new Set())
    }
    streamListeners.current.get(streamId)!.add(callback)

    return () => {
      const set = streamListeners.current.get(streamId)
      if (set) {
        set.delete(callback)
        if (set.size === 0) {
          streamListeners.current.delete(streamId)
        }
      }
    }
  }, [])

  return { ...state, invoke, onStreamEvent }
}
