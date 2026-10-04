import { createServerFn } from "@tanstack/react-start"
import { hubFetch } from "./hub"
import type { AlertRule } from "@scout/shared"

// ── Health ────────────────────────────────────────────────────────────────────

export interface HubHealth {
  status: string
  version: string
  uptime: number
  connectedAgents: number
  dbSizeBytes: number
  totalSystems: number
  activeAlerts: number
}

export const fetchHealth = createServerFn({ method: "GET" }).handler(async (): Promise<HubHealth | null> => {
  const res = await hubFetch("/health")
  if (!res.ok) return null
  return res.json() as Promise<HubHealth>
})

// ── Alert Rules (read-only SSR loader; updates go via HubClient RPC) ──────────

export const fetchAlertRulesSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<AlertRule[]> => {
    const res = await hubFetch("/api/alert-rules")
    if (!res.ok) return []
    return res.json() as Promise<AlertRule[]>
  },
)
