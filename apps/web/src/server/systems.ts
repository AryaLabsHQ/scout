import { createServerFn } from "@tanstack/react-start"
import { hubFetch } from "./hub"
import type { System, SystemMetricsSample } from "@scout/shared"

export const fetchSystems = createServerFn({ method: "GET" }).handler(async () => {
  const res = await hubFetch("/api/systems")
  if (!res.ok) return [] as System[]
  return res.json() as Promise<System[]>
})

export const fetchSystemDetail = createServerFn({ method: "GET" })
  .inputValidator((input: { systemId: string }) => input)
  .handler(async ({ data }): Promise<(System & { latestMetrics: SystemMetricsSample | null }) | null> => {
    const res = await hubFetch(`/api/systems/${encodeURIComponent(data.systemId)}`)
    if (!res.ok) return null
    return res.json() as Promise<System & { latestMetrics: SystemMetricsSample | null }>
  })

export const fetchSystemMetrics = createServerFn({ method: "GET" })
  .inputValidator((input: { systemId: string; hours: number; type?: string }) => input)
  .handler(async ({ data }): Promise<SystemMetricsSample[]> => {
    const res = await hubFetch(`/api/systems/${encodeURIComponent(data.systemId)}/metrics`, {
      hours: String(data.hours),
      type: data.type,
    })
    if (!res.ok) return []
    return res.json() as Promise<SystemMetricsSample[]>
  })
