import { createServerFn } from "@tanstack/react-start"
import { hubFetch } from "./hub"
import type { Alert, AlertRule } from "@scout/shared"

export const fetchAlerts = createServerFn({ method: "GET" }).handler(async (): Promise<Alert[]> => {
  const res = await hubFetch("/api/alerts")
  if (!res.ok) return []
  return res.json() as Promise<Alert[]>
})

export const fetchAlertRules = createServerFn({ method: "GET" }).handler(
  async (): Promise<AlertRule[]> => {
    const res = await hubFetch("/api/alert-rules")
    if (!res.ok) return []
    return res.json() as Promise<AlertRule[]>
  },
)
