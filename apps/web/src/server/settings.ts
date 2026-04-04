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

export const fetchHealth = createServerFn({ method: "GET" }).handler(
  async (): Promise<HubHealth | null> => {
    const res = await hubFetch("/health")
    if (!res.ok) return null
    return res.json() as Promise<HubHealth>
  },
)

// ── Alert Rules ───────────────────────────────────────────────────────────────

export const fetchAlertRulesSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<AlertRule[]> => {
    const res = await hubFetch("/api/alert-rules")
    if (!res.ok) return []
    return res.json() as Promise<AlertRule[]>
  },
)

export const updateAlertRule = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      id: string
      threshold?: number
      consecutiveCount?: number
      severity?: "warning" | "critical"
      enabled?: boolean
    }) => input,
  )
  .handler(async ({ data }): Promise<AlertRule | null> => {
    const { id, ...body } = data
    const res = await hubFetch(`/api/alert-rules/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    return res.json() as Promise<AlertRule>
  })

// ── Remove Agent ──────────────────────────────────────────────────────────────

export const removeAgent = createServerFn({ method: "POST" })
  .inputValidator((input: { systemId: string }) => input)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const res = await hubFetch(`/api/systems/${encodeURIComponent(data.systemId)}`, {
      method: "DELETE",
    })
    if (res.status === 409) {
      const body = (await res.json()) as { message?: string }
      return { ok: false, error: body.message ?? "Cannot remove online system" }
    }
    if (!res.ok) return { ok: false, error: "Failed to remove agent" }
    return { ok: true }
  })
