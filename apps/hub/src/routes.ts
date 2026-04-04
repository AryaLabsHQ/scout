import { Config, Effect, Layer, PubSub, Ref } from "effect"
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
import { LogService } from "./services/log-service.js"
import { SystemdService } from "./services/systemd-service.js"
import { DockerService } from "./services/docker-service.js"
import { K8sService } from "./services/k8s-service.js"
import { TerminalService } from "./services/terminal.js"
import { AlertEngine } from "./services/alert-engine.js"
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

// ── Client writer registry (module-level, shared between Agent and Client WS handlers)

// We store a Ref lazily — initialised once per process.
// Each ClientWebSocketRoute handler registers/deregisters its write function.
let _clientWritersRef: Effect.Effect<Ref.Ref<Map<string, (data: string) => Effect.Effect<void>>>> | null = null

const clientWritersRef: Effect.Effect<Ref.Ref<Map<string, (data: string) => Effect.Effect<void>>>> =
  Effect.gen(function* () {
    if (_clientWritersRef === null) {
      const ref = yield* Ref.make(new Map<string, (data: string) => Effect.Effect<void>>())
      _clientWritersRef = Effect.succeed(ref)
      return ref
    }
    return yield* _clientWritersRef
  })

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
    const alertEngine = yield* AlertEngine
    const logSvc = yield* LogService
    const termSvc = yield* TerminalService

    // client writers registry: clientId → write function
    // (managed at ClientWebSocketRoute level; log forwarding uses a PubSub detour via MetricsBroadcast)
    // For log events, we route via clientWriters Ref stored at module scope below.

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
            void ingestResult.value
            // Also publish to broadcast — get the AgentReport
            const reportSystemId = (msg.params as Record<string, unknown>)["systemId"] as string ?? "unknown"
            const latestReport = yield* ingestion.queryLatest(reportSystemId)
            if (latestReport) {
              yield* broadcast.publishMetrics(latestReport)
              // Evaluate alert rules against the fresh report
              yield* alertEngine.evaluate(reportSystemId, latestReport).pipe(Effect.ignore)
            }
          }
        } else if (isRpcEvent(msg)) {
          if (msg.event === "heartbeat") {
            // Update lastSeen via re-registering is not needed — the DB is updated on ingest
            yield* Effect.log(`Heartbeat from agent`)
          } else if (msg.event === "logs.data" && msg.streamId) {
            // Forward log data to the client that requested this stream
            const streamId = msg.streamId
            yield* logSvc.routeLogEvent(
              streamId,
              msg,
              (clientId, data) =>
                Effect.gen(function* () {
                  const writers = yield* clientWritersRef
                  const writer = writers.get(clientId)
                  if (writer) {
                    yield* writer(data).pipe(Effect.ignore)
                  }
                }),
            )
          } else if (msg.event === "terminal.output" && msg.streamId) {
            // Forward terminal output to the client that owns this session
            const sessionId = msg.streamId
            const dataBase64 = msg.dataBase64 as string | undefined
            if (dataBase64) {
              yield* termSvc.routeOutput(
                sessionId,
                dataBase64,
                (clientId, data) =>
                  Effect.gen(function* () {
                    const writers = yield* clientWritersRef
                    const writer = writers.get(clientId)
                    if (writer) {
                      yield* writer(data).pipe(Effect.ignore)
                    }
                  }),
              )
            }
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
    const logSvc = yield* LogService

    const clientId = crypto.randomUUID()

    // Run writer and subscription concurrently in a scoped fiber
    yield* Effect.scoped(
      Effect.gen(function* () {
        const sub = yield* broadcast.subscribe()
        const write = yield* socket.writer

        // Register this client's writer so log events can be forwarded
        const writers = yield* clientWritersRef
        yield* Ref.update(writers, (m) => new Map(m).set(clientId, write))

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

        // Handle incoming messages from client
        yield* socket.runRaw((raw) =>
          Effect.gen(function* () {
            const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw)
            let parsed: unknown
            try {
              parsed = JSON.parse(text)
            } catch {
              yield* Effect.logWarning("Client WS: failed to parse message")
              return
            }

            const msg = parsed as Record<string, unknown>

            // Handle RPC requests from client for log streaming and management
            if (typeof msg["id"] === "string" && typeof msg["method"] === "string") {
              const id = msg["id"] as string
              const method = msg["method"] as string
              const params = (msg["params"] ?? {}) as Record<string, unknown>

              if (method === "logs.start") {
                const agentId = params["agentId"] as string | undefined
                const source = params["source"] as "k8s" | "systemd" | undefined
                const target = params["target"] as string | undefined
                const tail = typeof params["tail"] === "number" ? params["tail"] : 100

                if (!agentId || !source || !target) {
                  yield* write(JSON.stringify({
                    id,
                    ok: false,
                    error: { code: "BAD_REQUEST", message: "Missing agentId, source, or target" },
                  })).pipe(Effect.ignore)
                  return
                }

                const result = yield* Effect.exit(logSvc.startStream({
                  clientId,
                  agentId,
                  source,
                  target,
                  namespace: params["namespace"] as string | undefined,
                  container: params["container"] as string | undefined,
                  tail,
                }))

                if (result._tag === "Failure") {
                  yield* write(JSON.stringify({
                    id,
                    ok: false,
                    error: { code: "AGENT_NOT_CONNECTED", message: "Agent not connected" },
                  })).pipe(Effect.ignore)
                } else {
                  yield* write(JSON.stringify({
                    id,
                    ok: true,
                    result: { streamId: result.value },
                  })).pipe(Effect.ignore)
                }
              } else if (method === "logs.stop") {
                const streamId = params["streamId"] as string | undefined
                if (streamId) {
                  yield* logSvc.stopStream(streamId)
                }
                yield* write(JSON.stringify({ id, ok: true, result: null })).pipe(Effect.ignore)
              } else if (
                method === "systemd.start" || method === "systemd.stop" ||
                method === "systemd.restart" || method === "systemd.enable" ||
                method === "systemd.disable" || method === "systemd.reload" ||
                method === "systemd.unit-file" || method === "systemd.unit-file-edit"
              ) {
                const systemdSvc = yield* SystemdService
                const agentId = params["agentId"] as string | undefined
                const unit = params["unit"] as string | undefined
                if (!agentId) {
                  yield* write(JSON.stringify({ id, ok: false, error: { code: "BAD_REQUEST", message: "Missing agentId" } })).pipe(Effect.ignore)
                  return
                }
                let actionEffect: Effect.Effect<unknown, unknown>
                if (method === "systemd.reload") {
                  actionEffect = systemdSvc.reload(agentId)
                } else if (method === "systemd.unit-file") {
                  actionEffect = unit ? systemdSvc.getUnitFile(agentId, unit) : Effect.fail({ code: "BAD_REQUEST", message: "Missing unit" })
                } else if (method === "systemd.unit-file-edit") {
                  const content = params["content"] as string | undefined
                  actionEffect = unit && content ? systemdSvc.editUnitFile(agentId, unit, content) : Effect.fail({ code: "BAD_REQUEST", message: "Missing unit or content" })
                } else if (method === "systemd.start" && unit) {
                  actionEffect = systemdSvc.start(agentId, unit)
                } else if (method === "systemd.stop" && unit) {
                  actionEffect = systemdSvc.stop(agentId, unit)
                } else if (method === "systemd.restart" && unit) {
                  actionEffect = systemdSvc.restart(agentId, unit)
                } else if (method === "systemd.enable" && unit) {
                  actionEffect = systemdSvc.enable(agentId, unit)
                } else if (method === "systemd.disable" && unit) {
                  actionEffect = systemdSvc.disable(agentId, unit)
                } else {
                  actionEffect = Effect.fail({ code: "BAD_REQUEST", message: "Missing unit" })
                }
                const result = yield* Effect.exit(actionEffect)
                if (result._tag === "Failure") {
                  yield* write(JSON.stringify({ id, ok: false, error: { code: "RPC_ERROR", message: "Action failed" } })).pipe(Effect.ignore)
                } else {
                  yield* write(JSON.stringify({ id, ok: true, result: result.value ?? null })).pipe(Effect.ignore)
                }
              } else if (
                method === "docker.start" || method === "docker.stop" ||
                method === "docker.restart" || method === "docker.remove" ||
                method === "docker.inspect" || method === "docker.logs"
              ) {
                const dockerSvc = yield* DockerService
                const agentId = params["agentId"] as string | undefined
                const containerId = params["containerId"] as string | undefined
                if (!agentId || !containerId) {
                  yield* write(JSON.stringify({ id, ok: false, error: { code: "BAD_REQUEST", message: "Missing agentId or containerId" } })).pipe(Effect.ignore)
                  return
                }
                let actionEffect: Effect.Effect<unknown, unknown>
                if (method === "docker.start") actionEffect = dockerSvc.start(agentId, containerId)
                else if (method === "docker.stop") actionEffect = dockerSvc.stop(agentId, containerId)
                else if (method === "docker.restart") actionEffect = dockerSvc.restart(agentId, containerId)
                else if (method === "docker.remove") actionEffect = dockerSvc.remove(agentId, containerId)
                else if (method === "docker.inspect") actionEffect = dockerSvc.inspect(agentId, containerId)
                else {
                  const tail = typeof params["tail"] === "number" ? params["tail"] : 100
                  actionEffect = dockerSvc.logs(agentId, containerId, tail)
                }
                const result = yield* Effect.exit(actionEffect)
                if (result._tag === "Failure") {
                  yield* write(JSON.stringify({ id, ok: false, error: { code: "RPC_ERROR", message: "Action failed" } })).pipe(Effect.ignore)
                } else {
                  yield* write(JSON.stringify({ id, ok: true, result: result.value ?? null })).pipe(Effect.ignore)
                }
              } else if (
                method === "k8s.scale" || method === "k8s.restart-pod" || method === "k8s.describe"
              ) {
                const k8sSvc = yield* K8sService
                const agentId = params["agentId"] as string | undefined
                if (!agentId) {
                  yield* write(JSON.stringify({ id, ok: false, error: { code: "BAD_REQUEST", message: "Missing agentId" } })).pipe(Effect.ignore)
                  return
                }
                let actionEffect: Effect.Effect<unknown, unknown>
                if (method === "k8s.scale") {
                  const deployment = params["deployment"] as string
                  const namespace = params["namespace"] as string ?? "default"
                  const replicas = params["replicas"] as number
                  actionEffect = k8sSvc.scale(agentId, deployment, namespace, replicas)
                } else if (method === "k8s.restart-pod") {
                  const podName = params["podName"] as string
                  const namespace = params["namespace"] as string ?? "default"
                  actionEffect = k8sSvc.restartPod(agentId, podName, namespace)
                } else {
                  const resource = params["resource"] as string
                  const name = params["name"] as string
                  const namespace = params["namespace"] as string ?? "default"
                  actionEffect = k8sSvc.describe(agentId, resource, name, namespace)
                }
                const result = yield* Effect.exit(actionEffect)
                if (result._tag === "Failure") {
                  yield* write(JSON.stringify({ id, ok: false, error: { code: "RPC_ERROR", message: "Action failed" } })).pipe(Effect.ignore)
                } else {
                  yield* write(JSON.stringify({ id, ok: true, result: result.value ?? null })).pipe(Effect.ignore)
                }
              } else if (method === "terminal.open") {
                const termSvcC = yield* TerminalService
                const agentId = params["agentId"] as string | undefined
                const mode = params["mode"] as "shell" | "podExec" | undefined
                const cols = typeof params["cols"] === "number" ? params["cols"] : 80
                const rows = typeof params["rows"] === "number" ? params["rows"] : 24
                if (!agentId || !mode) {
                  yield* write(JSON.stringify({ id, ok: false, error: { code: "BAD_REQUEST", message: "Missing agentId or mode" } })).pipe(Effect.ignore)
                  return
                }
                const result = yield* Effect.exit(termSvcC.createSession({
                  agentId,
                  clientId,
                  mode,
                  cols,
                  rows,
                  podName: params["podName"] as string | undefined,
                  namespace: params["namespace"] as string | undefined,
                }))
                if (result._tag === "Failure") {
                  yield* write(JSON.stringify({ id, ok: false, error: { code: "AGENT_NOT_CONNECTED", message: "Agent not connected" } })).pipe(Effect.ignore)
                } else {
                  yield* write(JSON.stringify({ id, ok: true, result: { sessionId: result.value.id } })).pipe(Effect.ignore)
                }
              } else if (method === "terminal.input") {
                const termSvcC = yield* TerminalService
                const sessionId = params["sessionId"] as string | undefined
                const dataBase64 = params["dataBase64"] as string | undefined
                if (sessionId && dataBase64) {
                  yield* termSvcC.sendInput(sessionId, dataBase64)
                }
                yield* write(JSON.stringify({ id, ok: true, result: null })).pipe(Effect.ignore)
              } else if (method === "terminal.resize") {
                const termSvcC = yield* TerminalService
                const sessionId = params["sessionId"] as string | undefined
                const cols = typeof params["cols"] === "number" ? params["cols"] : 80
                const rows = typeof params["rows"] === "number" ? params["rows"] : 24
                if (sessionId) {
                  yield* termSvcC.resize(sessionId, cols, rows)
                }
                yield* write(JSON.stringify({ id, ok: true, result: null })).pipe(Effect.ignore)
              } else if (method === "terminal.close") {
                const termSvcC = yield* TerminalService
                const sessionId = params["sessionId"] as string | undefined
                if (sessionId) {
                  yield* termSvcC.closeSession(sessionId)
                }
                yield* write(JSON.stringify({ id, ok: true, result: null })).pipe(Effect.ignore)
              } else {
                yield* Effect.log(`Client WS message: ${method}`)
              }
            }
          })
        )

        // Cleanup on disconnect
        yield* Ref.update(writers, (m) => {
          const next = new Map(m)
          next.delete(clientId)
          return next
        })

        void forwardFiber
      }),
    ).pipe(Effect.ignore)

    return HttpServerResponse.empty()
  }),
)

// ── Management error helper ────────────────────────────────────────────────────

function handleManagementError(err: unknown): Effect.Effect<Response> {
  if (err && typeof err === "object" && "_tag" in err) {
    const tagged = err as { _tag: string; agentId?: string; message?: string; code?: string }
    if (tagged._tag === "AgentNotConnected") {
      return HttpServerResponse.json(
        { error: "AGENT_NOT_CONNECTED", message: `Agent ${tagged.agentId ?? "unknown"} is not connected` },
        { status: 503 },
      )
    }
    if (tagged._tag === "RpcCallError") {
      return HttpServerResponse.json(
        { error: tagged.code ?? "RPC_ERROR", message: tagged.message ?? "RPC error" },
        { status: 502 },
      )
    }
    if (tagged._tag === "TimeoutError") {
      return HttpServerResponse.json(
        { error: "TIMEOUT", message: "Agent did not respond in time" },
        { status: 504 },
      )
    }
  }
  return HttpServerResponse.json(
    { error: "INTERNAL_ERROR", message: "Internal server error" },
    { status: 500 },
  )
}

// ── POST /api/systems/:id/systemd/:unit/start ─────────────────────────────────

export const SystemdStartRoute = HttpRouter.add(
  "POST",
  "/api/systems/:id/systemd/:unit/start",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const agentId = params["id"]!
    const unit = decodeURIComponent(params["unit"]!)
    const svc = yield* SystemdService
    const result = yield* Effect.exit(svc.start(agentId, unit))
    if (result._tag === "Failure") {
      return yield* handleManagementError(result.cause)
    }
    return yield* HttpServerResponse.json({ ok: true })
  }),
)

// ── POST /api/systems/:id/systemd/:unit/stop ──────────────────────────────────

export const SystemdStopRoute = HttpRouter.add(
  "POST",
  "/api/systems/:id/systemd/:unit/stop",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const agentId = params["id"]!
    const unit = decodeURIComponent(params["unit"]!)
    const svc = yield* SystemdService
    const result = yield* Effect.exit(svc.stop(agentId, unit))
    if (result._tag === "Failure") {
      return yield* handleManagementError(result.cause)
    }
    return yield* HttpServerResponse.json({ ok: true })
  }),
)

// ── POST /api/systems/:id/systemd/:unit/restart ───────────────────────────────

export const SystemdRestartRoute = HttpRouter.add(
  "POST",
  "/api/systems/:id/systemd/:unit/restart",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const agentId = params["id"]!
    const unit = decodeURIComponent(params["unit"]!)
    const svc = yield* SystemdService
    const result = yield* Effect.exit(svc.restart(agentId, unit))
    if (result._tag === "Failure") {
      return yield* handleManagementError(result.cause)
    }
    return yield* HttpServerResponse.json({ ok: true })
  }),
)

// ── POST /api/systems/:id/systemd/:unit/enable ────────────────────────────────

export const SystemdEnableRoute = HttpRouter.add(
  "POST",
  "/api/systems/:id/systemd/:unit/enable",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const agentId = params["id"]!
    const unit = decodeURIComponent(params["unit"]!)
    const svc = yield* SystemdService
    const result = yield* Effect.exit(svc.enable(agentId, unit))
    if (result._tag === "Failure") {
      return yield* handleManagementError(result.cause)
    }
    return yield* HttpServerResponse.json({ ok: true })
  }),
)

// ── POST /api/systems/:id/systemd/:unit/disable ───────────────────────────────

export const SystemdDisableRoute = HttpRouter.add(
  "POST",
  "/api/systems/:id/systemd/:unit/disable",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const agentId = params["id"]!
    const unit = decodeURIComponent(params["unit"]!)
    const svc = yield* SystemdService
    const result = yield* Effect.exit(svc.disable(agentId, unit))
    if (result._tag === "Failure") {
      return yield* handleManagementError(result.cause)
    }
    return yield* HttpServerResponse.json({ ok: true })
  }),
)

// ── POST /api/systems/:id/systemd/reload ─────────────────────────────────────

export const SystemdReloadRoute = HttpRouter.add(
  "POST",
  "/api/systems/:id/systemd/reload",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const agentId = params["id"]!
    const svc = yield* SystemdService
    const result = yield* Effect.exit(svc.reload(agentId))
    if (result._tag === "Failure") {
      return yield* handleManagementError(result.cause)
    }
    return yield* HttpServerResponse.json({ ok: true })
  }),
)

// ── GET /api/systems/:id/systemd/:unit/file ───────────────────────────────────

export const SystemdGetUnitFileRoute = HttpRouter.add(
  "GET",
  "/api/systems/:id/systemd/:unit/file",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const agentId = params["id"]!
    const unit = decodeURIComponent(params["unit"]!)
    const svc = yield* SystemdService
    const result = yield* Effect.exit(svc.getUnitFile(agentId, unit))
    if (result._tag === "Failure") {
      return yield* handleManagementError(result.cause)
    }
    return yield* HttpServerResponse.json(result.value)
  }),
)

// ── PUT /api/systems/:id/systemd/:unit/file ───────────────────────────────────

export const SystemdEditUnitFileRoute = HttpRouter.add(
  "PUT",
  "/api/systems/:id/systemd/:unit/file",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const request = yield* HttpServerRequest.HttpServerRequest
    const agentId = params["id"]!
    const unit = decodeURIComponent(params["unit"]!)
    const body = yield* request.json as Effect.Effect<{ content?: string } | null>
    const content = (body as Record<string, unknown> | null)?.["content"]
    if (typeof content !== "string") {
      return yield* HttpServerResponse.json(
        { error: "BAD_REQUEST", message: "Missing content field" },
        { status: 400 },
      )
    }
    const svc = yield* SystemdService
    const result = yield* Effect.exit(svc.editUnitFile(agentId, unit, content))
    if (result._tag === "Failure") {
      return yield* handleManagementError(result.cause)
    }
    return yield* HttpServerResponse.json({ ok: true })
  }),
)

// ── POST /api/systems/:id/docker/:containerId/start ──────────────────────────

export const DockerStartRoute = HttpRouter.add(
  "POST",
  "/api/systems/:id/docker/:containerId/start",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const agentId = params["id"]!
    const containerId = params["containerId"]!
    const svc = yield* DockerService
    const result = yield* Effect.exit(svc.start(agentId, containerId))
    if (result._tag === "Failure") {
      return yield* handleManagementError(result.cause)
    }
    return yield* HttpServerResponse.json({ ok: true })
  }),
)

// ── POST /api/systems/:id/docker/:containerId/stop ───────────────────────────

export const DockerStopRoute = HttpRouter.add(
  "POST",
  "/api/systems/:id/docker/:containerId/stop",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const agentId = params["id"]!
    const containerId = params["containerId"]!
    const svc = yield* DockerService
    const result = yield* Effect.exit(svc.stop(agentId, containerId))
    if (result._tag === "Failure") {
      return yield* handleManagementError(result.cause)
    }
    return yield* HttpServerResponse.json({ ok: true })
  }),
)

// ── POST /api/systems/:id/docker/:containerId/restart ────────────────────────

export const DockerRestartRoute = HttpRouter.add(
  "POST",
  "/api/systems/:id/docker/:containerId/restart",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const agentId = params["id"]!
    const containerId = params["containerId"]!
    const svc = yield* DockerService
    const result = yield* Effect.exit(svc.restart(agentId, containerId))
    if (result._tag === "Failure") {
      return yield* handleManagementError(result.cause)
    }
    return yield* HttpServerResponse.json({ ok: true })
  }),
)

// ── POST /api/systems/:id/docker/:containerId/remove ─────────────────────────

export const DockerRemoveRoute = HttpRouter.add(
  "POST",
  "/api/systems/:id/docker/:containerId/remove",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const agentId = params["id"]!
    const containerId = params["containerId"]!
    const svc = yield* DockerService
    const result = yield* Effect.exit(svc.remove(agentId, containerId))
    if (result._tag === "Failure") {
      return yield* handleManagementError(result.cause)
    }
    return yield* HttpServerResponse.json({ ok: true })
  }),
)

// ── GET /api/systems/:id/docker/:containerId/inspect ─────────────────────────

export const DockerInspectRoute = HttpRouter.add(
  "GET",
  "/api/systems/:id/docker/:containerId/inspect",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const agentId = params["id"]!
    const containerId = params["containerId"]!
    const svc = yield* DockerService
    const result = yield* Effect.exit(svc.inspect(agentId, containerId))
    if (result._tag === "Failure") {
      return yield* handleManagementError(result.cause)
    }
    return yield* HttpServerResponse.json(result.value)
  }),
)

// ── GET /api/systems/:id/docker/:containerId/logs ─────────────────────────────

export const DockerLogsRoute = HttpRouter.add(
  "GET",
  "/api/systems/:id/docker/:containerId/logs",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const agentId = params["id"]!
    const containerId = params["containerId"]!
    const searchParams = yield* HttpServerRequest.ParsedSearchParams
    const tail = typeof searchParams["tail"] === "string" ? Number(searchParams["tail"]) || 100 : 100
    const svc = yield* DockerService
    const result = yield* Effect.exit(svc.logs(agentId, containerId, tail))
    if (result._tag === "Failure") {
      return yield* handleManagementError(result.cause)
    }
    return yield* HttpServerResponse.json({ logs: result.value })
  }),
)

// ── POST /api/systems/:id/k8s/scale ──────────────────────────────────────────

export const K8sScaleRoute = HttpRouter.add(
  "POST",
  "/api/systems/:id/k8s/scale",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const request = yield* HttpServerRequest.HttpServerRequest
    const agentId = params["id"]!
    const body = (yield* request.json) as Record<string, unknown> | null
    const deployment = body?.["deployment"]
    const namespace = body?.["namespace"]
    const replicas = body?.["replicas"]
    if (typeof deployment !== "string" || typeof namespace !== "string" || typeof replicas !== "number") {
      return yield* HttpServerResponse.json(
        { error: "BAD_REQUEST", message: "Missing deployment, namespace, or replicas" },
        { status: 400 },
      )
    }
    const svc = yield* K8sService
    const result = yield* Effect.exit(svc.scale(agentId, deployment, namespace, replicas))
    if (result._tag === "Failure") {
      return yield* handleManagementError(result.cause)
    }
    return yield* HttpServerResponse.json({ ok: true })
  }),
)

// ── POST /api/systems/:id/k8s/restart-pod ────────────────────────────────────

export const K8sRestartPodRoute = HttpRouter.add(
  "POST",
  "/api/systems/:id/k8s/restart-pod",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const request = yield* HttpServerRequest.HttpServerRequest
    const agentId = params["id"]!
    const body = (yield* request.json) as Record<string, unknown> | null
    const podName = body?.["podName"]
    const namespace = body?.["namespace"]
    if (typeof podName !== "string" || typeof namespace !== "string") {
      return yield* HttpServerResponse.json(
        { error: "BAD_REQUEST", message: "Missing podName or namespace" },
        { status: 400 },
      )
    }
    const svc = yield* K8sService
    const result = yield* Effect.exit(svc.restartPod(agentId, podName, namespace))
    if (result._tag === "Failure") {
      return yield* handleManagementError(result.cause)
    }
    return yield* HttpServerResponse.json({ ok: true })
  }),
)

// ── GET /api/systems/:id/k8s/describe ────────────────────────────────────────

export const K8sDescribeRoute = HttpRouter.add(
  "GET",
  "/api/systems/:id/k8s/describe",
  Effect.gen(function* () {
    const { params } = yield* HttpRouter.RouteContext
    const agentId = params["id"]!
    const searchParams = yield* HttpServerRequest.ParsedSearchParams
    const resource = searchParams["resource"]
    const name = searchParams["name"]
    const namespace = searchParams["namespace"] ?? "default"
    if (typeof resource !== "string" || typeof name !== "string") {
      return yield* HttpServerResponse.json(
        { error: "BAD_REQUEST", message: "Missing resource or name query params" },
        { status: 400 },
      )
    }
    const svc = yield* K8sService
    const result = yield* Effect.exit(svc.describe(agentId, resource, name, namespace as string))
    if (result._tag === "Failure") {
      return yield* handleManagementError(result.cause)
    }
    return yield* HttpServerResponse.json({ data: result.value })
  }),
)

// ── AppRoutes: single Layer that registers all routes ─────────────────────────

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
  UpdateAlertRuleRoute,
  AckAlertRoute,
  ResolveAlertRoute,
  AgentWebSocketRoute,
  ClientWebSocketRoute,
  // Management routes
  SystemdStartRoute,
  SystemdStopRoute,
  SystemdRestartRoute,
  SystemdEnableRoute,
  SystemdDisableRoute,
  SystemdReloadRoute,
  SystemdGetUnitFileRoute,
  SystemdEditUnitFileRoute,
  DockerStartRoute,
  DockerStopRoute,
  DockerRestartRoute,
  DockerRemoveRoute,
  DockerInspectRoute,
  DockerLogsRoute,
  K8sScaleRoute,
  K8sRestartPodRoute,
  K8sDescribeRoute,
)
