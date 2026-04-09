/**
 * ClientHubRpcs handler implementations.
 *
 * Cleanup pass:
 *   - Generic management mutations now call the typed HubAgentRpcs client directly via AgentRegistry.getClient. No
 *     fallback to old AgentManager.call() — if an agent isn't connected,
 *     the mutation fails with ManagementError({code: "not-connected"}).
 *   - terminal.open, terminal.input/resize/close all wire
 *     through the per-agent HubAgentClient the same way.
 *   - alertRules.update and systems.remove are new RPCs added in the
 *     cleanup pass to replace REST server functions for the settings page.
 */

import { Effect, PubSub, Queue, Ref, Stream } from "effect"
import type { Scope } from "effect/Scope"
import { eq } from "drizzle-orm"
import type { Alert, LogBatch, System, SystemMetricsSample, TerminalOutput } from "@scout/shared"
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
import { OperatorModelRegistry } from "../services/operator-model-registry.js"
import { OperatorRuntime } from "../services/operator-runtime.js"
import { OperatorSessionManager } from "../services/operator-session-manager.js"
import { OperatorSessions } from "../services/operator-sessions.js"
import { OperatorSkills } from "../services/operator-skills.js"
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
    }) ?? {
      system: false,
      network: false,
      process: false,
      temperature: false,
      gpu: false,
      smart: false,
    },
    pluginCapabilities: (row.pluginCapabilities as System["pluginCapabilities"]) ?? [],
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
    const operatorModelRegistry = yield* OperatorModelRegistry
    const operatorRuntime = yield* OperatorRuntime
    const operatorSessionManager = yield* OperatorSessionManager
    const operatorSessions = yield* OperatorSessions
    const operatorSkills = yield* OperatorSkills
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

      "operator.sessions.list": () => operatorSessionManager.list(),

      "operator.sessions.get": ({ sessionId }) => operatorSessionManager.get(sessionId),

      "operator.skills.list": () => operatorSkills.list(),

      "operator.models.list": () => operatorModelRegistry.list(),

      "operator.sessions.branch": ({ sessionId, entryId }) =>
        operatorSessionManager.branch(sessionId, entryId),

      "operator.sessions.fork": ({ sessionId, entryId, title }) =>
        operatorSessionManager.fork(sessionId, entryId, title),

      "systems.metrics": ({ id, range }) => {
        const hours = rangeToHours(range)
        return mi.querySystemMetrics(id, hours).pipe(
          Effect.map((rows) =>
            rows.map((r) => r.data as unknown as SystemMetricsSample),
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

      "plugins.runAction": ({ agentId, pluginId, actionId, entity, input }) =>
        withAgent(registry, agentId, (client) =>
          client["plugins.runAction"]({
            pluginId,
            actionId,
            ...(entity !== undefined && { entity }),
            ...(input !== undefined && { input }),
          }),
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

      "operator.sessions.create": ({ title, selectedNodeIds, attachedSkillIds }) =>
        Effect.gen(function* () {
          let resolvedNodeIds = selectedNodeIds ?? []
          if (resolvedNodeIds.length === 0) {
            const connected = yield* registry.listConnected()
            resolvedNodeIds = connected.map((a) => a.agentId)
          }
          return yield* operatorSessionManager.create({
            title,
            selectedNodeIds: resolvedNodeIds,
            attachedSkillIds,
          })
        }),

      "operator.sessions.setTitle": ({ sessionId, title }) =>
        operatorSessions.setTitle(sessionId, title.trim()),

      "operator.sessions.setSkills": ({ sessionId, skillIds }) =>
        operatorSessionManager.setSkills(sessionId, skillIds),

      "operator.sessions.archive": ({ sessionId }) =>
        operatorSessions.archive(sessionId),

      "operator.sessions.delete": ({ sessionId }) =>
        operatorSessions.delete(sessionId),

      "operator.prompt": ({ sessionId, text }) =>
        operatorSessionManager.get(sessionId).pipe(
          Effect.flatMap((session) =>
            session === null
              ? Effect.fail(
                  new ManagementError({
                    code: "session-not-found",
                    message: `Operator session ${sessionId} not found`,
                  }),
                )
              : operatorSessions.appendEvent({
                  id: crypto.randomUUID(),
                  sessionId,
                  at: Date.now(),
                  type: "message.created",
                  message: {
                    id: crypto.randomUUID(),
                    sessionId,
                    role: "user",
                    content: text,
                    createdAt: Date.now(),
                  },
                }).pipe(
                  Effect.flatMap(() => operatorRuntime.prompt(sessionId)),
                  Effect.asVoid,
                ),
          ),
        ),

      "operator.approvals.resolve": ({ sessionId, approvalId, decision }) =>
        operatorSessionManager.get(sessionId).pipe(
          Effect.flatMap((session) =>
            session === null
              ? Effect.fail(
                  new ManagementError({
                    code: "session-not-found",
                    message: `Operator session ${sessionId} not found`,
                  }),
                )
              : (() => {
                  const approval = [...session.approvals]
                    .reverse()
                    .find((pendingApproval) => pendingApproval.id === approvalId)

                  if (!approval) {
                    return Effect.fail(
                      new ManagementError({
                        code: "approval-not-found",
                        message: `Approval ${approvalId} not found`,
                      }),
                    )
                  }

                  return operatorSessions.appendEvent({
                    id: crypto.randomUUID(),
                    sessionId,
                    at: Date.now(),
                    type: "approval.resolved",
                    approval: {
                      ...approval,
                      status: decision,
                      resolvedAt: Date.now(),
                    },
                  }).pipe(
                    Effect.flatMap(() => {
                      if (decision !== "approved") return Effect.void

                      // For clarification approvals, inject the user's answer as context
                      const isClarification = approval.kind === "clarification"
                      const messageContent = isClarification
                        ? `User responded to "${approval.reason}": ${decision}`
                        : `Approval granted for "${approval.reason}". Continue with the approved action if it is still necessary.`

                      return operatorSessions.appendEvent({
                        id: crypto.randomUUID(),
                        sessionId,
                        at: Date.now(),
                        type: "message.created",
                        message: {
                          id: crypto.randomUUID(),
                          sessionId,
                          role: "user",
                          content: messageContent,
                          createdAt: Date.now(),
                        },
                      }).pipe(
                        Effect.flatMap(() => operatorRuntime.prompt(sessionId)),
                      )
                    }),
                    Effect.asVoid,
                  )
                })()
          ),
        ),

      "operator.sessions.setApprovalMode": ({ sessionId, approvalMode }) =>
        operatorSessions.setApprovalMode(sessionId, approvalMode),

      "operator.sessions.setPlanMode": ({ sessionId, planMode }) =>
        operatorSessions.setPlanMode(sessionId, planMode),

      // ── Terminal — wired through AgentRpcRegistry ─────────────────────────

      "terminal.open": ({ agentId, mode, cols, rows }) =>
        Effect.gen(function* () {
          const client = yield* getAgentClient(registry, agentId)
          const outputStream: Stream.Stream<TerminalOutput, ManagementError | RpcClientError> =
            client["terminal.open"]({
              mode,
              cols,
              rows,
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
        subscribeToBroadcast<SystemMetricsSample>(
          broadcast,
          "metrics.data",
          (event) => (event.data as SystemMetricsSample[] | undefined) ?? [],
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

      "operator.events.subscribe": ({ sessionId, afterSeq }) =>
        operatorSessions.subscribe(sessionId, afterSeq),

      "plugins.logs": ({ agentId, pluginId, streamId, entity, input }) =>
        Effect.gen(function* () {
          const client = yield* getAgentClient(registry, agentId)
          const logStream: Stream.Stream<LogBatch, ManagementError | RpcClientError> =
            client["plugins.logs"]({
              pluginId,
              streamId,
              ...(entity !== undefined && { entity }),
              ...(input !== undefined && { input }),
            })
          return yield* streamThroughAgent(logStream)
        }),
    })
  }),
)
