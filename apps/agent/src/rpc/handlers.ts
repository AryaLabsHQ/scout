/**
 * HubAgentRpcs handler implementations.
 *
 * Implements the remaining generic management, logs, and terminal methods the
 * hub can call on the agent. The surrounding shape is HubAgentRpcs.toLayer.
 */

import { Effect, Queue, Ref, Stream } from "effect"
import os from "node:os"
import { HubAgentRpcs, ManagementError } from "@scout/shared"
import type { TerminalOutput, LogBatch, TerminalMode } from "@scout/shared"
import { AgentPluginHost } from "../services/plugin-host.js"

// ── Terminal helpers ───────────────────────────────────────────────────────────

interface TerminalHandle {
  readonly proc: ReturnType<typeof Bun.spawn>
  readonly queue: Queue.Queue<TerminalOutput>
}

function spawnTerminalProcess(params: {
  sessionId: string
  mode: TerminalMode
  cols: number
  rows: number
}): Effect.Effect<ReturnType<typeof Bun.spawn>> {
  return Effect.sync(() => {
    const { cols, rows } = params
    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([, v]) => v !== undefined,
        ) as [string, string][],
      ),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      COLUMNS: String(cols),
      LINES: String(rows),
    }

    const shell = process.env["SHELL"] ?? "/bin/bash"
    if (process.platform === "linux") {
      return Bun.spawn(["script", "-qc", shell, "/dev/null"], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env,
      })
    }
    return Bun.spawn([shell], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env,
    })
  })
}

function pumpStreamToQueue(
  stream: ReadableStream<Uint8Array>,
  queue: Queue.Queue<TerminalOutput>,
): Effect.Effect<void> {
  return Effect.tryPromise(async () => {
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && value.length > 0) {
        const b64 = Buffer.from(value).toString("base64")
        await Effect.runPromise(
          Queue.offer(queue, { _tag: "output", dataBase64: b64 }),
        )
      }
    }
  }).pipe(Effect.ignore)
}

// ── ManagementError factory ───────────────────────────────────────────────────

const fail = (code: string, message: string) =>
  Effect.fail(new ManagementError({ code, message }))

const mapPluginHostError = (error: Error) =>
  new ManagementError({
    code: error.message === "invalid-input" ? "invalid-input" : "plugin-error",
    message:
      error.message === "plugin-not-loaded"
        ? "Requested plugin is not loaded"
        : error.message,
  })

// ── Handler layer ─────────────────────────────────────────────────────────────

export const HubAgentHandlersLive = HubAgentRpcs.toLayer(
  Effect.gen(function* () {
    const terminals = yield* Ref.make(new Map<string, TerminalHandle>())
    const pluginHost = yield* AgentPluginHost

    return HubAgentRpcs.of({
      // ── Generic plugin control ────────────────────────────────────────────

      "plugins.runAction": ({ pluginId, actionId, entity, input }) =>
        pluginHost.runAction({
          pluginId,
          actionId,
          target: {
            nodeId: process.env["SCOUT_HOSTNAME"] ?? os.hostname(),
            ...(entity !== undefined && {
              entity: {
                pluginId: entity.pluginId,
                kind: entity.kind,
                nodeId: process.env["SCOUT_HOSTNAME"] ?? os.hostname(),
                id: entity.id,
              },
            }),
          },
          ...(input !== undefined && { input }),
        }).pipe(
          Effect.map((output) => ({ success: true, output })),
          Effect.mapError(mapPluginHostError),
        ),

      // ── Terminal ───────────────────────────────────────────────────────────

      "terminal.open": ({ mode, cols, rows }) =>
        Effect.gen(function* () {
          const sessionId = crypto.randomUUID()
          const queue = yield* Queue.unbounded<TerminalOutput>()

          const proc = yield* spawnTerminalProcess({
            sessionId,
            mode,
            cols,
            rows,
          }).pipe(
            Effect.mapError(
              (e) =>
                new ManagementError({
                  code: "spawn-error",
                  message: String(e),
                }),
            ),
          )

          // Announce sessionId as the first queue item
          yield* Queue.offer(queue, { _tag: "session-start", sessionId })

          // Register this terminal so input/resize/close can find it
          yield* Ref.update(
            terminals,
            (m) => new Map(m).set(sessionId, { proc, queue }),
          )

          // Pump stdout → queue; fork so it runs concurrently
          yield* Effect.forkScoped(
            pumpStreamToQueue(proc.stdout as ReadableStream<Uint8Array>, queue),
          )
          // Pump stderr → queue
          yield* Effect.forkScoped(
            pumpStreamToQueue(proc.stderr as ReadableStream<Uint8Array>, queue),
          )

          // Cleanup when scope closes
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              try {
                proc.kill()
              } catch {
                /* ignore */
              }
            }).pipe(
              Effect.flatMap(() =>
                Ref.update(terminals, (m) => {
                  const next = new Map(m)
                  next.delete(sessionId)
                  return next
                }),
              ),
            ),
          )

          return queue
        }),

      "terminal.input": ({ sessionId, dataBase64 }) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(terminals)
          const term = map.get(sessionId)
          if (!term)
            return yield* fail("session-not-found", `No terminal session ${sessionId}`)

          yield* Effect.tryPromise(async () => {
            const bytes = Buffer.from(dataBase64, "base64")
            const stdin = term.proc.stdin as { write(data: Uint8Array): number }
            stdin.write(bytes)
          }).pipe(Effect.ignore)
        }),

      "terminal.resize": ({ sessionId, cols, rows }) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(terminals)
          if (!map.has(sessionId))
            return yield* fail("session-not-found", `No terminal session ${sessionId}`)

          // Best-effort resize; real PTY would SIGWINCH
          yield* Effect.logDebug(`terminal.resize: ${sessionId} → ${cols}x${rows}`)
        }),

      "terminal.close": ({ sessionId }) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(terminals)
          const term = map.get(sessionId)
          if (!term)
            return yield* fail("session-not-found", `No terminal session ${sessionId}`)

          yield* Effect.sync(() => {
            try {
              term.proc.kill()
            } catch {
              /* ignore */
            }
          })
          yield* Ref.update(terminals, (m) => {
            const next = new Map(m)
            next.delete(sessionId)
            return next
          })
        }),

      "plugins.logs": ({ pluginId, streamId, entity, input }) =>
        Effect.gen(function* () {
          const queue = yield* Queue.unbounded<LogBatch>()
          const stream = yield* pluginHost.openLogStream({
            pluginId,
            streamId,
            target: {
              nodeId: process.env["SCOUT_HOSTNAME"] ?? os.hostname(),
              ...(entity !== undefined && {
                entity: {
                  pluginId: entity.pluginId,
                  kind: entity.kind,
                  nodeId: process.env["SCOUT_HOSTNAME"] ?? os.hostname(),
                  id: entity.id,
                },
              }),
            },
            ...(input !== undefined && { input }),
          }).pipe(
            Effect.mapError(mapPluginHostError),
          )

          yield* Effect.forkScoped(
            Stream.runForEach(stream, (chunk) =>
              Queue.offer(queue, { lines: [...chunk.lines], timestamp: chunk.ts }),
            ).pipe(Effect.ignore),
          )

          return queue
        }),
    })
  }),
)
