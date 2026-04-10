/**
 * HubAgentRpcs handler implementations.
 *
 * Implements the remaining generic management, logs, and terminal methods the
 * hub can call on the agent. The surrounding shape is HubAgentRpcs.toLayer.
 */

import { Cause, Effect, Queue, Ref, Stream } from "effect"
import { existsSync } from "node:fs"
import os from "node:os"
import { HubAgentRpcs, ManagementError } from "@scout/shared"
import type { TerminalOutput, LogBatch } from "@scout/shared"
import { AgentPluginHost } from "../services/plugin-host.js"

// ── Terminal helpers ───────────────────────────────────────────────────────────

interface TerminalHandle {
  readonly proc: ReturnType<typeof Bun.spawn>
  readonly queue: Queue.Queue<TerminalOutput, Cause.Done>
}

const toSpawnError = (error: unknown) =>
  new ManagementError({
    code: "spawn-error",
    message: String(error),
  })

const buildTerminalEnv = (cols: number, rows: number): Record<string, string> => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([, value]) => value !== undefined,
    ) as [string, string][],
  ),
  TERM: "xterm-256color",
  COLORTERM: "truecolor",
  COLUMNS: String(cols),
  LINES: String(rows),
})

const resolveFallbackShell = (): string => {
  if (existsSync("/bin/bash")) return "/bin/bash"
  const shell = process.env["SHELL"]
  if (typeof shell === "string" && shell.length > 0) return shell
  return "/bin/sh"
}

const resolveInteractiveShell = (): string => process.env["SHELL"] ?? resolveFallbackShell()

const quoteForShell = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

const buildExecCommand = (command: string): string => {
  const shell = resolveFallbackShell()
  if (shell.endsWith("/bash") || shell === "bash") {
    return `${quoteForShell(shell)} --noprofile --norc -c ${quoteForShell(command)}`
  }
  if (shell.endsWith("/zsh") || shell === "zsh") {
    return `${quoteForShell(shell)} -f -c ${quoteForShell(command)}`
  }
  return `${quoteForShell(shell)} -c ${quoteForShell(command)}`
}

export function spawnInteractiveTerminalProcess(params: {
  cols: number
  rows: number
}): Effect.Effect<ReturnType<typeof Bun.spawn>> {
  return Effect.sync(() => {
    const { cols, rows } = params
    const env = buildTerminalEnv(cols, rows)
    const shell = resolveInteractiveShell()
    if (process.platform === "linux") {
      return Bun.spawn(["script", "-q", "-f", "-c", shell, "/dev/null"], {
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

export function spawnExecTerminalProcess(params: {
  command: string
  cols: number
  rows: number
}): Effect.Effect<ReturnType<typeof Bun.spawn>> {
  return Effect.sync(() => {
    const { command, cols, rows } = params
    const env = buildTerminalEnv(cols, rows)
    if (process.platform === "linux") {
      return Bun.spawn(["script", "-q", "-e", "-f", "-c", buildExecCommand(command), "/dev/null"], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env,
      })
    }

    const shell = resolveFallbackShell()
    if (shell.endsWith("/bash") || shell === "bash") {
      return Bun.spawn([shell, "--noprofile", "--norc", "-c", command], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env,
      })
    }
    if (shell.endsWith("/zsh") || shell === "zsh") {
      return Bun.spawn([shell, "-f", "-c", command], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env,
      })
    }
    return Bun.spawn([shell, "-c", command], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env,
    })
  })
}

async function pumpStreamToQueue(
  stream: ReadableStream<Uint8Array>,
  queue: Queue.Enqueue<TerminalOutput, Cause.Done>,
): Promise<void> {
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value && value.length > 0) {
      const b64 = Buffer.from(value).toString("base64")
      try {
        const offered = await Effect.runPromise(
          Queue.offer(queue, { _tag: "output", dataBase64: b64 }),
        )
        if (!offered) break
      } catch {
        break
      }
    }
  }
}

const takeTerminalHandle = (
  terminals: Ref.Ref<Map<string, TerminalHandle>>,
  sessionId: string,
): Effect.Effect<TerminalHandle | null> =>
  Ref.modify(terminals, (current) => {
    const handle = current.get(sessionId) ?? null
    const next = new Map(current)
    next.delete(sessionId)
    return [handle, next] as const
  })

const closeTerminalHandle = (
  handle: TerminalHandle,
  options?: {
    readonly kill?: boolean
    readonly exitCode?: number | null
  },
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (options?.kill === true) {
      yield* Effect.sync(() => {
        try {
          handle.proc.kill()
        } catch {
          /* ignore */
        }
      })
    }

    if (options && "exitCode" in options) {
      yield* Queue.offer(handle.queue, {
        _tag: "exit",
        exitCode: options.exitCode ?? null,
      }).pipe(Effect.ignore)
    }

    yield* Queue.end(handle.queue).pipe(Effect.ignore)
  })

const watchTerminalProcess = (
  terminals: Ref.Ref<Map<string, TerminalHandle>>,
  sessionId: string,
  handle: TerminalHandle,
): Effect.Effect<void> =>
  Effect.tryPromise(async () => {
    const [exitCode] = await Promise.all([
      handle.proc.exited.catch(() => null),
      pumpStreamToQueue(handle.proc.stdout as ReadableStream<Uint8Array>, handle.queue),
      pumpStreamToQueue(handle.proc.stderr as ReadableStream<Uint8Array>, handle.queue),
    ])

    const activeHandle = await Effect.runPromise(takeTerminalHandle(terminals, sessionId))
    if (activeHandle === null) return
    await Effect.runPromise(closeTerminalHandle(activeHandle, { exitCode }))
  }).pipe(Effect.ignore)

export const startTerminalSession = (
  terminals: Ref.Ref<Map<string, TerminalHandle>>,
  procEffect: Effect.Effect<ReturnType<typeof Bun.spawn>>,
)=>
  Effect.gen(function* () {
    const sessionId = crypto.randomUUID()
    const queue = yield* Queue.unbounded<TerminalOutput, Cause.Done>()
    const proc = yield* procEffect.pipe(Effect.mapError(toSpawnError))
    const handle: TerminalHandle = { proc, queue }

    yield* Queue.offer(queue, { _tag: "session-start", sessionId })
    yield* Ref.update(terminals, (current) => new Map(current).set(sessionId, handle))
    yield* Effect.forkDetach(watchTerminalProcess(terminals, sessionId, handle))

    yield* Effect.addFinalizer(() =>
      takeTerminalHandle(terminals, sessionId).pipe(
        Effect.flatMap((activeHandle) =>
          activeHandle === null ? Effect.void : closeTerminalHandle(activeHandle, { kill: true }),
        ),
      ),
    )

    return queue
  })

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

      "terminal.open": ({ cols, rows }) =>
        startTerminalSession(
          terminals,
          spawnInteractiveTerminalProcess({
            cols,
            rows,
          }),
        ),

      "terminal.exec": ({ command, cols, rows }) =>
        startTerminalSession(
          terminals,
          spawnExecTerminalProcess({
            command,
            cols,
            rows,
          }),
        ),

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
          const term = yield* takeTerminalHandle(terminals, sessionId)
          if (term === null)
            return yield* fail("session-not-found", `No terminal session ${sessionId}`)

          yield* closeTerminalHandle(term, { kill: true })
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
