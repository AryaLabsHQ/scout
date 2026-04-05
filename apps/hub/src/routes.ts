import { Config, Effect, Layer } from "effect"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import { desc, gte, or, eq, count } from "drizzle-orm"
import { Database } from "./services/database.js"
import { MetricsIngestion } from "./services/metrics-ingestion.js"
import { AgentRegistry } from "./rpc/agent-bridge.js"
import * as schema from "../drizzle/schema.js"

// Track server start time for uptime calculation
const serverStartTime = Date.now()

// ── /health ──────────────────────────────────────────────────────────────────

export const HealthRoute = HttpRouter.add(
  "GET",
  "/health",
  Effect.gen(function* () {
    const registry = yield* AgentRegistry
    const db = yield* Database
    const connected = yield* registry.listConnected()

    // Count total systems
    const systemsCount = yield* Effect.sync(() => {
      const rows = db.select({ c: count() }).from(schema.systems).all()
      return rows[0]?.c ?? 0
    })

    // Count active alerts
    const activeAlertsCount = yield* Effect.sync(() => {
      const rows = db
        .select({ c: count() })
        .from(schema.alerts)
        .where(eq(schema.alerts.state, "active"))
        .all()
      return rows[0]?.c ?? 0
    })

    // Get DB file size from config
    const dbPath = yield* Config.withDefault(Config.string("SCOUT_DB_PATH"), "./scout.db")
    const dbSizeBytes = yield* Effect.sync(() => {
      try {
        return Bun.file(dbPath).size
      } catch {
        return 0
      }
    })

    return yield* HttpServerResponse.json({
      status: "ok",
      version: "0.0.1",
      uptime: (Date.now() - serverStartTime) / 1000,
      connectedAgents: connected.length,
      dbSizeBytes,
      totalSystems: systemsCount,
      activeAlerts: activeAlertsCount,
    })
  }),
)

// ── GET /api/systems ──────────────────────────────────────────────────────────

export const ListSystemsRoute = HttpRouter.add(
  "GET",
  "/api/systems",
  Effect.gen(function* () {
    const db = yield* Database
    const rows = yield* Effect.sync(() =>
      db.select().from(schema.systems).all(),
    )
    const systems = rows.map((row) => ({
      id: row.id,
      hostname: row.hostname,
      tailscaleIp: row.tailscaleIp,
      status: row.status,
      capabilities: row.capabilities,
      lastSeen: row.lastSeen?.getTime() ?? null,
      createdAt: row.createdAt.getTime(),
    }))
    return yield* HttpServerResponse.json(systems)
  }),
)

// ── GET /api/systems/:id ──────────────────────────────────────────────────────

export const GetSystemRoute = HttpRouter.add(
  "GET",
  "/api/systems/:id",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const systemId = params["id"]!
    const db = yield* Database
    const ingestion = yield* MetricsIngestion

    const rows = yield* Effect.sync(() =>
      db.select().from(schema.systems).where(eq(schema.systems.id, systemId)).all(),
    )
    if (rows.length === 0) {
      return HttpServerResponse.text("Not found", { status: 404 })
    }
    const row = rows[0]!
    const latest = yield* ingestion.queryLatest(systemId)

    return yield* HttpServerResponse.json({
      id: row.id,
      hostname: row.hostname,
      tailscaleIp: row.tailscaleIp,
      status: row.status,
      capabilities: row.capabilities,
      lastSeen: row.lastSeen?.getTime() ?? null,
      createdAt: row.createdAt.getTime(),
      latestMetrics: latest,
    })
  }),
)

// ── GET /api/systems/:id/metrics ──────────────────────────────────────────────

export const GetSystemMetricsRoute = HttpRouter.add(
  "GET",
  "/api/systems/:id/metrics",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const request = yield* HttpServerRequest.HttpServerRequest
    const systemId = params["id"]!

    const searchParams = yield* HttpServerRequest.ParsedSearchParams
    const hoursRaw = searchParams["hours"]
    const typeRaw = searchParams["type"]
    const hours = typeof hoursRaw === "string" ? Number(hoursRaw) || 1 : 1
    const metricType =
      typeRaw === "10m" || typeRaw === "20m" || typeRaw === "120m" || typeRaw === "480m"
        ? typeRaw
        : ("1m" as const)

    // Suppress unused variable warning
    void request

    const ingestion = yield* MetricsIngestion
    const rows = yield* ingestion.querySystemMetrics(systemId, hours, metricType)

    return yield* HttpServerResponse.json(rows.map((row) => row.data))
  }),
)

// ── GET /api/alerts ──────────────────────────────────────────────────────────

export const ListAlertsRoute = HttpRouter.add(
  "GET",
  "/api/alerts",
  Effect.gen(function* () {
    const db = yield* Database
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const rows = yield* Effect.sync(() =>
      db
        .select()
        .from(schema.alerts)
        .where(
          or(
            eq(schema.alerts.state, "active"),
            eq(schema.alerts.state, "acknowledged"),
            gte(schema.alerts.resolvedAt, since24h),
          ),
        )
        .orderBy(desc(schema.alerts.triggeredAt))
        .all(),
    )
    const alerts = rows.map((row) => ({
      id: row.id,
      ruleId: row.ruleId,
      systemId: row.systemId,
      state: row.state,
      severity: row.severity,
      metric: row.metric,
      value: row.value,
      triggeredAt: row.triggeredAt.getTime(),
      acknowledgedAt: row.acknowledgedAt?.getTime() ?? null,
      resolvedAt: row.resolvedAt?.getTime() ?? null,
    }))
    return yield* HttpServerResponse.json(alerts)
  }),
)

// ── GET /api/alert-rules ──────────────────────────────────────────────────────

export const ListAlertRulesRoute = HttpRouter.add(
  "GET",
  "/api/alert-rules",
  Effect.gen(function* () {
    const db = yield* Database
    const rows = yield* Effect.sync(() =>
      db.select().from(schema.alertRules).orderBy(schema.alertRules.createdAt).all(),
    )
    const rules = rows.map((row) => ({
      id: row.id,
      metric: row.metric,
      operator: row.operator,
      threshold: row.threshold,
      consecutiveCount: row.consecutiveCount,
      severity: row.severity,
      enabled: row.enabled,
      createdAt: row.createdAt.getTime(),
    }))
    return yield* HttpServerResponse.json(rules)
  }),
)

// ── GET /api/systems/:id/k8s ──────────────────────────────────────────────────

export const GetSystemK8sRoute = HttpRouter.add(
  "GET",
  "/api/systems/:id/k8s",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const systemId = params["id"]!
    const ingestion = yield* MetricsIngestion
    const latest = yield* ingestion.queryLatest(systemId)
    if (!latest || !latest.k8s) {
      return yield* HttpServerResponse.json(null)
    }
    return yield* HttpServerResponse.json(latest.k8s)
  }),
)

// ── GET /api/systems/:id/docker ───────────────────────────────────────────────

export const GetSystemDockerRoute = HttpRouter.add(
  "GET",
  "/api/systems/:id/docker",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const systemId = params["id"]!
    const ingestion = yield* MetricsIngestion
    const latest = yield* ingestion.queryLatest(systemId)
    if (!latest || !latest.docker) {
      return yield* HttpServerResponse.json(null)
    }
    return yield* HttpServerResponse.json(latest.docker)
  }),
)

// ── GET /api/systems/:id/systemd ──────────────────────────────────────────────

export const GetSystemSystemdRoute = HttpRouter.add(
  "GET",
  "/api/systems/:id/systemd",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const systemId = params["id"]!
    const ingestion = yield* MetricsIngestion
    const latest = yield* ingestion.queryLatest(systemId)
    if (!latest || !latest.systemd) {
      return yield* HttpServerResponse.json(null)
    }
    return yield* HttpServerResponse.json(latest.systemd)
  }),
)

// ── AppRoutes: single Layer that registers all routes ─────────────────────────
//
// Read-only REST only. All management / WS handlers now live on the @effect/rpc
// path mounted in main.ts via RpcLayer (/ws/rpc + /ws/rpc/agent). The REST
// routes below remain because TanStack Start SSR loaders in apps/web still use
// them to seed initial state before the client WS connection takes over.

export const AppRoutes = Layer.mergeAll(
  HealthRoute,
  ListSystemsRoute,
  GetSystemRoute,
  GetSystemMetricsRoute,
  GetSystemK8sRoute,
  GetSystemDockerRoute,
  GetSystemSystemdRoute,
  ListAlertsRoute,
  ListAlertRulesRoute,
)
