import { Schema } from "effect"
import type { PluginUiScreen } from "@scout/plugin-sdk"

export const EDGE_PLUGIN_ID = "edge"
export const EDGE_CAPABILITY_ID = "edge"

export const EDGE_ENTITY_KINDS = {
  /** A cloudflared tunnel connector, read from its metrics server. */
  tunnel: "edge.tunnel",
  /** A Caddy reverse proxy, read from its admin API. */
  proxy: "edge.proxy",
} as const satisfies Record<string, string>

export const EDGE_FEATURES = ["collect", "cloudflared", "caddy"] as const

export const EDGE_METRIC_IDS = {
  tunnelReadyConnections: "tunnel.connections.ready",
  tunnelRequests: "tunnel.requests.total",
  tunnelRequestErrors: "tunnel.requests.errors",
  proxyUpstreamFails: "proxy.upstream.fails",
} as const satisfies Record<string, string>

/**
 * Environment the agent reads to find the endpoints. Both take a comma-separated
 * list of `name=url` or bare `url` entries; `off` disables a source.
 *
 * - `SCOUT_EDGE_CLOUDFLARED_METRICS`: cloudflared `--metrics` servers. Unset
 *   probes cloudflared's default `127.0.0.1:20241`.
 * - `SCOUT_EDGE_CADDY_ADMIN`: Caddy admin API. Unset probes Caddy's default
 *   `127.0.0.1:2019`.
 *
 * A default that does not answer is skipped silently; an endpoint set
 * explicitly is reported as unreachable when it does not answer.
 */
export const EDGE_ENV = {
  cloudflaredMetrics: "SCOUT_EDGE_CLOUDFLARED_METRICS",
  caddyAdmin: "SCOUT_EDGE_CADDY_ADMIN",
} as const

export const EDGE_DEFAULT_ENDPOINTS = {
  cloudflared: { name: "cloudflared", url: "http://127.0.0.1:20241" },
  caddy: { name: "caddy", url: "http://127.0.0.1:2019" },
} as const

const NullableNumber = Schema.NullOr(Schema.Number)
const NullableString = Schema.NullOr(Schema.String)

/** `state` of an `edge.tunnel` entity. Counters are cumulative since cloudflared started. */
export const EdgeTunnelStateSchema = Schema.Struct({
  name: Schema.String,
  endpoint: Schema.String,
  reachable: Schema.Boolean,
  error: NullableString,
  ready: Schema.Boolean,
  readyConnections: NullableNumber,
  haConnections: NullableNumber,
  totalRequests: NullableNumber,
  requestErrors: NullableNumber,
  edgeLocations: Schema.Array(Schema.String),
  version: NullableString,
})

export const EdgeUpstreamSchema = Schema.Struct({
  address: Schema.String,
  numRequests: Schema.Number,
  fails: Schema.Number,
})

/** One site Caddy serves: a host matcher and the upstreams its routes proxy to. */
export const EdgeSiteSchema = Schema.Struct({
  host: Schema.String,
  listen: Schema.Array(Schema.String),
  upstreams: Schema.Array(Schema.String),
})

/**
 * `state` of an `edge.proxy` entity. `reachable` follows the upstreams read;
 * `error` is also set when only the config read failed, which marks the proxy
 * degraded.
 */
export const EdgeProxyStateSchema = Schema.Struct({
  name: Schema.String,
  endpoint: Schema.String,
  reachable: Schema.Boolean,
  error: NullableString,
  upstreams: Schema.Array(EdgeUpstreamSchema),
  sites: Schema.Array(EdgeSiteSchema),
})

export type EdgeTunnelState = typeof EdgeTunnelStateSchema.Type
export type EdgeProxyState = typeof EdgeProxyStateSchema.Type
export type EdgeUpstream = typeof EdgeUpstreamSchema.Type
export type EdgeSite = typeof EdgeSiteSchema.Type

/** Entity `status` values: a tunnel is ready / not-ready, a proxy healthy / degraded; either can be unreachable. */
export const EDGE_STATUS = {
  ready: "ready",
  notReady: "not-ready",
  healthy: "healthy",
  degraded: "degraded",
  unreachable: "unreachable",
} as const

export const edgeScreens: ReadonlyArray<PluginUiScreen> = [
  {
    id: "edge.overview",
    pluginId: EDGE_PLUGIN_ID,
    kind: "overview",
    title: "Edge",
    spec: {
      root: "page",
      elements: {
        page: {
          type: "Page",
          props: {
            title: "Edge",
            subtitle: "Tunnel connectors and reverse proxies in front of this machine.",
          },
          children: ["tunnelsSection", "proxiesSection"],
        },
        tunnelsSection: {
          type: "Section",
          props: { title: "Tunnels" },
          children: ["tunnelsTable"],
        },
        tunnelsTable: {
          type: "EntityTable",
          props: {
            entityKind: EDGE_ENTITY_KINDS.tunnel,
            statePath: `/entitiesByKind/${EDGE_ENTITY_KINDS.tunnel}`,
            columns: [
              { id: "name", label: "Connector", source: { kind: "field", path: "state.name" } },
              { id: "status", label: "Status", source: { kind: "status" } },
              {
                id: "ready",
                label: "Ready connections",
                source: { kind: "field", path: "state.readyConnections" },
              },
              {
                id: "errors",
                label: "Request errors",
                source: { kind: "field", path: "state.requestErrors" },
              },
              { id: "endpoint", label: "Metrics", source: { kind: "field", path: "state.endpoint" } },
            ],
            empty: {
              title: "No tunnels",
              description: "No cloudflared metrics endpoint answered on this node.",
            },
          },
        },
        proxiesSection: {
          type: "Section",
          props: { title: "Reverse proxies" },
          children: ["proxiesTable"],
        },
        proxiesTable: {
          type: "EntityTable",
          props: {
            entityKind: EDGE_ENTITY_KINDS.proxy,
            statePath: `/entitiesByKind/${EDGE_ENTITY_KINDS.proxy}`,
            columns: [
              { id: "name", label: "Proxy", source: { kind: "field", path: "state.name" } },
              { id: "status", label: "Status", source: { kind: "status" } },
              { id: "endpoint", label: "Admin API", source: { kind: "field", path: "state.endpoint" } },
            ],
            empty: {
              title: "No proxies",
              description: "No Caddy admin API answered on this node.",
            },
          },
        },
      },
    },
  },
]
