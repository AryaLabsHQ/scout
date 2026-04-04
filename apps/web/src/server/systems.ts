import { createServerFn } from "@tanstack/react-start"
import { HUB_URL } from "./hub"
import type { System, AgentReport } from "@scout/shared"

export const fetchSystems = createServerFn({ method: "GET" }).handler(async () => {
  const res = await fetch(`${HUB_URL}/api/systems`)
  if (!res.ok) return [] as System[]
  return res.json() as Promise<System[]>
})

export const fetchSystemDetail = createServerFn({ method: "GET" })
  .inputValidator((input: { systemId: string }) => input)
  .handler(async ({ data }): Promise<(System & { latestMetrics: AgentReport | null }) | null> => {
    const res = await fetch(`${HUB_URL}/api/systems/${data.systemId}`)
    if (!res.ok) return null
    return res.json() as Promise<System & { latestMetrics: AgentReport | null }>
  })

export const fetchSystemMetrics = createServerFn({ method: "GET" })
  .inputValidator((input: { systemId: string; hours: number; type?: string }) => input)
  .handler(async ({ data }): Promise<AgentReport[]> => {
    const url = new URL(`${HUB_URL}/api/systems/${data.systemId}/metrics`)
    url.searchParams.set("hours", String(data.hours))
    if (data.type) url.searchParams.set("type", data.type)
    const res = await fetch(url.toString())
    if (!res.ok) return []
    return res.json() as Promise<AgentReport[]>
  })
