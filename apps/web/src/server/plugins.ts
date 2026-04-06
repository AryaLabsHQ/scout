import { createServerFn } from "@tanstack/react-start"
import { HUB_URL } from "./hub"

export interface PluginDetailResponse {
  readonly manifest: Record<string, any>
  readonly agent?: {
    readonly actions: ReadonlyArray<Record<string, any>>
    readonly streams: ReadonlyArray<Record<string, any>>
  }
  readonly hub?: {
    readonly alerts: ReadonlyArray<Record<string, any>>
  }
  readonly web?: {
    readonly views: ReadonlyArray<Record<string, any>>
  }
}

export const fetchPluginDetail = createServerFn({ method: "GET" })
  .inputValidator((input: { pluginId: string }) => input)
  .handler(async ({ data }): Promise<PluginDetailResponse | null> => {
    const res = await fetch(`${HUB_URL}/api/plugins/${encodeURIComponent(data.pluginId)}`)
    if (!res.ok) return null
    return res.json() as Promise<PluginDetailResponse>
  })

export const fetchPluginEntities = createServerFn({ method: "GET" })
  .inputValidator((input: { systemId: string; pluginId: string; kind?: string }) => input)
  .handler(async ({ data }): Promise<any[]> => {
    const url = new URL(`${HUB_URL}/api/systems/${encodeURIComponent(data.systemId)}/plugins/${encodeURIComponent(data.pluginId)}/entities`)
    if (data.kind) {
      url.searchParams.set("kind", data.kind)
    }
    const res = await fetch(url.toString())
    if (!res.ok) return []
    return res.json() as Promise<any[]>
  })

export const fetchPluginMetrics = createServerFn({ method: "GET" })
  .inputValidator((input: { systemId: string; pluginId: string; hours?: number; metricId?: string }) => input)
  .handler(async ({ data }): Promise<any[]> => {
    const url = new URL(`${HUB_URL}/api/systems/${encodeURIComponent(data.systemId)}/plugins/${encodeURIComponent(data.pluginId)}/metrics`)
    url.searchParams.set("hours", String(data.hours ?? 24))
    if (data.metricId) {
      url.searchParams.set("metricId", data.metricId)
    }
    const res = await fetch(url.toString())
    if (!res.ok) return []
    return res.json() as Promise<any[]>
  })

export const fetchPluginEvents = createServerFn({ method: "GET" })
  .inputValidator((input: { systemId: string; pluginId: string; hours?: number; eventId?: string }) => input)
  .handler(async ({ data }): Promise<any[]> => {
    const url = new URL(`${HUB_URL}/api/systems/${encodeURIComponent(data.systemId)}/plugins/${encodeURIComponent(data.pluginId)}/events`)
    url.searchParams.set("hours", String(data.hours ?? 24))
    if (data.eventId) {
      url.searchParams.set("eventId", data.eventId)
    }
    const res = await fetch(url.toString())
    if (!res.ok) return []
    return res.json() as Promise<any[]>
  })
