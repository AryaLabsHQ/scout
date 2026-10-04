import type { PluginManifest } from "@scout/plugin-sdk"
import { EDGE_CAPABILITY_ID, EDGE_ENTITY_KINDS, EDGE_METRIC_IDS, EDGE_PLUGIN_ID } from "./contracts.js"

export const manifest = {
  apiVersion: "v0alpha1",
  id: EDGE_PLUGIN_ID,
  displayName: "Edge",
  version: "0.0.1",
  description: "Read-only health of the tunnel connectors and reverse proxies in front of a node.",
  // Loopback HTTP GETs to cloudflared's metrics server and Caddy's admin API,
  // with endpoints from the agent's environment. No actions, no writes.
  permissions: ["node:network-egress", "node:read-env"],
  capabilities: [
    {
      id: EDGE_CAPABILITY_ID,
      displayName: "Edge",
      description: "cloudflared tunnel readiness and Caddy upstream health.",
    },
  ],
  entityKinds: [
    {
      id: EDGE_ENTITY_KINDS.tunnel,
      displayName: "Tunnel",
      pluralDisplayName: "Tunnels",
      description: "A cloudflared tunnel connector and its edge connections.",
    },
    {
      id: EDGE_ENTITY_KINDS.proxy,
      displayName: "Reverse Proxy",
      pluralDisplayName: "Reverse Proxies",
      description: "A Caddy server: its sites and upstream health.",
    },
  ],
  metrics: [
    {
      id: EDGE_METRIC_IDS.tunnelReadyConnections,
      displayName: "Ready Tunnel Connections",
      kind: "gauge",
      entityKinds: [EDGE_ENTITY_KINDS.tunnel],
      unit: "count",
    },
    {
      id: EDGE_METRIC_IDS.tunnelRequests,
      displayName: "Tunnel Requests",
      kind: "counter",
      entityKinds: [EDGE_ENTITY_KINDS.tunnel],
      unit: "count",
    },
    {
      id: EDGE_METRIC_IDS.tunnelRequestErrors,
      displayName: "Tunnel Request Errors",
      kind: "counter",
      entityKinds: [EDGE_ENTITY_KINDS.tunnel],
      unit: "count",
    },
    {
      id: EDGE_METRIC_IDS.proxyUpstreamFails,
      displayName: "Upstream Failures",
      description: "Caddy's recent failure count for one upstream (tag `upstream`).",
      kind: "gauge",
      entityKinds: [EDGE_ENTITY_KINDS.proxy],
      unit: "count",
    },
  ],
  actions: [],
  streams: [],
  alerts: [],
} satisfies PluginManifest
