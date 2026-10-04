import { Effect, Result } from "effect"
import {
  PluginExecutionError,
  type EntitySnapshot,
  type MetricPoint,
  type PluginCapability,
  type PluginCollectionResult,
  type ScoutAgentPlugin,
} from "@scout/plugin-sdk"
import {
  EDGE_DEFAULT_ENDPOINTS,
  EDGE_ENTITY_KINDS,
  EDGE_ENV,
  EDGE_FEATURES,
  EDGE_METRIC_IDS,
  EDGE_PLUGIN_ID,
  EDGE_STATUS,
  type EdgeProxyState,
  type EdgeSite,
  type EdgeTunnelState,
  type EdgeUpstream,
} from "./contracts.js"
import { manifest } from "./manifest.js"

export interface HttpResponse {
  readonly status: number
  readonly body: string
}

export interface EdgeDependencies {
  readonly env: () => Readonly<Record<string, string | undefined>>
  /** A GET request. The plugin never sends anything but GET to either API. */
  readonly get: (url: string) => Effect.Effect<HttpResponse, Error>
}

/** One endpoint to read. `explicit` endpoints came from the environment and are reported even when down. */
export interface EdgeEndpoint {
  readonly name: string
  readonly url: string
  readonly explicit: boolean
}

export interface EdgeConfig {
  readonly cloudflared: ReadonlyArray<EdgeEndpoint>
  readonly caddy: ReadonlyArray<EdgeEndpoint>
}

const REQUEST_TIMEOUT_MS = 2_000

// ── Config ───────────────────────────────────────────────────────────────────

/**
 * Parse an endpoint list: comma-separated `name=url` or bare `url` entries.
 * Unset or blank uses the default (not explicit); `off` disables the source.
 * A bare url is named after its host:port. A name already taken gets the
 * first free numeric suffix, so entity ids stay unique.
 */
export const parseEndpointList = (
  value: string | undefined,
  fallback: { readonly name: string; readonly url: string },
): ReadonlyArray<EdgeEndpoint> => {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0) return [{ ...fallback, explicit: false }]
  if (trimmed.toLowerCase() === "off") return []

  const taken = new Set<string>()
  return trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const separator = entry.indexOf("=")
      const named = separator > 0 && !entry.slice(0, separator).includes("://")
      const url = (named ? entry.slice(separator + 1) : entry).trim().replace(/\/+$/, "")
      const base = named ? entry.slice(0, separator).trim() : hostOf(url)
      let name = base
      for (let suffix = 2; taken.has(name); suffix++) name = `${base}-${suffix}`
      taken.add(name)
      return { name, url, explicit: true }
    })
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export const readEdgeConfig = (env: Readonly<Record<string, string | undefined>>): EdgeConfig => ({
  cloudflared: parseEndpointList(env[EDGE_ENV.cloudflaredMetrics], EDGE_DEFAULT_ENDPOINTS.cloudflared),
  caddy: parseEndpointList(env[EDGE_ENV.caddyAdmin], EDGE_DEFAULT_ENDPOINTS.caddy),
})

// ── Parsers ──────────────────────────────────────────────────────────────────

export interface PrometheusSample {
  readonly name: string
  readonly labels: Readonly<Record<string, string>>
  readonly value: number
}

const SAMPLE_LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)/
const LABEL_PAIR = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g

/** Parse Prometheus text exposition: one sample per non-comment line. */
export const parsePrometheusText = (text: string): ReadonlyArray<PrometheusSample> =>
  text.split("\n").flatMap((line) => {
    if (line.length === 0 || line.startsWith("#")) return []
    const match = SAMPLE_LINE.exec(line)
    if (!match) return []
    const value = Number(match[3])
    if (Number.isNaN(value)) return []
    const labels: Record<string, string> = {}
    for (const pair of (match[2] ?? "").matchAll(LABEL_PAIR)) {
      labels[pair[1]!] = pair[2]!.replace(/\\(.)/g, (_, char: string) => (char === "n" ? "\n" : char))
    }
    return [{ name: match[1]!, labels, value }]
  })

const sampleValue = (samples: ReadonlyArray<PrometheusSample>, name: string): number | null =>
  samples.find((sample) => sample.name === name)?.value ?? null

/** cloudflared `/ready`: `{"status":200,"readyConnections":4,...}`. */
export const parseCloudflaredReady = (body: string): number | null => {
  try {
    const parsed = JSON.parse(body) as { readyConnections?: unknown }
    return typeof parsed.readyConnections === "number" ? parsed.readyConnections : null
  } catch {
    return null
  }
}

/** What cloudflared's `/metrics` says about the tunnel. */
export const parseCloudflaredMetrics = (text: string) => {
  const samples = parsePrometheusText(text)
  return {
    haConnections: sampleValue(samples, "cloudflared_tunnel_ha_connections"),
    totalRequests: sampleValue(samples, "cloudflared_tunnel_total_requests"),
    requestErrors: sampleValue(samples, "cloudflared_tunnel_request_errors"),
    edgeLocations: [
      ...new Set(
        samples
          .filter((sample) => sample.name === "cloudflared_tunnel_server_locations" && sample.value > 0)
          .flatMap((sample) => (sample.labels["edge_location"] ? [sample.labels["edge_location"]] : [])),
      ),
    ].sort(),
    version: samples.find((sample) => sample.name === "build_info")?.labels["version"] ?? null,
  }
}

/** Caddy `GET /reverse_proxy/upstreams`: `[{"address":"127.0.0.1:3900","num_requests":0,"fails":0}]`. */
export const parseCaddyUpstreams = (body: string): ReadonlyArray<EdgeUpstream> => {
  const parsed = JSON.parse(body) as unknown
  if (!Array.isArray(parsed)) throw new Error("Caddy upstreams response is not an array")
  return parsed.flatMap((entry: { address?: unknown; num_requests?: unknown; fails?: unknown }) =>
    typeof entry.address === "string"
      ? [
          {
            address: entry.address,
            numRequests: typeof entry.num_requests === "number" ? entry.num_requests : 0,
            fails: typeof entry.fails === "number" ? entry.fails : 0,
          },
        ]
      : [],
  )
}

interface CaddyRoute {
  readonly match?: ReadonlyArray<{ readonly host?: ReadonlyArray<string> }>
  readonly handle?: ReadonlyArray<CaddyHandler>
}

interface CaddyHandler {
  readonly handler?: string
  readonly routes?: ReadonlyArray<CaddyRoute>
  readonly upstreams?: ReadonlyArray<{ readonly dial?: string }>
}

const routeUpstreams = (routes: ReadonlyArray<CaddyRoute> | undefined): ReadonlyArray<string> =>
  (routes ?? []).flatMap((route) =>
    (route.handle ?? []).flatMap((handler) => [
      ...(handler.handler === "reverse_proxy"
        ? (handler.upstreams ?? []).flatMap((upstream) => (upstream.dial ? [upstream.dial] : []))
        : []),
      ...routeUpstreams(handler.routes),
    ]),
  )

/**
 * The sites in Caddy's `GET /config/`: each top-level route's host matchers
 * and the reverse_proxy upstreams anywhere beneath it. Only hosts, listen
 * addresses, and upstream dials are kept; the rest of the config (which can
 * hold credentials, e.g. DNS-provider tokens) is never stored or reported.
 */
export const parseCaddySites = (body: string): ReadonlyArray<EdgeSite> => {
  const config = JSON.parse(body) as {
    readonly apps?: {
      readonly http?: {
        readonly servers?: Readonly<Record<string, { readonly listen?: ReadonlyArray<string>; readonly routes?: ReadonlyArray<CaddyRoute> }>>
      }
    }
  } | null
  const servers = Object.values(config?.apps?.http?.servers ?? {})
  return servers.flatMap((server) =>
    (server.routes ?? []).flatMap((route) => {
      const hosts = (route.match ?? []).flatMap((matcher) => matcher.host ?? [])
      const upstreams = [...new Set(routeUpstreams([route]))]
      return (hosts.length > 0 ? hosts : ["*"]).map((host) => ({
        host,
        listen: [...(server.listen ?? [])],
        upstreams,
      }))
    }),
  )
}

// ── Readers ──────────────────────────────────────────────────────────────────

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const getOk = (deps: EdgeDependencies, url: string): Effect.Effect<string, Error> =>
  deps.get(url).pipe(
    Effect.flatMap((response) =>
      response.status >= 200 && response.status < 300
        ? Effect.succeed(response.body)
        : Effect.fail(new Error(`GET ${url} returned HTTP ${response.status}`)),
    ),
  )

export const readTunnel = (deps: EdgeDependencies, endpoint: EdgeEndpoint): Effect.Effect<EdgeTunnelState> =>
  Effect.all(
    [
      // `/ready` answers 200 with at least one edge connection, 503 without.
      Effect.result(deps.get(`${endpoint.url}/ready`)),
      Effect.result(getOk(deps, `${endpoint.url}/metrics`)),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map(([ready, metrics]): EdgeTunnelState => {
      const readyResponse = Result.isSuccess(ready) ? ready.success : null
      const parsed = Result.isSuccess(metrics) ? parseCloudflaredMetrics(metrics.success) : null
      const reachable = readyResponse !== null || parsed !== null
      const failure = Result.isFailure(ready) ? ready.failure : Result.isFailure(metrics) ? metrics.failure : null
      return {
        name: endpoint.name,
        endpoint: endpoint.url,
        reachable,
        error: reachable ? null : errorText(failure),
        ready: readyResponse?.status === 200,
        readyConnections: readyResponse ? parseCloudflaredReady(readyResponse.body) : null,
        haConnections: parsed?.haConnections ?? null,
        totalRequests: parsed?.totalRequests ?? null,
        requestErrors: parsed?.requestErrors ?? null,
        edgeLocations: parsed?.edgeLocations ?? [],
        version: parsed?.version ?? null,
      }
    }),
  )

const parseWith = <A>(parse: (body: string) => A) => (body: string) =>
  Effect.try({ try: () => parse(body), catch: (error) => new Error(`Unexpected Caddy response: ${errorText(error)}`) })

export const readProxy = (deps: EdgeDependencies, endpoint: EdgeEndpoint): Effect.Effect<EdgeProxyState> =>
  Effect.all(
    [
      Effect.result(getOk(deps, `${endpoint.url}/reverse_proxy/upstreams`).pipe(Effect.flatMap(parseWith(parseCaddyUpstreams)))),
      Effect.result(getOk(deps, `${endpoint.url}/config/`).pipe(Effect.flatMap(parseWith(parseCaddySites)))),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map(([upstreams, sites]): EdgeProxyState => ({
      name: endpoint.name,
      endpoint: endpoint.url,
      reachable: Result.isSuccess(upstreams),
      // Upstreams decide reachability; a config that cannot be read is still
      // an error, so the site list is never silently empty.
      error: Result.isFailure(upstreams)
        ? errorText(upstreams.failure)
        : Result.isFailure(sites)
          ? errorText(sites.failure)
          : null,
      upstreams: Result.isSuccess(upstreams) ? upstreams.success : [],
      sites: Result.isSuccess(sites) ? sites.success : [],
    })),
  )

// ── Collection ───────────────────────────────────────────────────────────────

const entityRef = (nodeId: string, kind: string, id: string) => ({ pluginId: EDGE_PLUGIN_ID, kind, nodeId, id })

export const tunnelStatus = (state: EdgeTunnelState): string =>
  !state.reachable ? EDGE_STATUS.unreachable : state.ready ? EDGE_STATUS.ready : EDGE_STATUS.notReady

export const proxyStatus = (state: EdgeProxyState): string =>
  !state.reachable
    ? EDGE_STATUS.unreachable
    : state.error !== null || state.upstreams.some((upstream) => upstream.fails > 0)
      ? EDGE_STATUS.degraded
      : EDGE_STATUS.healthy

export const buildCollection = (
  nodeId: string,
  ts: number,
  tunnels: ReadonlyArray<EdgeTunnelState>,
  proxies: ReadonlyArray<EdgeProxyState>,
): PluginCollectionResult => {
  const entities: EntitySnapshot[] = [
    ...tunnels.map((state) => ({
      ref: entityRef(nodeId, EDGE_ENTITY_KINDS.tunnel, state.name),
      ts,
      displayName: state.name,
      status: tunnelStatus(state),
      labels: { source: "cloudflared" },
      state,
    })),
    ...proxies.map((state) => ({
      ref: entityRef(nodeId, EDGE_ENTITY_KINDS.proxy, state.name),
      ts,
      displayName: state.name,
      status: proxyStatus(state),
      labels: { source: "caddy" },
      state,
    })),
  ]

  const metrics: MetricPoint[] = [
    ...tunnels.flatMap((state) => {
      const entity = entityRef(nodeId, EDGE_ENTITY_KINDS.tunnel, state.name)
      const point = (metricId: string, value: number | null) =>
        value === null ? [] : [{ pluginId: EDGE_PLUGIN_ID, metricId, ts, entity, value, unit: "count" }]
      return [
        // An unreachable connector has no ready connections.
        ...point(EDGE_METRIC_IDS.tunnelReadyConnections, state.reachable ? (state.readyConnections ?? state.haConnections) : 0),
        ...point(EDGE_METRIC_IDS.tunnelRequests, state.totalRequests),
        ...point(EDGE_METRIC_IDS.tunnelRequestErrors, state.requestErrors),
      ]
    }),
    ...proxies.flatMap((state) =>
      state.upstreams.map((upstream) => ({
        pluginId: EDGE_PLUGIN_ID,
        metricId: EDGE_METRIC_IDS.proxyUpstreamFails,
        ts,
        entity: entityRef(nodeId, EDGE_ENTITY_KINDS.proxy, state.name),
        value: upstream.fails,
        unit: "count",
        tags: { upstream: upstream.address },
      })),
    ),
  ]

  return { entities, metrics }
}

// ── Plugin ───────────────────────────────────────────────────────────────────

const makeDefaultDependencies = (): EdgeDependencies => ({
  env: () => process.env,
  get: (url) =>
    Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(url, {
          method: "GET",
          signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        })
        return { status: response.status, body: await response.text() }
      },
      catch: (error) => new Error(`GET ${url} failed: ${errorText(error)}`),
    }),
})

export const createEdgeAgentPlugin = (
  overrides: Partial<EdgeDependencies> = {},
): ScoutAgentPlugin<PluginExecutionError> => {
  const deps = { ...makeDefaultDependencies(), ...overrides } satisfies EdgeDependencies

  /**
   * Read every endpoint. Defaults that did not answer are dropped: a host
   * without cloudflared or Caddy simply has no such entity.
   */
  const readAll = () => {
    const config = readEdgeConfig(deps.env())
    return Effect.all(
      [
        Effect.forEach(config.cloudflared, (endpoint) => readTunnel(deps, endpoint), { concurrency: "unbounded" }).pipe(
          Effect.map((states) => states.filter((state, index) => state.reachable || config.cloudflared[index]!.explicit)),
        ),
        Effect.forEach(config.caddy, (endpoint) => readProxy(deps, endpoint), { concurrency: "unbounded" }).pipe(
          Effect.map((states) => states.filter((state, index) => state.reachable || config.caddy[index]!.explicit)),
        ),
      ],
      { concurrency: "unbounded" },
    )
  }

  const detect = (): Effect.Effect<PluginCapability, PluginExecutionError> =>
    readAll().pipe(
      Effect.map(([tunnels, proxies]): PluginCapability => {
        const base = { pluginId: EDGE_PLUGIN_ID, version: manifest.version, features: [...EDGE_FEATURES] }
        if (tunnels.length === 0 && proxies.length === 0) {
          return {
            ...base,
            status: "unsupported",
            reason:
              `No cloudflared metrics server or Caddy admin API answered; set ${EDGE_ENV.cloudflaredMetrics} ` +
              `or ${EDGE_ENV.caddyAdmin} to point at them.`,
          }
        }
        const down = [...tunnels, ...proxies].filter((state) => !state.reachable).map((state) => state.name)
        return down.length > 0
          ? { ...base, status: "degraded", reason: `Not answering: ${down.join(", ")}` }
          : { ...base, status: "available" }
      }),
    )

  const collect = (ctx: { readonly nodeId: string; readonly now: number }) =>
    readAll().pipe(Effect.map(([tunnels, proxies]) => buildCollection(ctx.nodeId, ctx.now, tunnels, proxies)))

  return { detect, collect } satisfies ScoutAgentPlugin<PluginExecutionError>
}

export const agent = createEdgeAgentPlugin()
