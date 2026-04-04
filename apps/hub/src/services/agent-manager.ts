import { Deferred, Effect, Fiber, Layer, Option, Ref, Schedule } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import * as Socket from "effect/unstable/socket/Socket"
import { eq } from "drizzle-orm"
import type { AgentInfo, System } from "@scout/shared"
import type { RpcRequest, RpcResponse } from "@scout/shared"
import { AgentNotConnected, RpcCallError, TimeoutError } from "../lib/errors.js"
import { Database } from "./database.js"
import * as schema from "../../drizzle/schema.js"

// Tracks connected agents (WebSocket sessions), routes inbound RPC responses,
// and exposes a typed RPC call interface to other services.

export interface ConnectedAgent {
  readonly agentId: string
  readonly info: AgentInfo
  readonly connectedAt: number
}

// Internal connection record — not exported
interface AgentConnection {
  readonly agentId: string
  readonly info: AgentInfo
  readonly socket: Socket.Socket
  readonly connectedAt: number
  lastSeen: number
  readonly writer: (data: Uint8Array | string) => Effect.Effect<void, Socket.SocketError>
  // Grace fiber — set when a disconnect is in progress; interrupt to cancel
  graceFiber: Fiber.Fiber<void, never> | null
}

export class AgentManager extends ServiceMap.Service<AgentManager, {
  /**
   * Register a newly connected agent with its socket. Returns the System record.
   * Creates it in the DB on first connection; updates status to "online" on reconnect.
   */
  readonly register: (info: AgentInfo, socket: Socket.Socket) => Effect.Effect<System>
  /**
   * Mark an agent as disconnected. Starts a 5-second grace period;
   * if the agent does not re-register, system is marked "offline" in the DB.
   */
  readonly unregister: (agentId: string) => Effect.Effect<void>
  /**
   * Send an RPC request to a specific agent and await the response.
   * Fails with AgentNotConnected if the agent is not currently connected.
   * Fails with TimeoutError if no response arrives within timeoutMs.
   * Fails with RpcCallError if the agent returns an error response.
   */
  readonly call: (
    agentId: string,
    request: RpcRequest,
    timeoutMs?: number,
  ) => Effect.Effect<RpcResponse, AgentNotConnected | TimeoutError | RpcCallError | Socket.SocketError>
  /**
   * Resolve a pending call deferred with the given response.
   * Called by the WebSocket message handler when an RpcResponse arrives.
   */
  readonly handleResponse: (response: RpcResponse) => Effect.Effect<void>
  /**
   * List all currently connected agents.
   */
  readonly listConnected: () => Effect.Effect<ReadonlyArray<ConnectedAgent>>
  /**
   * Get a specific connected agent by ID, or null if not connected.
   */
  readonly getConnected: (agentId: string) => Effect.Effect<ConnectedAgent | null>
  /**
   * Send a raw message (JSON-serialised) to an agent.
   * Fails with AgentNotConnected if the agent is not currently connected.
   */
  readonly sendToAgent: (
    agentId: string,
    message: unknown,
  ) => Effect.Effect<void, AgentNotConnected | Socket.SocketError>
}>()(
  "@scout/AgentManager",
  {
    make: Effect.gen(function* () {
      // Establish the Database dependency
      const db = yield* Database

      // Active WebSocket connections
      const connections = yield* Ref.make(new Map<string, AgentConnection>())
      // Pending RPC call deferreds, keyed by request ID
      const pending = yield* Ref.make(new Map<string, Deferred.Deferred<RpcResponse, RpcCallError>>())

      // ── helpers ──────────────────────────────────────────────────────────

      const getConnectionOpt = (agentId: string): Effect.Effect<Option.Option<AgentConnection>> =>
        Ref.get(connections).pipe(Effect.map((m) => Option.fromNullishOr(m.get(agentId))))

      const sendRaw = (conn: AgentConnection, message: unknown): Effect.Effect<void, Socket.SocketError> =>
        conn.writer(JSON.stringify(message))

      // ── register ─────────────────────────────────────────────────────────

      const register = (info: AgentInfo, socket: Socket.Socket): Effect.Effect<System> =>
        Effect.gen(function* () {
          const now = Date.now()

          // Acquire writer scoped to the connection's lifetime
          const writer = yield* Effect.scoped(socket.writer)

          const conn: AgentConnection = {
            agentId: info.systemId,
            info,
            socket,
            connectedAt: now,
            lastSeen: now,
            writer,
            graceFiber: null,
          }

          // Cancel any in-flight grace period for this agent, then register
          yield* Ref.modify(connections, (m) => {
            const prev = m.get(info.systemId) ?? null
            const next = new Map(m)
            next.set(info.systemId, conn)
            return [prev, next] as const
          }).pipe(
            Effect.flatMap((prev) => {
              if (prev?.graceFiber) {
                return Fiber.interrupt(prev.graceFiber).pipe(Effect.asVoid)
              }
              return Effect.void
            })
          )

          // Upsert system record in DB: status = "online", update lastSeen
          const system = yield* Effect.sync(() => {
            const nowDate = new Date(now)
            db.insert(schema.systems)
              .values({
                id: info.systemId,
                hostname: info.hostname,
                status: "online",
                lastSeen: nowDate,
                createdAt: nowDate,
              })
              .onConflictDoUpdate({
                target: schema.systems.id,
                set: {
                  hostname: info.hostname,
                  status: "online",
                  lastSeen: nowDate,
                },
              })
              .run()

            const rows = db.select().from(schema.systems).where(eq(schema.systems.id, info.systemId)).all()
            const row = rows[0]!
            return {
              id: row.id,
              hostname: row.hostname,
              tailscaleIp: row.tailscaleIp,
              status: row.status,
              capabilities: (row.capabilities as System["capabilities"]) ?? {
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
              lastSeen: row.lastSeen?.getTime() ?? now,
              createdAt: row.createdAt.getTime(),
            } satisfies System
          })

          return system
        })

      // ── unregister (with 5-second grace period) ──────────────────────────

      const unregister = (agentId: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          // Remove from active connections
          const prev = yield* Ref.modify(connections, (m) => {
            const existing = m.get(agentId) ?? null
            const next = new Map(m)
            next.delete(agentId)
            return [existing, next] as const
          })

          if (prev === null) return

          // Start grace period — if the agent re-registers within 5 s the fiber
          // is interrupted inside register(); otherwise we mark offline.
          const graceFiber = yield* Effect.forkChild(
            Effect.gen(function* () {
              yield* Effect.sleep("5 seconds")
              const stillGone = yield* Ref.get(connections).pipe(Effect.map((m) => !m.has(agentId)))
              if (stillGone) {
                yield* Effect.sync(() => {
                  db.update(schema.systems)
                    .set({ status: "offline" })
                    .where(eq(schema.systems.id, agentId))
                    .run()
                })
              }
            })
          )

          // Stash the grace fiber reference so register() can interrupt it
          prev.graceFiber = graceFiber
        })

      // ── sendToAgent ───────────────────────────────────────────────────────

      const sendToAgent = (
        agentId: string,
        message: unknown,
      ): Effect.Effect<void, AgentNotConnected | Socket.SocketError> =>
        Effect.gen(function* () {
          const opt = yield* getConnectionOpt(agentId)
          if (Option.isNone(opt)) {
            return yield* Effect.fail(new AgentNotConnected({ agentId }))
          }
          yield* sendRaw(opt.value, message)
        })

      // ── call (RPC invoke) ─────────────────────────────────────────────────

      const call = (
        agentId: string,
        request: RpcRequest,
        timeoutMs = 30_000,
      ): Effect.Effect<RpcResponse, AgentNotConnected | TimeoutError | RpcCallError | Socket.SocketError> =>
        Effect.gen(function* () {
          const deferred = yield* Deferred.make<RpcResponse, RpcCallError>()

          // Register pending slot before sending to avoid races
          yield* Ref.update(pending, (m) => new Map(m).set(request.id, deferred))

          // Send; clean up pending if send fails
          yield* sendToAgent(agentId, request).pipe(
            Effect.tapError(() =>
              Ref.update(pending, (m) => {
                const next = new Map(m)
                next.delete(request.id)
                return next
              })
            )
          )

          // Race: await the deferred vs a timeout
          const response = yield* Effect.timeoutOrElse(Deferred.await(deferred), {
            duration: timeoutMs,
            orElse: () =>
              Ref.update(pending, (m) => {
                const next = new Map(m)
                next.delete(request.id)
                return next
              }).pipe(
                Effect.flatMap(() =>
                  Effect.fail(new TimeoutError({ method: request.method, timeoutMs }))
                )
              ),
          })

          return response
        })

      // ── handleResponse ────────────────────────────────────────────────────

      const handleResponse = (response: RpcResponse): Effect.Effect<void> =>
        Effect.gen(function* () {
          const deferred = yield* Ref.get(pending).pipe(Effect.map((m) => m.get(response.id)))
          if (!deferred) return

          yield* Ref.update(pending, (m) => {
            const next = new Map(m)
            next.delete(response.id)
            return next
          })

          if (response.ok) {
            yield* Deferred.succeed(deferred, response)
          } else {
            yield* Deferred.fail(
              deferred,
              new RpcCallError({
                code: response.error?.code ?? "UNKNOWN",
                message: response.error?.message ?? "Unknown RPC error",
              })
            )
          }
        })

      // ── listConnected ─────────────────────────────────────────────────────

      const listConnected = (): Effect.Effect<ReadonlyArray<ConnectedAgent>> =>
        Ref.get(connections).pipe(
          Effect.map((m) =>
            Array.from(m.values()).map((c): ConnectedAgent => ({
              agentId: c.agentId,
              info: c.info,
              connectedAt: c.connectedAt,
            }))
          )
        )

      // ── getConnected ──────────────────────────────────────────────────────

      const getConnected = (agentId: string): Effect.Effect<ConnectedAgent | null> =>
        getConnectionOpt(agentId).pipe(
          Effect.map((opt) =>
            Option.isSome(opt)
              ? { agentId: opt.value.agentId, info: opt.value.info, connectedAt: opt.value.connectedAt }
              : null
          )
        )

      // ── Background: tick keepalive every 30 s ────────────────────────────

      yield* Effect.forkDetach(
        Ref.get(connections).pipe(
          Effect.flatMap((conns) =>
            Effect.forEach(
              conns.values(),
              (conn) => sendRaw(conn, { event: "tick" }).pipe(Effect.ignore),
              { concurrency: "unbounded" }
            )
          )
        ).pipe(Effect.repeat(Schedule.spaced("30 seconds")))
      )

      return {
        register,
        unregister,
        call,
        handleResponse,
        listConnected,
        getConnected,
        sendToAgent,
      }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
