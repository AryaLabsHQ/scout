import { Effect, Layer, Ref } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import { AgentManager } from "./agent-manager.js"
import { AgentNotConnected } from "../lib/errors.js"
import type { SocketError } from "effect/unstable/socket/Socket"
import type { TerminalMode, TerminalSession } from "@scout/shared"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SessionEntry {
  readonly agentId: string
  readonly clientId: string
  readonly mode: TerminalMode
  readonly cols: number
  readonly rows: number
  readonly podName: string | null
  readonly namespace: string | null
  readonly createdAt: number
}

export interface CreateSessionParams {
  agentId: string
  clientId: string
  mode: TerminalMode
  cols: number
  rows: number
  podName?: string
  namespace?: string
}

// ── Service ───────────────────────────────────────────────────────────────────

export class TerminalService extends ServiceMap.Service<TerminalService, {
  /**
   * Create a new terminal session. Sends terminal.open RPC to the agent.
   * Returns the TerminalSession descriptor.
   */
  readonly createSession: (params: CreateSessionParams) => Effect.Effect<TerminalSession, AgentNotConnected | SocketError>
  /**
   * Close a terminal session. Sends terminal.close RPC to the agent, removes from tracking.
   */
  readonly closeSession: (sessionId: string) => Effect.Effect<void>
  /**
   * Send user input to the terminal session (base64 encoded).
   * Sends terminal.input RPC to the agent.
   */
  readonly sendInput: (sessionId: string, dataBase64: string) => Effect.Effect<void>
  /**
   * Resize a terminal session.
   * Sends terminal.resize RPC to the agent.
   */
  readonly resize: (sessionId: string, cols: number, rows: number) => Effect.Effect<void>
  /**
   * Route terminal output arriving from the agent to the correct client.
   * The writer function sends the event payload to the client.
   */
  readonly routeOutput: (
    sessionId: string,
    dataBase64: string,
    sendToClient: (clientId: string, data: string) => Effect.Effect<void>,
  ) => Effect.Effect<void>
  /**
   * Look up the client ID for a session (used by WS handler).
   */
  readonly getClientId: (sessionId: string) => Effect.Effect<string | null>
}>()(
  "@scout/TerminalService",
  {
    make: Effect.gen(function* () {
      const mgr = yield* AgentManager
      // Track active sessions: sessionId → SessionEntry
      const sessions = yield* Ref.make(new Map<string, SessionEntry>())

      // ── createSession ────────────────────────────────────────────────────────

      const createSession = (params: CreateSessionParams): Effect.Effect<TerminalSession, AgentNotConnected | SocketError> =>
        Effect.gen(function* () {
          const sessionId = crypto.randomUUID()
          const now = Date.now()

          // Build RPC params
          const rpcParams: Record<string, unknown> = {
            sessionId,
            mode: params.mode,
            cols: params.cols,
            rows: params.rows,
          }
          if (params.podName) rpcParams["podName"] = params.podName
          if (params.namespace) rpcParams["namespace"] = params.namespace

          // Tell the agent to open a PTY
          yield* mgr.sendToAgent(params.agentId, {
            id: crypto.randomUUID(),
            method: "terminal.open",
            params: rpcParams,
          })

          // Track the session after successfully sending
          yield* Ref.update(sessions, (m) =>
            new Map(m).set(sessionId, {
              agentId: params.agentId,
              clientId: params.clientId,
              mode: params.mode,
              cols: params.cols,
              rows: params.rows,
              podName: params.podName ?? null,
              namespace: params.namespace ?? null,
              createdAt: now,
            })
          )

          const session: TerminalSession = {
            id: sessionId,
            agentId: params.agentId,
            mode: params.mode,
            podName: params.podName ?? null,
            namespace: params.namespace ?? null,
            cols: params.cols,
            rows: params.rows,
            createdAt: now,
          }

          return session
        })

      // ── closeSession ─────────────────────────────────────────────────────────

      const closeSession = (sessionId: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const entry = yield* Ref.get(sessions).pipe(
            Effect.map((m) => m.get(sessionId) ?? null)
          )
          if (!entry) return

          // Remove from tracking first
          yield* Ref.update(sessions, (m) => {
            const next = new Map(m)
            next.delete(sessionId)
            return next
          })

          // Tell the agent to tear down the PTY (best-effort)
          yield* mgr.sendToAgent(entry.agentId, {
            id: crypto.randomUUID(),
            method: "terminal.close",
            params: { sessionId },
          }).pipe(Effect.ignore)
        })

      // ── sendInput ────────────────────────────────────────────────────────────

      const sendInput = (sessionId: string, dataBase64: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const entry = yield* Ref.get(sessions).pipe(
            Effect.map((m) => m.get(sessionId) ?? null)
          )
          if (!entry) return

          yield* mgr.sendToAgent(entry.agentId, {
            id: crypto.randomUUID(),
            method: "terminal.input",
            params: { sessionId, dataBase64 },
          }).pipe(Effect.ignore)
        })

      // ── resize ───────────────────────────────────────────────────────────────

      const resize = (sessionId: string, cols: number, rows: number): Effect.Effect<void> =>
        Effect.gen(function* () {
          const entry = yield* Ref.get(sessions).pipe(
            Effect.map((m) => m.get(sessionId) ?? null)
          )
          if (!entry) return

          // Update tracked dimensions
          yield* Ref.update(sessions, (m) => {
            const existing = m.get(sessionId)
            if (!existing) return m
            return new Map(m).set(sessionId, { ...existing, cols, rows })
          })

          yield* mgr.sendToAgent(entry.agentId, {
            id: crypto.randomUUID(),
            method: "terminal.resize",
            params: { sessionId, cols, rows },
          }).pipe(Effect.ignore)
        })

      // ── routeOutput ──────────────────────────────────────────────────────────

      const routeOutput = (
        sessionId: string,
        dataBase64: string,
        sendToClient: (clientId: string, data: string) => Effect.Effect<void>,
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          const entry = yield* Ref.get(sessions).pipe(
            Effect.map((m) => m.get(sessionId) ?? null)
          )
          if (!entry) return

          const event = JSON.stringify({
            event: "terminal.output",
            streamId: sessionId,
            dataBase64,
          })
          yield* sendToClient(entry.clientId, event).pipe(Effect.ignore)
        })

      // ── getClientId ──────────────────────────────────────────────────────────

      const getClientId = (sessionId: string): Effect.Effect<string | null> =>
        Ref.get(sessions).pipe(
          Effect.map((m) => m.get(sessionId)?.clientId ?? null)
        )

      return { createSession, closeSession, sendInput, resize, routeOutput, getClientId }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
