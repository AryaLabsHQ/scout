/**
 * ClientHubRpcs handler implementations.
 *
 * Phase C:
 *   - Management mutations (systemd.*, docker.*, k8s.*) now prefer the typed
 *     HubAgentRpcs client from AgentRpcRegistry; if the agent hasn't migrated
 *     yet, falls back to the old-protocol AgentManager.call() bridge.
 *   - terminal.open, terminal.input/resize/close, and logs.tail are now wired
 *     through to the per-agent HubAgentRpcs client.
 */

import { Effect, PubSub, Queue, Ref, Stream } from "effect"
import type { Scope } from "effect/Scope"
import { eq } from "drizzle-orm"
import type { AgentReport, Alert, LogBatch, RpcEvent, TerminalOutput } from "@scout/shared"
import {
  ClientHubRpcs,
  ManagementError,
  SystemUpdateSchema,
  type AlertEvent,
} from "@scout/shared"
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError"
import { Database } from "../services/database.js"
import { MetricsIngestion } from "../services/metrics-ingestion.js"
import { MetricsBroadcast } from "../services/metrics-broadcast.js"
import { AlertEngine } from "../services/alert-engine.js"
import { AgentManager } from "../services/agent-manager.js"
import { AgentRpcRegistry, type HubAgentClient } from "./agent-bridge.js"
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
  registry: typeof AgentRpcRegistry.Service,
  agentId: string,
): Effect.Effect<HubAgentClient, ManagementError> =>
  registry.get(agentId).pipe(
    Effect.flatMap((client) =>
      client === null
        ? Effect.fail(
            new ManagementError({
              code: "not-connected",
              message: `Agent ${agentId} is not connected via new RPC protocol`,
            }),
          )
        : Effect.succeed(client),
    ),
  )

// ── Bridge: forward a management call to the old-protocol agent ───────────────

const forwardToAgent = (
  agentMgr: typeof AgentManager.Service,
  agentId: string,
  method: string,
  params: Record<string, unknown>,
): Effect.Effect<unknown, ManagementError> =>
  Effect.gen(function* () {
    const request = { id: crypto.randomUUID(), method, params }
    const response = yield* agentMgr.call(agentId, request).pipe(
      Effect.mapError((err): ManagementError => {
        if (err._tag === "AgentNotConnected") {
          return new ManagementError({ code: "not-connected", message: "Agent not connected" })
        }
        if (err._tag === "TimeoutError") {
          return new ManagementError({ code: "timeout", message: `RPC call timed out: ${err.method}` })
        }
        if (err._tag === "RpcCallError") {
          return new ManagementError({ code: err.code, message: err.message })
        }
        return new ManagementError({ code: "socket-error", message: "Socket error communicating with agent" })
      }),
    )
    if (!response.ok) {
      return yield* Effect.fail(
        new ManagementError({
          code: response.error?.code ?? "agent-error",
          message: response.error?.message ?? "Unknown agent error",
        }),
      )
    }
    return response.result
  })

// ── Try new RPC registry first, fall back to old-protocol bridge ──────────────

const withAgentFallback = <A>(
  registry: typeof AgentRpcRegistry.Service,
  agentMgr: typeof AgentManager.Service,
  agentId: string,
  fallbackMethod: string,
  fallbackParams: Record<string, unknown>,
  newRpcCall: (client: HubAgentClient) => Effect.Effect<A, ManagementError | RpcClientError>,
): Effect.Effect<A, ManagementError> =>
  registry.get(agentId).pipe(
    Effect.flatMap((client) =>
      client !== null
        ? newRpcCall(client).pipe(
            Effect.mapError((e) =>
              e instanceof ManagementError
                ? e
                : mapRpcClientError(e as RpcClientError),
            ),
          )
        : forwardToAgent(agentMgr, agentId, fallbackMethod, fallbackParams) as Effect.Effect<A, ManagementError>,
    ),
  )

// ── Broadcast subscription helper ────────────────────────────────────────────

function subscribeToBroadcast<T>(
  broadcast: typeof MetricsBroadcast.Service,
  eventNames: string | ReadonlyArray<string>,
  transform: (event: RpcEvent) => ReadonlyArray<T>,
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
    const agentMgr = yield* AgentManager
    const registry = yield* AgentRpcRegistry

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
        withAgentFallback(registry, agentMgr, agentId, "systemd.start", { unit },
          (client) => client["systemd.start"]({ unit }).pipe(Effect.asVoid),
        ),

      "systemd.stop": ({ agentId, unit }) =>
        withAgentFallback(registry, agentMgr, agentId, "systemd.stop", { unit },
          (client) => client["systemd.stop"]({ unit }).pipe(Effect.asVoid),
        ),

      "systemd.restart": ({ agentId, unit }) =>
        withAgentFallback(registry, agentMgr, agentId, "systemd.restart", { unit },
          (client) => client["systemd.restart"]({ unit }).pipe(Effect.asVoid),
        ),

      "systemd.enable": ({ agentId, unit }) =>
        withAgentFallback(registry, agentMgr, agentId, "systemd.enable", { unit },
          (client) => client["systemd.enable"]({ unit }).pipe(Effect.asVoid),
        ),

      "systemd.disable": ({ agentId, unit }) =>
        withAgentFallback(registry, agentMgr, agentId, "systemd.disable", { unit },
          (client) => client["systemd.disable"]({ unit }).pipe(Effect.asVoid),
        ),

      "systemd.reload": ({ agentId }) =>
        withAgentFallback(registry, agentMgr, agentId, "systemd.reload", {},
          (client) => client["systemd.reload"]({}).pipe(Effect.asVoid),
        ),

      "systemd.unitFile": ({ agentId, unit }) =>
        withAgentFallback(registry, agentMgr, agentId, "systemd.unitFile", { unit },
          (client) => client["systemd.unitFile"]({ unit }),
        ).pipe(
          Effect.flatMap((result) => {
            if (result && typeof result === "object" && "path" in result && "content" in result) {
              const r = result as { path: string; content: string }
              return Effect.succeed({ path: r.path, content: r.content })
            }
            return Effect.fail(
              new ManagementError({ code: "invalid-response", message: "Invalid unitFile response" }),
            )
          }),
        ),

      "systemd.unitFileEdit": ({ agentId, unit, content }) =>
        withAgentFallback(registry, agentMgr, agentId, "systemd.unitFileEdit", { unit, content },
          (client) => client["systemd.unitFileEdit"]({ unit, content }).pipe(Effect.asVoid),
        ),

      // ── Docker mutations ──────────────────────────────────────────────────

      "docker.start": ({ agentId, containerId }) =>
        withAgentFallback(registry, agentMgr, agentId, "docker.start", { containerId },
          (client) => client["docker.start"]({ containerId }).pipe(Effect.asVoid),
        ),

      "docker.stop": ({ agentId, containerId }) =>
        withAgentFallback(registry, agentMgr, agentId, "docker.stop", { containerId },
          (client) => client["docker.stop"]({ containerId }).pipe(Effect.asVoid),
        ),

      "docker.restart": ({ agentId, containerId }) =>
        withAgentFallback(registry, agentMgr, agentId, "docker.restart", { containerId },
          (client) => client["docker.restart"]({ containerId }).pipe(Effect.asVoid),
        ),

      "docker.remove": ({ agentId, containerId }) =>
        withAgentFallback(registry, agentMgr, agentId, "docker.remove", { containerId },
          (client) => client["docker.remove"]({ containerId }).pipe(Effect.asVoid),
        ),

      "docker.inspect": ({ agentId, containerId }) =>
        withAgentFallback(registry, agentMgr, agentId, "docker.inspect", { containerId },
          (client) => client["docker.inspect"]({ containerId }),
        ),

      // ── K8s mutations ─────────────────────────────────────────────────────

      "k8s.scale": ({ agentId, namespace, deployment, replicas }) =>
        withAgentFallback(registry, agentMgr, agentId, "k8s.scale", { namespace, deployment, replicas },
          (client) => client["k8s.scale"]({ namespace, deployment, replicas }).pipe(Effect.asVoid),
        ),

      "k8s.restartPod": ({ agentId, namespace, pod }) =>
        withAgentFallback(registry, agentMgr, agentId, "k8s.restartPod", { namespace, pod },
          (client) => client["k8s.restartPod"]({ namespace, pod }).pipe(Effect.asVoid),
        ),

      "k8s.describe": ({ agentId, resource, name, namespace }) =>
        withAgentFallback(registry, agentMgr, agentId, "k8s.describe", { resource, name, namespace },
          (client) => client["k8s.describe"]({ resource, name, namespace }),
        ),

      // ── Terminal — wired through AgentRpcRegistry ─────────────────────────

      "terminal.open": ({ agentId, mode, cols, rows, podName, namespace, container }) =>
        Effect.gen(function* () {
          const client = yield* getAgentClient(registry, agentId)
          const outputStream: Stream.Stream<TerminalOutput, ManagementError | RpcClientError> =
            client["terminal.open"]({ mode, cols, rows, podName, namespace, container })

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
          const logStream: Stream.Stream<LogBatch, ManagementError | RpcClientError> =
            client["logs.tail"]({ source, target, namespace, container, tail })
          return yield* streamThroughAgent(logStream)
        }),
    })
  }),
)
