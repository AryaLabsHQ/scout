import type { EntitySnapshot } from "@scout/plugin-sdk"
import {
  EDGE_ENTITY_KINDS,
  EDGE_STATUS,
  type EdgeProxyState,
  type EdgeTunnelState,
} from "@scout/plugin-edge/contracts"
import type { StatusTone } from "@/components/status-dot"

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null)
const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null)
const list = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : [])

export const isTunnel = (entity: EntitySnapshot): boolean => entity.ref.kind === EDGE_ENTITY_KINDS.tunnel
export const isProxy = (entity: EntitySnapshot): boolean => entity.ref.kind === EDGE_ENTITY_KINDS.proxy

/** An `edge.tunnel` entity's state (`EdgeTunnelStateSchema`), read leniently. */
export function tunnelState(entity: EntitySnapshot): EdgeTunnelState {
  const state = record(entity.state)
  return {
    name: str(state["name"]) ?? entity.ref.id,
    endpoint: str(state["endpoint"]) ?? "",
    reachable: state["reachable"] === true,
    error: str(state["error"]),
    ready: state["ready"] === true,
    readyConnections: num(state["readyConnections"]),
    haConnections: num(state["haConnections"]),
    totalRequests: num(state["totalRequests"]),
    requestErrors: num(state["requestErrors"]),
    edgeLocations: list(state["edgeLocations"]).filter((item): item is string => typeof item === "string"),
    version: str(state["version"]),
  }
}

/** An `edge.proxy` entity's state (`EdgeProxyStateSchema`), read leniently. */
export function proxyState(entity: EntitySnapshot): EdgeProxyState {
  const state = record(entity.state)
  return {
    name: str(state["name"]) ?? entity.ref.id,
    endpoint: str(state["endpoint"]) ?? "",
    reachable: state["reachable"] === true,
    error: str(state["error"]),
    upstreams: list(state["upstreams"]).map((item) => {
      const upstream = record(item)
      return {
        address: str(upstream["address"]) ?? "",
        numRequests: num(upstream["numRequests"]) ?? 0,
        fails: num(upstream["fails"]) ?? 0,
      }
    }),
    sites: list(state["sites"]).map((item) => {
      const site = record(item)
      return {
        host: str(site["host"]) ?? "",
        listen: list(site["listen"]).filter((value): value is string => typeof value === "string"),
        upstreams: list(site["upstreams"]).filter((value): value is string => typeof value === "string"),
      }
    }),
  }
}

/** Entity status set by the plugin: ready / not-ready, healthy / degraded, or unreachable. */
export function edgeTone(entity: EntitySnapshot): StatusTone {
  switch (entity.status) {
    case EDGE_STATUS.ready:
    case EDGE_STATUS.healthy:
      return "ok"
    case EDGE_STATUS.degraded:
      return "warn"
    case EDGE_STATUS.notReady:
    case EDGE_STATUS.unreachable:
      return "err"
    default:
      return "off"
  }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

/** One-line summary for an edge entity's row. */
export function edgeSummary(entity: EntitySnapshot): string {
  if (isTunnel(entity)) {
    const state = tunnelState(entity)
    if (!state.reachable) return state.error ?? `metrics at ${state.endpoint} not answering`
    const connections = state.readyConnections ?? state.haConnections ?? 0
    return [
      "cloudflared",
      plural(connections, "connection"),
      state.requestErrors !== null ? plural(state.requestErrors, "error") : null,
      state.edgeLocations.length > 0 ? state.edgeLocations.join(", ") : null,
    ]
      .filter((part) => part !== null)
      .join(" · ")
  }
  const state = proxyState(entity)
  if (!state.reachable) return state.error ?? `admin API at ${state.endpoint} not answering`
  const fails = state.upstreams.reduce((total, upstream) => total + upstream.fails, 0)
  return ["caddy", plural(state.sites.length, "site"), plural(state.upstreams.length, "upstream"), plural(fails, "fail")].join(
    " · ",
  )
}
