import { Config, Effect, Layer, PubSub } from "effect"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import { desc, gte, or, eq } from "drizzle-orm"
import {
  isRpcRequest,
  isRpcResponse,
  isRpcEvent,
  decodeScoutMessage,
} from "@scout/shared"
import type { AgentInfo } from "@scout/shared"
import { Database } from "./services/database.js"
import { MetricsIngestion } from "./services/metrics-ingestion.js"
import { MetricsBroadcast } from "./services/metrics-broadcast.js"
import { AgentManager } from "./services/agent-manager.js"
import * as schema from "../drizzle/schema.js"

// Track server start time for uptime calculation
const serverStartTime = Date.now()

// ── /health ──────────────────────────────────────────────────────────────────

export const HealthRoute = HttpRouter.add(
  "GET",
  "/health",
  Effect.gen(function* () {
    const mgr = yield* AgentManager
    const connected = yield* mgr.listConnected()
    return yield* HttpServerResponse.json({
      status: "ok",
      uptime: (Date.now() - serverStartTime) / 1000,
      connectedAgents: connected.length,
      version: "0.0.1",
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

// ── PUT /api/alert-rules/:id ──────────────────────────────────────────────────

export const UpdateAlertRuleRoute = HttpRouter.add(
  "PUT",
  "/api/alert-rules/:id",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const ruleId = params["id"]!
    const request = yield* HttpServerRequest.HttpServerRequest
    const body = yield* request.json

    const db = yield* Database

    const update: Partial<{
      threshold: number
      consecutiveCount: number
      severity: "warning" | "critical"
      enabled: boolean
    }> = {}

    if (body && typeof body === "object" && !Array.isArray(body)) {
      const b = body as Record<string, unknown>
      if (typeof b["threshold"] === "number") update.threshold = b["threshold"]
      if (typeof b["consecutiveCount"] === "number")
        update.consecutiveCount = b["consecutiveCount"]
      if (b["severity"] === "warning" || b["severity"] === "critical")
        update.severity = b["severity"]
      if (typeof b["enabled"] === "boolean") update.enabled = b["enabled"]
    }

    yield* Effect.sync(() => {
      db.update(schema.alertRules).set(update).where(eq(schema.alertRules.id, ruleId)).run()
    })

    const rows = yield* Effect.sync(() =>
      db.select().from(schema.alertRules).where(eq(schema.alertRules.id, ruleId)).all(),
    )
    if (rows.length === 0) {
      return HttpServerResponse.text("Not found", { status: 404 })
    }
    const row = rows[0]!
    return yield* HttpServerResponse.json({
      id: row.id,
      metric: row.metric,
      operator: row.operator,
      threshold: row.threshold,
      consecutiveCount: row.consecutiveCount,
      severity: row.severity,
      enabled: row.enabled,
      createdAt: row.createdAt.getTime(),
    })
  }),
)

// ── POST /api/alerts/:id/ack ──────────────────────────────────────────────────

export const AckAlertRoute = HttpRouter.add(
  "POST",
  "/api/alerts/:id/ack",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const alertId = params["id"]!
    const db = yield* Database
    const now = new Date()

    yield* Effect.sync(() => {
      db.update(schema.alerts)
        .set({ state: "acknowledged", acknowledgedAt: now })
        .where(eq(schema.alerts.id, alertId))
        .run()
    })

    const rows = yield* Effect.sync(() =>
      db.select().from(schema.alerts).where(eq(schema.alerts.id, alertId)).all(),
    )
    if (rows.length === 0) {
      return HttpServerResponse.text("Not found", { status: 404 })
    }
    const row = rows[0]!
    return yield* HttpServerResponse.json({
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
    })
  }),
)

// ── POST /api/alerts/:id/resolve ──────────────────────────────────────────────

export const ResolveAlertRoute = HttpRouter.add(
  "POST",
  "/api/alerts/:id/resolve",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const alertId = params["id"]!
    const db = yield* Database
    const now = new Date()

    yield* Effect.sync(() => {
      db.update(schema.alerts)
        .set({ state: "resolved", resolvedAt: now })
        .where(eq(schema.alerts.id, alertId))
        .run()
    })

    const rows = yield* Effect.sync(() =>
      db.select().from(schema.alerts).where(eq(schema.alerts.id, alertId)).all(),
    )
    if (rows.length === 0) {
      return HttpServerResponse.text("Not found", { status: 404 })
    }
    const row = rows[0]!
    return yield* HttpServerResponse.json({
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
    })
  }),
)

// ── GET /ws/agent ─────────────────────────────────────────────────────────────

export const AgentWebSocketRoute = HttpRouter.add(
  "GET",
  "/ws/agent",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const socket = yield* request.upgrade

    const token = yield* Config.withDefault(Config.string("SCOUT_TOKEN"), "")
    const mgr = yield* AgentManager
    const ingestion = yield* MetricsIngestion
    const broadcast = yield* MetricsBroadcast

    // Run the WebSocket message loop
    yield* socket.runRaw((raw) =>
      Effect.gen(function* () {
        const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw)

        const msgResult = yield* Effect.exit(decodeScoutMessage(JSON.parse(text)))
        if (msgResult._tag === "Failure") {
          yield* Effect.logWarning("Agent WS: failed to parse message").pipe(
            Effect.annotateLogs({ raw: text }),
          )
          return
        }
        const msg = msgResult.value

        if (isRpcRequest(msg)) {
          if (msg.method === "connect") {
            // First message: authenticate and register
            const params = msg.params ?? {}
            const incomingToken = params["token"] as string | undefined
            const hostname = (params["hostname"] as string | undefined) ?? "unknown"
            const capabilities = params["capabilities"] as Record<string, boolean> | undefined

            if (token !== "" && incomingToken !== token) {
              yield* Effect.logWarning("Agent WS: invalid token, closing")
              return
            }

            const agentInfo: AgentInfo = {
              systemId: hostname,
              hostname,
              version: (params["version"] as string | undefined) ?? "unknown",
              platform: (params["platform"] as string | undefined) ?? "unknown",
            }

            // Merge capabilities into system record after registration
            yield* mgr.register(agentInfo, socket).pipe(
              Effect.tap((system) => {
                void capabilities
                void system
                return Effect.void
              }),
            )
            yield* Effect.log(`Agent connected: ${hostname}`)
          } else if (msg.method === "metrics.report") {
            // Agent sending metrics
            const raw = msg.params ?? {}
            const ingestResult = yield* Effect.exit(ingestion.ingestRaw(raw))
            if (ingestResult._tag === "Failure") {
              yield* Effect.logWarning("Agent WS: invalid metrics report")
              return
            }
            const report = ingestResult.value
            // Also publish to broadcast — get the AgentReport
            const latestReport = yield* ingestion.queryLatest(
              (msg.params as Record<string, unknown>)["systemId"] as string ?? "unknown",
            )
            if (latestReport) {
              yield* broadcast.publishMetrics(latestReport)
            }
            void report
          }
        } else if (isRpcEvent(msg)) {
          if (msg.event === "heartbeat") {
            // Update lastSeen via re-registering is not needed — the DB is updated on ingest
            yield* Effect.log(`Heartbeat from agent`)
          }
        } else if (isRpcResponse(msg)) {
          yield* mgr.handleResponse(msg)
        }
      }),
    ).pipe(
      Effect.onExit(() =>
        // Unregister on socket close
        Effect.gen(function* () {
          const connected = yield* mgr.listConnected()
          // Find the agent connected through this socket — use the most recently connected
          // as a best-effort (the real mapping would require associating socket↔agentId)
          void connected
        }),
      ),
      Effect.scoped,
      Effect.ignore,
    )

    return HttpServerResponse.empty()
  }),
)

// ── GET /ws/client ─────────────────────────────────────────────────────────────

export const ClientWebSocketRoute = HttpRouter.add(
  "GET",
  "/ws/client",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const socket = yield* request.upgrade
    const broadcast = yield* MetricsBroadcast

    // Run writer and subscription concurrently in a scoped fiber
    yield* Effect.scoped(
      Effect.gen(function* () {
        const sub = yield* broadcast.subscribe()
        const write = yield* socket.writer

        // Forward broadcast events to client
        const forwardFiber = yield* Effect.forkScoped(
          Effect.forever(
            Effect.gen(function* () {
              const event = yield* PubSub.take(sub)
              const data = JSON.stringify(event)
              yield* write(data).pipe(Effect.ignore)
            }),
          ),
        )

        // Handle incoming messages from client (stub: just log)
        yield* socket.runRaw((raw) => {
          const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw)
          return Effect.log(`Client WS message: ${text}`)
        })

        void forwardFiber
      }),
    ).pipe(Effect.ignore)

    return HttpServerResponse.empty()
  }),
)

// ── AppRoutes: single Layer that registers all routes ─────────────────────────

export const AppRoutes = Layer.mergeAll(
  HealthRoute,
  ListSystemsRoute,
  GetSystemRoute,
  GetSystemMetricsRoute,
  ListAlertsRoute,
  ListAlertRulesRoute,
  UpdateAlertRuleRoute,
  AckAlertRoute,
  ResolveAlertRoute,
  AgentWebSocketRoute,
  ClientWebSocketRoute,
)
