import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { decodePluginManifest, decodePluginUiScreen } from "@scout/plugin-sdk"
import { EDGE_ENTITY_KINDS, EDGE_METRIC_IDS, EDGE_PLUGIN_ID } from "../src/contracts.js"
import {
  createEdgeAgentPlugin,
  parseCaddySites,
  parseCaddyUpstreams,
  parseCloudflaredMetrics,
  parseEndpointList,
  parsePrometheusText,
  type HttpResponse,
} from "../src/edge.js"
import { manifest } from "../src/manifest.js"
import { web } from "../src/web.js"

// Trimmed from cloudflared 2026.9.1 on Agni.
const CLOUDFLARED_METRICS = `# HELP build_info Build and version information
# TYPE build_info gauge
build_info{goversion="go1.26.8",revision="2026-09-11-13:35 UTC",type="",version="2026.9.1"} 1
# TYPE cloudflared_tunnel_ha_connections gauge
cloudflared_tunnel_ha_connections 4
cloudflared_tunnel_request_errors 2
cloudflared_tunnel_response_by_code{status_code="200"} 61
cloudflared_tunnel_server_locations{connection_id="0",edge_location="fra10"} 1
cloudflared_tunnel_server_locations{connection_id="1",edge_location="fra16"} 1
cloudflared_tunnel_server_locations{connection_id="2",edge_location="fra10"} 1
cloudflared_tunnel_server_locations{connection_id="3",edge_location="ams01"} 0
cloudflared_tunnel_total_requests 65
`

const CLOUDFLARED_READY = `{"status":200,"readyConnections":4,"connectorId":"00000000-0000-0000-0000-000000000000"}`

const CADDY_UPSTREAMS = `[{"address":"127.0.0.1:3900","num_requests":0,"fails":0},{"address":"127.0.0.1:3773","num_requests":1,"fails":3}]`

// Shape of Agni's Caddy config: nested subroutes, a path-matched 404, and a
// tls app holding a credential that must never be reported.
const CADDY_CONFIG = JSON.stringify({
  apps: {
    http: {
      servers: {
        srv0: {
          listen: [":443"],
          routes: [
            {
              match: [{ host: ["agni.example.ts.net"] }],
              handle: [{ handler: "subroute", routes: [{ handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "127.0.0.1:3773" }] }] }] }],
            },
          ],
        },
        srv1: {
          listen: [":80"],
          routes: [
            {
              match: [{ host: ["scout.example.com"] }],
              handle: [
                {
                  handler: "subroute",
                  routes: [
                    { match: [{ path: ["/ws/rpc/agent"] }], handle: [{ handler: "static_response", status_code: 404 }] },
                    { handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "127.0.0.1:3901" }] }] },
                    { handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "127.0.0.1:3900" }, { dial: "127.0.0.1:3901" }] }] },
                  ],
                },
              ],
            },
            { handle: [{ handler: "static_response", status_code: 421 }] },
          ],
        },
      },
    },
    tls: { automation: { policies: [{ issuers: [{ challenges: { dns: { provider: { api_token: "secret-token" } } } }] }] } },
  },
})

const fakeGet =
  (routes: Readonly<Record<string, HttpResponse>>, calls: string[] = []) =>
  (url: string) => {
    calls.push(url)
    const response = routes[url]
    return response ? Effect.succeed(response) : Effect.fail(new Error(`GET ${url} failed: connection refused`))
  }

const AGNI_ROUTES: Readonly<Record<string, HttpResponse>> = {
  "http://127.0.0.1:2002/ready": { status: 200, body: CLOUDFLARED_READY },
  "http://127.0.0.1:2002/metrics": { status: 200, body: CLOUDFLARED_METRICS },
  "http://127.0.0.1:2019/reverse_proxy/upstreams": { status: 200, body: CADDY_UPSTREAMS },
  "http://127.0.0.1:2019/config/": { status: 200, body: CADDY_CONFIG },
}

const plugin = (env: Record<string, string>, routes = AGNI_ROUTES, calls: string[] = []) =>
  createEdgeAgentPlugin({ env: () => env, get: fakeGet(routes, calls) })

describe("edge config", () => {
  it("parses named and bare endpoints, and off", () => {
    expect(parseEndpointList("agni-host=http://127.0.0.1:2002/, http://127.0.0.1:2003", { name: "x", url: "u" })).toEqual([
      { name: "agni-host", url: "http://127.0.0.1:2002", explicit: true },
      { name: "127.0.0.1:2003", url: "http://127.0.0.1:2003", explicit: true },
    ])
    expect(parseEndpointList(undefined, { name: "caddy", url: "http://127.0.0.1:2019" })).toEqual([
      { name: "caddy", url: "http://127.0.0.1:2019", explicit: false },
    ])
    expect(parseEndpointList(" off ", { name: "caddy", url: "http://127.0.0.1:2019" })).toEqual([])
  })

  it("keeps entity ids unique when names repeat", () => {
    expect(
      parseEndpointList("t=http://127.0.0.1:1,t=http://127.0.0.1:2", { name: "x", url: "u" }).map((endpoint) => endpoint.name),
    ).toEqual(["t", "t-2"])
  })
})

describe("edge parsers", () => {
  it("parses Prometheus text with labels", () => {
    expect(parsePrometheusText('a_total{x="1",y="a\\"b"} 3\n# comment\nb 4.5\nbad line\n')).toEqual([
      { name: "a_total", labels: { x: "1", y: 'a"b' }, value: 3 },
      { name: "b", labels: {}, value: 4.5 },
    ])
  })

  it("reads tunnel health from cloudflared metrics", () => {
    expect(parseCloudflaredMetrics(CLOUDFLARED_METRICS)).toEqual({
      haConnections: 4,
      totalRequests: 65,
      requestErrors: 2,
      edgeLocations: ["fra10", "fra16"],
      version: "2026.9.1",
    })
  })

  it("reads Caddy upstreams", () => {
    expect(parseCaddyUpstreams(CADDY_UPSTREAMS)).toEqual([
      { address: "127.0.0.1:3900", numRequests: 0, fails: 0 },
      { address: "127.0.0.1:3773", numRequests: 1, fails: 3 },
    ])
    expect(() => parseCaddyUpstreams("{}")).toThrow()
  })

  it("lists Caddy sites with their upstreams and nothing else from the config", () => {
    const sites = parseCaddySites(CADDY_CONFIG)
    expect(sites).toEqual([
      { host: "agni.example.ts.net", listen: [":443"], upstreams: ["127.0.0.1:3773"] },
      { host: "scout.example.com", listen: [":80"], upstreams: ["127.0.0.1:3901", "127.0.0.1:3900"] },
      { host: "*", listen: [":80"], upstreams: [] },
    ])
    expect(JSON.stringify(sites)).not.toContain("secret-token")
  })
})

describe("edge plugin", () => {
  it("collects a ready tunnel and a proxy with a failing upstream", async () => {
    const result = await Effect.runPromise(
      plugin({ SCOUT_EDGE_CLOUDFLARED_METRICS: "agni-host=http://127.0.0.1:2002" }).collect!({ nodeId: "agni", now: 7 }),
    )
    expect(result.entities?.map((entity) => [entity.ref.kind, entity.ref.id, entity.status, entity.ts])).toEqual([
      [EDGE_ENTITY_KINDS.tunnel, "agni-host", "ready", 7],
      [EDGE_ENTITY_KINDS.proxy, "caddy", "degraded", 7],
    ])
    expect(result.entities?.[0]?.state).toMatchObject({ readyConnections: 4, requestErrors: 2, reachable: true })
    expect(JSON.stringify(result)).not.toContain("connectorId")
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricId: EDGE_METRIC_IDS.tunnelReadyConnections, value: 4 }),
        expect.objectContaining({ metricId: EDGE_METRIC_IDS.proxyUpstreamFails, value: 3, tags: { upstream: "127.0.0.1:3773" } }),
      ]),
    )
  })

  it("only ever issues GETs to the documented read-only paths", async () => {
    const calls: string[] = []
    await Effect.runPromise(
      plugin({ SCOUT_EDGE_CLOUDFLARED_METRICS: "agni-host=http://127.0.0.1:2002" }, AGNI_ROUTES, calls).collect!({
        nodeId: "agni",
        now: 7,
      }),
    )
    expect(new Set(calls)).toEqual(new Set(Object.keys(AGNI_ROUTES)))
  })

  it("reports a tunnel without edge connections as not ready", async () => {
    const result = await Effect.runPromise(
      plugin(
        { SCOUT_EDGE_CLOUDFLARED_METRICS: "t=http://127.0.0.1:2002", SCOUT_EDGE_CADDY_ADMIN: "off" },
        {
          ...AGNI_ROUTES,
          "http://127.0.0.1:2002/ready": { status: 503, body: `{"status":503,"readyConnections":0}` },
        },
      ).collect!({ nodeId: "agni", now: 7 }),
    )
    expect(result.entities?.map((entity) => entity.status)).toEqual(["not-ready"])
  })

  it("drops defaults that do not answer and reports explicit endpoints that do not", async () => {
    const defaults = plugin({}, {})
    expect(await Effect.runPromise(defaults.detect({ nodeId: "n", now: 1 }))).toMatchObject({ status: "unsupported" })
    expect((await Effect.runPromise(defaults.collect!({ nodeId: "n", now: 1 }))).entities).toEqual([])

    const explicit = plugin({ SCOUT_EDGE_CLOUDFLARED_METRICS: "gone=http://127.0.0.1:2999" }, {})
    expect(await Effect.runPromise(explicit.detect({ nodeId: "n", now: 1 }))).toMatchObject({
      status: "degraded",
      reason: "Not answering: gone",
    })
    const result = await Effect.runPromise(explicit.collect!({ nodeId: "n", now: 1 }))
    expect(result.entities?.map((entity) => [entity.ref.id, entity.status])).toEqual([["gone", "unreachable"]])
    expect(result.metrics).toEqual([
      expect.objectContaining({ metricId: EDGE_METRIC_IDS.tunnelReadyConnections, value: 0 }),
    ])
  })

  it("detects Caddy on its default admin address", async () => {
    expect(await Effect.runPromise(plugin({}).detect({ nodeId: "n", now: 1 }))).toMatchObject({
      pluginId: EDGE_PLUGIN_ID,
      status: "available",
    })
  })

  it("publishes a valid manifest and web screen", async () => {
    await expect(Effect.runPromise(decodePluginManifest(manifest))).resolves.toMatchObject({ id: EDGE_PLUGIN_ID })
    const screens = await Promise.all(web.screens.map((screen) => Effect.runPromise(decodePluginUiScreen(screen))))
    expect(screens.map((screen) => screen.id)).toEqual(["edge.overview"])
  })
})
