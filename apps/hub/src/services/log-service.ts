import { Effect, Layer, Ref } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import { AgentManager } from "./agent-manager.js"
import { AgentNotConnected } from "../lib/errors.js"
import type { RpcEvent } from "@scout/shared"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StreamEntry {
  readonly agentId: string
  readonly clientId: string
}

export interface StartStreamParams {
  clientId: string
  agentId: string
  source: "k8s" | "systemd"
  target: string
  namespace?: string
  container?: string
  tail: number
}

// ── Service ───────────────────────────────────────────────────────────────────

export class LogService extends ServiceMap.Service<LogService, {
  /**
   * Start a log stream. Sends logs.start RPC to agent.
   * Returns streamId.
   */
  readonly startStream: (params: StartStreamParams) => Effect.Effect<string, AgentNotConnected>
  /**
   * Stop a log stream. Sends logs.stop RPC to agent, removes tracking.
   */
  readonly stopStream: (streamId: string) => Effect.Effect<void>
  /**
   * Route a logs.data event arriving from an agent to the correct client writer.
   * The writer function sends the event payload to the client.
   */
  readonly routeLogEvent: (
    streamId: string,
    event: RpcEvent,
    sendToClient: (clientId: string, data: string) => Effect.Effect<void>,
  ) => Effect.Effect<void>
  /**
   * Look up the client ID for a stream (used by WS handler).
   */
  readonly getClientId: (streamId: string) => Effect.Effect<string | null>
}>()(
  "@scout/LogService",
  {
    make: Effect.gen(function* () {
      const mgr = yield* AgentManager
      // Track active streams: streamId → { agentId, clientId }
      const streams = yield* Ref.make(new Map<string, StreamEntry>())

      // ── startStream ─────────────────────────────────────────────────────────

      const startStream = (params: StartStreamParams): Effect.Effect<string, AgentNotConnected> =>
        Effect.gen(function* () {
          const streamId = crypto.randomUUID()

          // Verify agent is connected before tracking
          const agent = yield* mgr.getConnected(params.agentId)
          if (!agent) {
            return yield* Effect.fail(new AgentNotConnected({ agentId: params.agentId }))
          }

          // Track the stream
          yield* Ref.update(streams, (m) =>
            new Map(m).set(streamId, {
              agentId: params.agentId,
              clientId: params.clientId,
            })
          )

          // Send logs.start RPC to agent (fire-and-forget, agent responds with events)
          const rpcParams: Record<string, unknown> = {
            streamId,
            source: params.source,
            target: params.target,
            tail: params.tail,
          }
          if (params.namespace) rpcParams["namespace"] = params.namespace
          if (params.container) rpcParams["container"] = params.container

          yield* mgr.sendToAgent(params.agentId, {
            id: crypto.randomUUID(),
            method: "logs.start",
            params: rpcParams,
          }).pipe(
            Effect.tapError(() =>
              // Clean up tracking on send failure
              Ref.update(streams, (m) => {
                const next = new Map(m)
                next.delete(streamId)
                return next
              })
            )
          )

          return streamId
        })

      // ── stopStream ──────────────────────────────────────────────────────────

      const stopStream = (streamId: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const entry = yield* Ref.get(streams).pipe(
            Effect.map((m) => m.get(streamId) ?? null)
          )
          if (!entry) return

          // Remove from tracking
          yield* Ref.update(streams, (m) => {
            const next = new Map(m)
            next.delete(streamId)
            return next
          })

          // Tell agent to stop
          yield* mgr.sendToAgent(entry.agentId, {
            id: crypto.randomUUID(),
            method: "logs.stop",
            params: { streamId },
          }).pipe(Effect.ignore)
        })

      // ── routeLogEvent ────────────────────────────────────────────────────────

      const routeLogEvent = (
        streamId: string,
        event: RpcEvent,
        sendToClient: (clientId: string, data: string) => Effect.Effect<void>,
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          const entry = yield* Ref.get(streams).pipe(
            Effect.map((m) => m.get(streamId) ?? null)
          )
          if (!entry) return
          yield* sendToClient(entry.clientId, JSON.stringify(event)).pipe(Effect.ignore)
        })

      // ── getClientId ──────────────────────────────────────────────────────────

      const getClientId = (streamId: string): Effect.Effect<string | null> =>
        Ref.get(streams).pipe(
          Effect.map((m) => m.get(streamId)?.clientId ?? null)
        )

      return { startStream, stopStream, routeLogEvent, getClientId }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
