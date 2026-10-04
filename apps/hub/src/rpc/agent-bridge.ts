/**
 * Agent RPC bridge — the /ws/rpc/agent endpoint, AgentRegistry, and
 * the agent.connect handler.
 *
 * On each WS upgrade:
 *   1. Wrap the socket with makeDuplexRpcProtocols
 *   2. Build an RpcClient<HubAgentRpcs> for hub-initiated commands
 *   3. Run an RpcServer<AgentHubRpcs> so agents can call agent.connect
 *      and agent.report
 *   4. When agent.connect succeeds, store the ConnectedAgent entry in
 *      AgentRegistry (DB upsert, "online" status, capabilities persist)
 *      along with the typed HubAgentClient
 *   5. On disconnect, unregister with a 5-second grace period
 *
 * AgentRegistry is the single source of truth for connected agents,
 * owning both lifecycle (DB state) and typed client storage.
 */

import { Effect, Fiber, Layer, Ref } from "effect"
import * as Context from "effect/Context"
import { eq } from "drizzle-orm"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcServer from "effect/rpc/RpcServer"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import type { RpcClientError } from "effect/rpc/RpcClientError"
import {
  AgentConnectError,
  AgentHubRpcs,
  HubAgentRpcs,
  makeDuplexRpcProtocols,
} from "@scout/shared"
import type { AgentCapabilities, AgentInfo, System } from "@scout/shared"
import type { PluginCapability } from "@scout/plugin-sdk"
import { HubConfig } from "../config.js"
import { agentTokenEquals } from "../auth/http-gate.js"
import { Database } from "../services/database.js"
import * as schema from "../../drizzle/schema.js"
import { AgentHandlersLive } from "./agent-handlers.js"

// ── RPC client type alias ─────────────────────────────────────────────────────

export type HubAgentClient = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof HubAgentRpcs>,
  RpcClientError
>

// ── Public connected-agent summary ────────────────────────────────────────────

export interface ConnectedAgent {
  readonly agentId: string
  readonly info: AgentInfo
  readonly connectedAt: number
}

// ── Internal per-connection entry ─────────────────────────────────────────────

interface AgentEntry {
  readonly agentId: string
  readonly info: AgentInfo
  readonly connectedAt: number
  readonly client: HubAgentClient
}

// ── AgentRegistry service ──────────────────────────────────────────────────────

/**
 * Single source of truth for connected agents. Owns DB lifecycle (online/
 * offline status, capabilities persistence, 5-second grace period on
 * disconnect) AND the typed RPC client used by hub-initiated management
 * calls.
 */
export class AgentRegistry extends Context.Service<
  AgentRegistry,
  {
    /**
     * Register a freshly connected agent. Upserts the `systems` row,
     * persists capabilities, marks status = "online", stores the typed
     * RPC client, and interrupts any in-flight grace fiber if this agent
     * is reconnecting quickly. Returns the canonical System record.
     */
    readonly register: (
      info: AgentInfo,
      capabilities: AgentCapabilities,
      pluginCapabilities: ReadonlyArray<PluginCapability>,
      client: HubAgentClient,
    ) => Effect.Effect<System>

    /**
     * Mark an agent connection as disconnected. Removes it from in-memory
     * state and forks a 5-second grace fiber; if no re-register arrives by
     * then, the `systems` row is marked "offline". No-op when `client` is
     * not the agent's current connection (it already reconnected).
     */
    readonly unregister: (agentId: string, client: HubAgentClient) => Effect.Effect<void>

    /** List all currently connected agents. */
    readonly listConnected: () => Effect.Effect<ReadonlyArray<ConnectedAgent>>

    /** Look up a single connected agent by id, or null. */
    readonly getConnected: (agentId: string) => Effect.Effect<ConnectedAgent | null>

    /** Look up the typed RPC client for a connected agent, or null. */
    readonly getClient: (agentId: string) => Effect.Effect<HubAgentClient | null>
  }
>()(
  "@scout/AgentRegistry",
  {
    make: Effect.gen(function* () {
      const db = yield* Database
      // Grace fibers outlive the connection fiber that calls `unregister`, so
      // they run in the registry's own scope rather than as its children.
      const registryScope = yield* Effect.scope
      const entries = yield* Ref.make(new Map<string, AgentEntry>())
      const graceFibers = yield* Ref.make(new Map<string, Fiber.Fiber<void, never>>())

      const register = (
        info: AgentInfo,
        capabilities: AgentCapabilities,
        pluginCapabilities: ReadonlyArray<PluginCapability>,
        client: HubAgentClient,
      ): Effect.Effect<System> =>
        Effect.gen(function* () {
          // Interrupt any pending grace fiber for this agent (fast reconnect)
          const pending = yield* Ref.modify(graceFibers, (m) => {
            const fiber = m.get(info.systemId) ?? null
            const next = new Map(m)
            next.delete(info.systemId)
            return [fiber, next] as const
          })
          if (pending !== null) {
            yield* Fiber.interrupt(pending).pipe(Effect.asVoid)
          }

          const now = Date.now()
          const entry: AgentEntry = {
            agentId: info.systemId,
            info,
            connectedAt: now,
            client,
          }
          yield* Ref.update(entries, (m) => new Map(m).set(info.systemId, entry))

          // DB upsert: mark online, persist capabilities, update lastSeen
          const system = yield* Effect.sync(() => {
            const nowDate = new Date(now)
            db.insert(schema.systems)
              .values({
                id: info.systemId,
                hostname: info.hostname,
                status: "online",
                capabilities: capabilities as unknown,
                pluginCapabilities: pluginCapabilities as unknown,
                lastSeen: nowDate,
                createdAt: nowDate,
              })
              .onConflictDoUpdate({
                target: schema.systems.id,
                set: {
                  hostname: info.hostname,
                  status: "online",
                  capabilities: capabilities as unknown,
                  pluginCapabilities: pluginCapabilities as unknown,
                  lastSeen: nowDate,
                },
              })
              .run()

            const rows = db
              .select()
              .from(schema.systems)
              .where(eq(schema.systems.id, info.systemId))
              .all()
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
              },
              pluginCapabilities:
                (row.pluginCapabilities as System["pluginCapabilities"]) ?? [],
              lastSeen: row.lastSeen?.getTime() ?? now,
              createdAt: row.createdAt.getTime(),
            } satisfies System
          })

          return system
        })

      const unregister = (agentId: string, client: HubAgentClient): Effect.Effect<void> =>
        Effect.gen(function* () {
          // Pop the entry first so listConnected immediately reflects the
          // disconnect. The grace fiber will mark the DB row offline if the
          // agent doesn't reconnect within 5 s. A superseded connection
          // closing after its replacement registered leaves the entry alone.
          const existed = yield* Ref.modify(entries, (m) => {
            if (m.get(agentId)?.client !== client) return [false, m] as const
            const next = new Map(m)
            next.delete(agentId)
            return [true, next] as const
          })

          if (!existed) return

          const graceFiber = yield* Effect.forkIn(
            Effect.gen(function* () {
              yield* Effect.sleep("5 seconds")
              const stillGone = yield* Ref.get(entries).pipe(
                Effect.map((m) => !m.has(agentId)),
              )
              if (stillGone) {
                yield* Effect.sync(() => {
                  db.update(schema.systems)
                    .set({ status: "offline" })
                    .where(eq(schema.systems.id, agentId))
                    .run()
                })
              }
              yield* Ref.update(graceFibers, (m) => {
                const next = new Map(m)
                next.delete(agentId)
                return next
              })
            }),
            registryScope,
          )

          yield* Ref.update(graceFibers, (m) =>
            new Map(m).set(agentId, graceFiber),
          )
        })

      const listConnected = (): Effect.Effect<ReadonlyArray<ConnectedAgent>> =>
        Ref.get(entries).pipe(
          Effect.map((m) =>
            Array.from(m.values()).map(
              (e): ConnectedAgent => ({
                agentId: e.agentId,
                info: e.info,
                connectedAt: e.connectedAt,
              }),
            ),
          ),
        )

      const getConnected = (agentId: string): Effect.Effect<ConnectedAgent | null> =>
        Ref.get(entries).pipe(
          Effect.map((m) => {
            const e = m.get(agentId)
            return e
              ? {
                  agentId: e.agentId,
                  info: e.info,
                  connectedAt: e.connectedAt,
                }
              : null
          }),
        )

      const getClient = (agentId: string): Effect.Effect<HubAgentClient | null> =>
        Ref.get(entries).pipe(Effect.map((m) => m.get(agentId)?.client ?? null))

      return {
        register,
        unregister,
        listConnected,
        getConnected,
        getClient,
      }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}

// ── Per-connection RegisterAgent service ──────────────────────────────────────

/**
 * Per-connection callback injected into the `agent.connect` handler so
 * the bridge can record the new agent in AgentRegistry. Takes the
 * decoded info + capabilities from the RPC payload; the bridge closure
 * has already captured the typed HubAgentClient for this socket.
 */
export class RegisterAgent extends Context.Service<
  RegisterAgent,
  (
    info: AgentInfo,
    capabilities: AgentCapabilities,
    pluginCapabilities: ReadonlyArray<PluginCapability>,
  ) => Effect.Effect<{ readonly systemId: string }>
>()("@scout/RegisterAgent") {}

// ── agent.connect handler override ────────────────────────────────────────────

/**
 * Validates the SCOUT_TOKEN carried in the payload (the upgrade request was
 * already checked by `HttpAuthGate`) and delegates to the per-connection
 * `RegisterAgent` callback.
 *
 * IMPORTANT: This layer MUST be provided with `Layer.fresh(...)` at the
 * call site. `toLayerHandler` captures the services snapshot at layer
 * build time, and `Layer.MemoMap` caches by layer identity. Without
 * `Layer.fresh`, the first connection's `RegisterAgent` closure (which
 * captures the first agent's `hubAgentClient`) would be frozen into the
 * handler for all subsequent connections — routing every agent-bound
 * RPC to whichever agent connected first.
 */
const AgentConnectHandlerLive = AgentHubRpcs.toLayerHandler(
  "agent.connect",
  Effect.gen(function* () {
    const registerFn = yield* RegisterAgent
    const { agentToken } = yield* HubConfig

    return ({ token, hostname, version, platform, capabilities, pluginCapabilities }) =>
      Effect.gen(function* () {
        if (!agentTokenEquals(token, agentToken)) {
          return yield* Effect.fail(
            new AgentConnectError({
              reason: "invalid-token",
              message: "Invalid SCOUT_TOKEN",
            }),
          )
        }

        const info: AgentInfo = {
          systemId: hostname,
          hostname,
          version,
          platform,
        }

        yield* Effect.logInfo("agent.connect: accepted", { hostname })
        return yield* registerFn(info, capabilities, pluginCapabilities ?? [])
      })
  }),
)

// ── WS handler for /ws/rpc/agent ─────────────────────────────────────────────

/**
 * Handle one agent WebSocket connection. Must run with HttpServerRequest
 * and AgentRegistry available in the context.
 */
export const handleAgentRpcWebSocket = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const registry = yield* AgentRegistry

  const socket = yield* Effect.orDie(request.upgrade)

  // Per-connection slot — set by the agent.connect handler below
  const registeredRef = yield* Ref.make<{
    readonly agentId: string
    readonly client: HubAgentClient
  } | null>(null)

  yield* Effect.scoped(
    Effect.gen(function* () {
      const { serverProtocol, clientProtocol, closed } =
        yield* makeDuplexRpcProtocols(socket)

      // Build the hub→agent typed RPC client on this socket
      const hubAgentClient = yield* RpcClient.make(HubAgentRpcs).pipe(
        Effect.provide(clientProtocol),
      )

      // Per-connection RegisterAgent closure: captures hubAgentClient so
      // agent.connect's handler can register it in one shot.
      const registerAgentFn = (
        info: AgentInfo,
        capabilities: AgentCapabilities,
        pluginCapabilities: ReadonlyArray<PluginCapability>,
      ): Effect.Effect<{ readonly systemId: string }> =>
        Effect.gen(function* () {
          yield* Ref.set(registeredRef, { agentId: info.systemId, client: hubAgentClient })
          yield* registry.register(info, capabilities, pluginCapabilities, hubAgentClient)
          return { systemId: info.systemId }
        })

      const RegisterAgentLive = Layer.succeed(RegisterAgent)(registerAgentFn)

      // Run the agent→hub RpcServer
      // - AgentHandlersLive handles agent.report
      // - Layer.fresh(AgentConnectHandlerLive) forces a rebuild per
      //   connection so the handler captures THIS connection's
      //   RegisterAgent, not the first-ever connection's.
      yield* RpcServer.make(AgentHubRpcs, {
        disableFatalDefects: true,
      }).pipe(
        Effect.provide(AgentHandlersLive),
        Effect.provide(Layer.fresh(AgentConnectHandlerLive)),
        Effect.provide(RegisterAgentLive),
        Effect.provide(serverProtocol),
        // The session ends when the agent's socket closes, which runs the
        // unregister finalizer below.
        Effect.raceFirst(closed),
      )
    }).pipe(
      Effect.provide(RpcSerialization.layerNdjson),
      Effect.ensuring(
        Effect.gen(function* () {
          const registered = yield* Ref.get(registeredRef)
          if (registered !== null) {
            yield* registry.unregister(registered.agentId, registered.client)
            yield* Effect.logInfo("agent unregistered", { agentId: registered.agentId })
          }
        }),
      ),
    ),
  )
})
