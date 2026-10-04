import { createServerFn } from "@tanstack/react-start"
import { hubFetch } from "./hub"

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
    readonly screens: ReadonlyArray<Record<string, any>>
  }
}

export const fetchPluginDetail = createServerFn({ method: "GET" })
  .inputValidator((input: { pluginId: string }) => input)
  .handler(async ({ data }): Promise<PluginDetailResponse | null> => {
    const res = await hubFetch(`/api/plugins/${encodeURIComponent(data.pluginId)}`)
    if (!res.ok) return null
    return res.json() as Promise<PluginDetailResponse>
  })

export const fetchPluginEntities = createServerFn({ method: "GET" })
  .inputValidator((input: { systemId: string; pluginId: string; kind?: string }) => input)
  .handler(async ({ data }): Promise<any[]> => {
    const res = await hubFetch(
      `/api/systems/${encodeURIComponent(data.systemId)}/plugins/${encodeURIComponent(data.pluginId)}/entities`,
      { kind: data.kind || undefined },
    )
    if (!res.ok) return []
    return res.json() as Promise<any[]>
  })

export const fetchPluginMetrics = createServerFn({ method: "GET" })
  .inputValidator((input: { systemId: string; pluginId: string; hours?: number; metricId?: string }) => input)
  .handler(async ({ data }): Promise<any[]> => {
    const res = await hubFetch(
      `/api/systems/${encodeURIComponent(data.systemId)}/plugins/${encodeURIComponent(data.pluginId)}/metrics`,
      { hours: String(data.hours ?? 24), metricId: data.metricId || undefined },
    )
    if (!res.ok) return []
    return res.json() as Promise<any[]>
  })

export const fetchPluginEvents = createServerFn({ method: "GET" })
  .inputValidator((input: { systemId: string; pluginId: string; hours?: number; eventId?: string }) => input)
  .handler(async ({ data }): Promise<any[]> => {
    const res = await hubFetch(
      `/api/systems/${encodeURIComponent(data.systemId)}/plugins/${encodeURIComponent(data.pluginId)}/events`,
      { hours: String(data.hours ?? 24), eventId: data.eventId || undefined },
    )
    if (!res.ok) return []
    return res.json() as Promise<any[]>
  })
