import { useAtomValue } from "@effect/atom-react"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import type { EntitySnapshot, EventRecord, MetricPoint } from "@scout/plugin-sdk"
import type { System } from "@scout/shared"
import { HubClient } from "@/rpc/client"
import { useRefreshInterval } from "./use-refresh-interval"

export interface PluginData<A> {
  readonly items: ReadonlyArray<A>
  /** True until the first response arrives. */
  readonly loading: boolean
  readonly failed: boolean
}

/** Keeps the last good data through a failed refresh (e.g. an expired Access session). */
const toData = <A, E>(result: AsyncResult.AsyncResult<ReadonlyArray<A>, E>): PluginData<A> => ({
  items: Option.getOrElse(AsyncResult.value(result), () => [] as ReadonlyArray<A>),
  loading: result._tag === "Initial",
  failed: result._tag === "Failure",
})

/** Latest entity snapshots one plugin reported for one system, refreshed every 15 s. */
export function usePluginEntities(
  systemId: string,
  pluginId: string,
  kind?: string,
): PluginData<EntitySnapshot> {
  const atom = HubClient.query(
    "plugins.entities",
    kind === undefined ? { systemId, pluginId } : { systemId, pluginId, kind },
  )
  useRefreshInterval(atom)
  return toData(useAtomValue(atom))
}

/** Plugin metric points over the last `hours`, refreshed every 15 s. */
export function usePluginMetrics(
  systemId: string,
  pluginId: string,
  hours: number,
  metricId?: string,
): PluginData<MetricPoint> {
  const atom = HubClient.query(
    "plugins.metrics",
    metricId === undefined ? { systemId, pluginId, hours } : { systemId, pluginId, hours, metricId },
  )
  useRefreshInterval(atom)
  return toData(useAtomValue(atom))
}

/** Plugin events over the last `hours`, refreshed every 15 s. */
export function usePluginEvents(systemId: string, pluginId: string, hours: number): PluginData<EventRecord> {
  const atom = HubClient.query("plugins.events", { systemId, pluginId, hours })
  useRefreshInterval(atom)
  return toData(useAtomValue(atom))
}

/** The plugin's capability as the agent reported it (available / degraded / unsupported, with a reason). */
export function pluginCapability(system: System | null, pluginId: string) {
  return system?.pluginCapabilities?.find((capability) => capability.pluginId === pluginId) ?? null
}
