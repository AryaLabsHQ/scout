/**
 * ClientHubRpcs handler implementations.
 *
 * Cleanup pass:
 *   - All management mutations (systemd.*, docker.*, k8s.*) now call the
 *     typed HubAgentRpcs client directly via AgentRegistry.getClient. No
 *     fallback to old AgentManager.call() — if an agent isn't connected,
 *     the mutation fails with ManagementError({code: "not-connected"}).
 *   - logs.tail, terminal.open, terminal.input/resize/close all wire
 *     through the per-agent HubAgentClient the same way.
 *   - alertRules.update and systems.remove are new RPCs added in the
 *     cleanup pass to replace REST server functions for the settings page.
 */

import { Effect, PubSub, Queue, Ref, Stream } from "effect"
import type { Scope } from "effect/Scope"
import { eq } from "drizzle-orm"
import type { AgentReport, Alert, LogBatch, TerminalOutput } from "@scout/shared"
import type { BroadcastEvent } from "../services/metrics-broadcast.js"
import {
  ClientHubRpcs,
  ManagementError,
  SystemUpdateSchema,
  type AlertEvent,
  type AlertRule,
} from "@scout/shared"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"
import { Database } from "../services/database.js"
import { MetricsIngestion } from "../services/metrics-ingestion.js"
import { MetricsBroadcast } from "../services/metrics-broadcast.js"
import { AlertEngine } from "../services/alert-engine.js"
import { AgentRegistry, type HubAgentClient } from "./agent-bridge.js"
import * as schema from "../../drizzle/schema.js"

// ── Type alias ────────────────────────────────────────────────────────────────

type SystemUpdate = typeof SystemUpdateSchema.Type

// ── Row → domain mapping ──────────────────────────────────────────────────────

function rowToSystem(row: typeof schema.systems.$inferSelect) {
  return {
    id: row.id,
    hostname: row.hostname,
    tailscaleIp: row.tailscaleIp ?? null,
    status: row.status,
    capabilities: (row.capabilities as {
      system: boolean
      network: boolean
      process: boolean
      temperature: boolean
      gpu: boolean
      smart: boolean
      systemd: boolean
      docker: boolean
      k8s: boolean
    }) ?? {
      system: false,
      network: false,
      process: false,
      temperature: false,
      gpu: false,
      smart: false,
      systemd: false,
      docker: false,
      k8s: false,
    },
    lastSeen: row.lastSeen?.getTime() ?? Date.now(),
    createdAt: row.createdAt.getTime(),
  }
}

// ── MetricsRange → hours ──────────────────────────────────────────────────────

function rangeToHours(range: "1h" | "6h" | "24h" | "7d" | "30d"): number {
  switch (range) {
    case "1h":  return 1
    case "6h":  return 6
    case "24h": return 24
    case "7d":  return 168
    case "30d": return 720
  }
}

// ── RpcClientError → ManagementError mapping ─────────────────────────────────

const mapRpcClientError = (e: RpcClientError): ManagementError =>
  new ManagementError({ code: "rpc-error", message: e.message ?? "RPC client error" })

// ── Agent client lookup helper ────────────────────────────────────────────────

const getAgentClient = (
  registry: typeof AgentRegistry.Service,
  agentId: string,
): Effect.Effect<HubAgentClient, ManagementError> =>
  registry.getClient(agentId).pipe(
    Effect.flatMap((client) =>
      client === null
        ? Effect.fail(
            new ManagementError({
              code: "not-connected",
              message: `Agent ${agentId} is not connected`,
            }),
          )
        : Effect.succeed(client),
    ),
  )

// ── Run a typed RPC call against a connected agent ───────────────────────────

/**
 * Resolve the agent's typed HubAgentClient and run the provided RPC call.
 * Any `RpcClientError` from the wire is coerced into a `ManagementError`
 * so the web client sees a single error shape.
 */
const withAgent = <A>(
  registry: typeof AgentRegistry.Service,
  agentId: string,
  call: (client: HubAgentClient) => Effect.Effect<A, ManagementError | RpcClientError>,
): Effect.Effect<A, ManagementError> =>
  getAgentClient(registry, agentId).pipe(
    Effect.flatMap((client) =>
      call(client).pipe(
        Effect.mapError((e) =>
          e instanceof ManagementError ? e : mapRpcClientError(e as RpcClientError),
        ),
      ),
    ),
  )

// ── Broadcast subscription helper ────────────────────────────────────────────

function subscribeToBroadcast<T>(
  broadcast: typeof MetricsBroadcast.Service,
  eventNames: string | ReadonlyArray<string>,
  transform: (event: BroadcastEvent) => ReadonlyArray<T>,
): Effect.Effect<Queue.Queue<T>, never, Scope> {
  const names = typeof eventNames === "string" ? [eventNames] : (eventNames as ReadonlyArray<string>)
  return Effect.gen(function* () {
    const queue = yield* Queue.unbounded<T>()
    const sub = yield* broadcast.subscribe()
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          const event = yield* PubSub.take(sub)
          if (names.includes(event.event)) {
            const values = transform(event)
            for (const v of values) {
              yield* Queue.offer(queue, v)
            }
          }
        }),
      ),
    )
    return queue
  })
}

// ── Stream through typed RpcClient ────────────────────────────────────────────

/**
 * Pipe a stream from the agent's RPC client into a typed Queue for the
 * Effect RPC streaming protocol.
 */
function streamThroughAgent<T>(
  stream: Stream.Stream<T, ManagementError | RpcClientError>,
): Effect.Effect<Queue.Queue<T>, ManagementError, Scope> {
  return Effect.gen(function* () {
    const queue = yield* Queue.unbounded<T>()
    yield* Effect.forkScoped(
      Stream.runForEach(stream, (chunk) => Queue.offer(queue, chunk)).pipe(
        Effect.mapError((e) =>
          e instanceof ManagementError
            ? e
            : mapRpcClientError(e as RpcClientError),
        ),
        Effect.ensuring(Queue.shutdown(queue)),
        Effect.ignore,
      ),
    )
    return queue
  })
}

// ── Handler layer ─────────────────────────────────────────────────────────────

export const ClientHandlersLive = ClientHubRpcs.toLayer(
  Effect.gen(function* () {
    const mi = yield* MetricsIngestion
    const broadcast = yield* MetricsBroadcast
    const alerts = yield* AlertEngine
    const db = yield* Database
    const registry = yield* AgentRegistry

    // sessionId → agentId mapping for terminal mutations (no agentId in params)
    const sessionRegistry = yield* Ref.make(new Map<string, string>())

    return ClientHubRpcs.of({
      // ── Queries ──────────────────────────────────────────────────────────

      "systems.list": () =>
        Effect.sync(() => db.select().from(schema.systems).all()).pipe(
          Effect.map((rows) => rows.map(rowToSystem)),
        ),

      "systems.get": ({ id }) =>
        Effect.sync(() =>
          db.select().from(schema.systems).where(eq(schema.systems.id, id)).all(),
        ).pipe(
          Effect.map((rows) => (rows.length > 0 ? rowToSystem(rows[0]!) : null)),
        ),

      "systems.metrics": ({ id, range }) => {
        const hours = rangeToHours(range)
        return mi.querySystemMetrics(id, hours).pipe(
          Effect.map((rows) =>
            rows.map((r) => r.data as unknown as AgentReport),
          ),
        )
      },

      "alerts.list": () => alerts.getActive,

      "alertRules.list": () =>
        Effect.sync(() =>
          db.select().from(schema.alertRules).all(),
        ).pipe(
          Effect.map((rows) =>
            rows.map((r) => ({
              id: r.id,
              metric: r.metric,
              operator: r.operator,
              threshold: r.threshold,
              consecutiveCount: r.consecutiveCount,
              severity: r.severity,
              enabled: r.enabled,
              createdAt: r.createdAt.getTime(),
            })),
          ),
        ),

      // ── Alert mutations ───────────────────────────────────────────────────

      "alerts.ack": ({ alertId }) =>
        Effect.gen(function* () {
          yield* alerts.acknowledge(alertId)
          const rows = yield* Effect.sync(() =>
            db.select().from(schema.alerts).where(eq(schema.alerts.id, alertId)).all(),
          )
          const row = rows[0]
          if (!row) {
            return yield* Effect.fail(
              new ManagementError({ code: "not-found", message: `Alert ${alertId} not found` }),
            )
          }
          const updated: Alert = {
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
          }
          yield* broadcast.publishAlert({ ...updated, state: "acknowledged" })
          return updated
        }),

      "alerts.resolve": ({ alertId }) =>
        Effect.gen(function* () {
          yield* alerts.resolve(alertId)
          const rows = yield* Effect.sync(() =>
            db.select().from(schema.alerts).where(eq(schema.alerts.id, alertId)).all(),
          )
          const row = rows[0]
          if (!row) {
            return yield* Effect.fail(
              new ManagementError({ code: "not-found", message: `Alert ${alertId} not found` }),
            )
          }
          const updated: Alert = {
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
          }
          yield* broadcast.publishAlertResolved(updated)
          return updated
        }),

      // ── Systemd mutations ─────────────────────────────────────────────────

      "systemd.start": ({ agentId, unit }) =>
        withAgent(registry, agentId, (client) =>
          client["systemd.start"]({ unit }).pipe(Effect.asVoid),
        ),

      "systemd.stop": ({ agentId, unit }) =>
        withAgent(registry, agentId, (client) =>
          client["systemd.stop"]({ unit }).pipe(Effect.asVoid),
        ),

      "systemd.restart": ({ agentId, unit }) =>
        withAgent(registry, agentId, (client) =>
          client["systemd.restart"]({ unit }).pipe(Effect.asVoid),
        ),

      "systemd.enable": ({ agentId, unit }) =>
        withAgent(registry, agentId, (client) =>
          client["systemd.enable"]({ unit }).pipe(Effect.asVoid),
        ),

      "systemd.disable": ({ agentId, unit }) =>
        withAgent(registry, agentId, (client) =>
          client["systemd.disable"]({ unit }).pipe(Effect.asVoid),
        ),

      "systemd.reload": ({ agentId }) =>
        withAgent(registry, agentId, (client) =>
          client["systemd.reload"]({}).pipe(Effect.asVoid),
        ),

      "systemd.unitFile": ({ agentId, unit }) =>
        withAgent(registry, agentId, (client) => client["systemd.unitFile"]({ unit })),

      "systemd.unitFileEdit": ({ agentId, unit, content }) =>
        withAgent(registry, agentId, (client) =>
          client["systemd.unitFileEdit"]({ unit, content }).pipe(Effect.asVoid),
        ),

      // ── Docker mutations ──────────────────────────────────────────────────

      "docker.start": ({ agentId, containerId }) =>
        withAgent(registry, agentId, (client) =>
          client["docker.start"]({ containerId }).pipe(Effect.asVoid),
        ),

      "docker.stop": ({ agentId, containerId }) =>
        withAgent(registry, agentId, (client) =>
          client["docker.stop"]({ containerId }).pipe(Effect.asVoid),
        ),

      "docker.restart": ({ agentId, containerId }) =>
        withAgent(registry, agentId, (client) =>
          client["docker.restart"]({ containerId }).pipe(Effect.asVoid),
        ),

      "docker.remove": ({ agentId, containerId }) =>
        withAgent(registry, agentId, (client) =>
          client["docker.remove"]({ containerId }).pipe(Effect.asVoid),
        ),

      "docker.inspect": ({ agentId, containerId }) =>
        withAgent(registry, agentId, (client) => client["docker.inspect"]({ containerId })),

      // ── K8s mutations ─────────────────────────────────────────────────────

      "k8s.scale": ({ agentId, namespace, deployment, replicas }) =>
        withAgent(registry, agentId, (client) =>
          client["k8s.scale"]({ namespace, deployment, replicas }).pipe(Effect.asVoid),
        ),

      "k8s.restartPod": ({ agentId, namespace, pod }) =>
        withAgent(registry, agentId, (client) =>
          client["k8s.restartPod"]({ namespace, pod }).pipe(Effect.asVoid),
        ),

      "k8s.describe": ({ agentId, resource, name, namespace }) =>
        withAgent(registry, agentId, (client) =>
          client["k8s.describe"]({ resource, name, namespace }),
        ),

      // ── Alert rule + system management (settings page) ────────────────────

      "alertRules.update": ({ id, threshold, consecutiveCount, severity, enabled }) =>
        Effect.gen(function* () {
          const patch: Partial<{
            threshold: number
            consecutiveCount: number
            severity: "warning" | "critical"
            enabled: boolean
          }> = {}
          if (threshold !== undefined) patch.threshold = threshold
          if (consecutiveCount !== undefined) patch.consecutiveCount = consecutiveCount
          if (severity !== undefined) patch.severity = severity
          if (enabled !== undefined) patch.enabled = enabled

          yield* Effect.sync(() => {
            db.update(schema.alertRules).set(patch).where(eq(schema.alertRules.id, id)).run()
          })

          const rows = yield* Effect.sync(() =>
            db.select().from(schema.alertRules).where(eq(schema.alertRules.id, id)).all(),
          )
          const row = rows[0]
          if (!row) {
            return yield* Effect.fail(
              new ManagementError({ code: "not-found", message: `Alert rule ${id} not found` }),
            )
          }
          const updated: AlertRule = {
            id: row.id,
            metric: row.metric,
            operator: row.operator,
            threshold: row.threshold,
            consecutiveCount: row.consecutiveCount,
            severity: row.severity,
            enabled: row.enabled,
            createdAt: row.createdAt.getTime(),
          }
          return updated
        }),

      "systems.remove": ({ id }) =>
        Effect.gen(function* () {
          const connected = yield* registry.getConnected(id)
          if (connected !== null) {
            return yield* Effect.fail(
              new ManagementError({
                code: "system-online",
                message: `System ${id} is online; cannot remove`,
              }),
            )
          }
          const rows = yield* Effect.sync(() =>
            db.select().from(schema.systems).where(eq(schema.systems.id, id)).all(),
          )
          if (rows.length === 0) {
            return yield* Effect.fail(
              new ManagementError({ code: "not-found", message: `System ${id} not found` }),
            )
          }
          yield* Effect.sync(() => {
            db.delete(schema.systemMetrics).where(eq(schema.systemMetrics.systemId, id)).run()
            db.delete(schema.systems).where(eq(schema.systems.id, id)).run()
          })
        }),

      // ── Terminal — wired through AgentRpcRegistry ─────────────────────────

      "terminal.open": ({ agentId, mode, cols, rows, podName, namespace, container }) =>
        Effect.gen(function* () {
          const client = yield* getAgentClient(registry, agentId)
          // Omit optionalKey fields when undefined — Schema.optionalKey rejects
          // explicit `undefined`, only missing keys are allowed.
          const outputStream: Stream.Stream<TerminalOutput, ManagementError | RpcClientError> =
            client["terminal.open"]({
              mode,
              cols,
              rows,
              ...(podName !== undefined && { podName }),
              ...(namespace !== undefined && { namespace }),
              ...(container !== undefined && { container }),
            })

          const queue = yield* Queue.unbounded<TerminalOutput>()

          // When the first "session-start" chunk arrives, register sessionId → agentId
          const forwardStream = outputStream.pipe(
            Stream.tap((chunk) =>
              chunk._tag === "session-start"
                ? Ref.update(sessionRegistry, (m) => new Map(m).set(chunk.sessionId, agentId))
                : Effect.void,
            ),
            Stream.mapError((e) =>
              e instanceof ManagementError
                ? e
                : mapRpcClientError(e as RpcClientError),
            ),
          )

          yield* Effect.forkScoped(
            Stream.runForEach(forwardStream, (chunk) => Queue.offer(queue, chunk)).pipe(
              Effect.ensuring(Queue.shutdown(queue)),
              Effect.ignore,
            ),
          )

          return queue as Queue.Queue<TerminalOutput>
        }),

      "terminal.input": ({ sessionId, dataBase64 }) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(sessionRegistry)
          const agentId = map.get(sessionId)
          if (!agentId) {
            return yield* Effect.fail(
              new ManagementError({ code: "session-not-found", message: `No session ${sessionId}` }),
            )
          }
          const client = yield* getAgentClient(registry, agentId)
          yield* client["terminal.input"]({ sessionId, dataBase64 }).pipe(
            Effect.mapError((e) =>
              e instanceof ManagementError
                ? e
                : mapRpcClientError(e as RpcClientError),
            ),
          )
        }),

      "terminal.resize": ({ sessionId, cols, rows }) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(sessionRegistry)
          const agentId = map.get(sessionId)
          if (!agentId) {
            return yield* Effect.fail(
              new ManagementError({ code: "session-not-found", message: `No session ${sessionId}` }),
            )
          }
          const client = yield* getAgentClient(registry, agentId)
          yield* client["terminal.resize"]({ sessionId, cols, rows }).pipe(
            Effect.mapError((e) =>
              e instanceof ManagementError
                ? e
                : mapRpcClientError(e as RpcClientError),
            ),
          )
        }),

      "terminal.close": ({ sessionId }) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(sessionRegistry)
          const agentId = map.get(sessionId)
          if (!agentId) {
            return yield* Effect.fail(
              new ManagementError({ code: "session-not-found", message: `No session ${sessionId}` }),
            )
          }
          const client = yield* getAgentClient(registry, agentId)
          yield* client["terminal.close"]({ sessionId }).pipe(
            Effect.mapError((e) =>
              e instanceof ManagementError
                ? e
                : mapRpcClientError(e as RpcClientError),
            ),
          )
          yield* Ref.update(sessionRegistry, (m) => {
            const next = new Map(m)
            next.delete(sessionId)
            return next
          })
        }),

      // ── Streams ───────────────────────────────────────────────────────────

      "metrics.subscribe": () =>
        subscribeToBroadcast<AgentReport>(
          broadcast,
          "metrics.data",
          (event) => (event.data as AgentReport[] | undefined) ?? [],
        ),

      "alerts.subscribe": () =>
        subscribeToBroadcast<AlertEvent>(
          broadcast,
          ["alert.triggered", "alert.resolved"],
          (event): ReadonlyArray<AlertEvent> => {
            const alert = event.data as Alert | undefined
            if (!alert) return []
            if (event.event === "alert.triggered") {
              return [{ _tag: "triggered", alert }]
            }
            if (event.event === "alert.resolved") {
              return [{ _tag: "resolved", alert }]
            }
            return []
          },
        ),

      "systems.subscribe": () =>
        subscribeToBroadcast<SystemUpdate>(
          broadcast,
          ["system.connected", "system.disconnected", "system.updated"],
          (event): ReadonlyArray<SystemUpdate> => {
            if (event.event === "system.connected") {
              const system = event.data as typeof schema.systems.$inferSelect | undefined
              if (!system) return []
              return [{ _tag: "connected", system: rowToSystem(system) }]
            }
            if (event.event === "system.disconnected") {
              const systemId = (event.data as { systemId?: string } | undefined)?.systemId
              if (!systemId) return []
              return [{ _tag: "disconnected", systemId }]
            }
            if (event.event === "system.updated") {
              const system = event.data as typeof schema.systems.$inferSelect | undefined
              if (!system) return []
              return [{ _tag: "updated", system: rowToSystem(system) }]
            }
            return []
          },
        ),

      // ── logs.tail — wired through AgentRpcRegistry ────────────────────────

      "logs.tail": ({ agentId, source, target, namespace, container, tail }) =>
        Effect.gen(function* () {
          const client = yield* getAgentClient(registry, agentId)
          // Omit optionalKey fields when undefined — Schema.optionalKey rejects
          // explicit `undefined`, only missing keys are allowed.
          const logStream: Stream.Stream<LogBatch, ManagementError | RpcClientError> =
            client["logs.tail"]({
              source,
              target,
              ...(namespace !== undefined && { namespace }),
              ...(container !== undefined && { container }),
              ...(tail !== undefined && { tail }),
            })
          return yield* streamThroughAgent(logStream)
        }),
    })
  }),
)
