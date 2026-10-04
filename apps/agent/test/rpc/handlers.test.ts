/**
 * Tests for apps/agent/src/rpc/handlers.ts — the HubAgentHandlersLive layer.
 *
 * Tests cover:
 *   - Generic plugin management delegation
 *   - Terminal handler behavior
 */

import { describe, it, expect, vi } from "vitest"
import { Cause, Deferred, Effect, Fiber, Layer, Option, Ref, Stream } from "effect"
import {
  HubAgentHandlersLive,
  spawnExecTerminalProcess,
  spawnInteractiveTerminalProcess,
  startTerminalSession,
} from "../../src/rpc/handlers.js"
import { HubAgentRpcs, ManagementError } from "@scout/shared"
import * as RpcMessage from "effect/rpc/RpcMessage"
import { AgentPluginHost, PluginHostError } from "../../src/services/plugin-host.js"
import type { PluginCapability, PluginCollectionResult } from "@scout/plugin-sdk"
import type { LogBatch, TerminalOutput } from "@scout/shared"

// ── Test helper ───────────────────────────────────────────────────────────────

const testOptions = {
  clientId: 0 as number,
  requestId: RpcMessage.RequestId(1),
  headers: {} as never,
}

type CallResult = { ok: unknown } | { err: unknown }

const makeStubPluginHost = (
  overrides?: Partial<{
    listCapabilities: () => Effect.Effect<ReadonlyArray<PluginCapability>>
    runAction: (request: {
      pluginId: string
      actionId: string
      target: { nodeId: string; entity?: { pluginId: string; kind: string; nodeId: string; id: string } }
      input?: unknown
    }) => Effect.Effect<unknown, Error>
    openLogStream: (request: {
      pluginId: string
      streamId: string
      target: { nodeId: string; entity?: { pluginId: string; kind: string; nodeId: string; id: string } }
      input?: unknown
    }) => Effect.Effect<Stream.Stream<{ lines: readonly string[]; ts: number }, Error>, Error>
  }>,
) => ({
  listCapabilities:
    overrides?.listCapabilities ?? (() => Effect.succeed([] as ReadonlyArray<PluginCapability>)),
  collectCollections: (): Effect.Effect<ReadonlyArray<PluginCollectionResult>> => Effect.succeed([]),
  runAction: overrides?.runAction ?? (() => Effect.succeed({})),
  openLogStream:
    overrides?.openLogStream ??
    (() => Effect.succeed(Stream.empty as Stream.Stream<{ lines: readonly string[]; ts: number }, Error>)),
})

const provideHandlers = <A, E = never, R = never>(
  effect: Effect.Effect<A, E, R>,
  pluginHostOverrides?: Partial<{
    listCapabilities: () => Effect.Effect<ReadonlyArray<PluginCapability>>
    runAction: (request: {
      pluginId: string
      actionId: string
      target: { nodeId: string; entity?: { pluginId: string; kind: string; nodeId: string; id: string } }
      input?: unknown
    }) => Effect.Effect<unknown, Error>
    openLogStream: (request: {
      pluginId: string
      streamId: string
      target: { nodeId: string; entity?: { pluginId: string; kind: string; nodeId: string; id: string } }
      input?: unknown
    }) => Effect.Effect<Stream.Stream<{ lines: readonly string[]; ts: number }, Error>, Error>
  }>,
)=>
  effect.pipe(
    Effect.provide(HubAgentHandlersLive),
    Effect.provide(
      Layer.succeed(
        AgentPluginHost,
        makeStubPluginHost(pluginHostOverrides),
      ),
    ),
  )

/**
 * Call a handler and return either { ok: value } or { err: unknown }.
 * This avoids fighting the union return types from accessHandler.
 */
const callHandler = (
  tag: Parameters<typeof HubAgentRpcs.accessHandler>[0],
  payload: Record<string, unknown>,
  pluginHostOverrides?: Partial<{
    listCapabilities: () => Effect.Effect<ReadonlyArray<PluginCapability>>
    runAction: (request: {
      pluginId: string
      actionId: string
      target: { nodeId: string; entity?: { pluginId: string; kind: string; nodeId: string; id: string } }
      input?: unknown
    }) => Effect.Effect<unknown, Error>
    openLogStream: (request: {
      pluginId: string
      streamId: string
      target: { nodeId: string; entity?: { pluginId: string; kind: string; nodeId: string; id: string } }
      input?: unknown
    }) => Effect.Effect<Stream.Stream<{ lines: readonly string[]; ts: number }, Error>, Error>
  }>,
): Effect.Effect<CallResult> =>
  provideHandlers(
    Effect.gen(function* () {
      const handler = yield* HubAgentRpcs.accessHandler(tag)
      const result = (handler as (p: unknown, o: unknown) => Effect.Effect<unknown, unknown, never>)(
        payload,
        testOptions,
      )
      return yield* result.pipe(
        Effect.map((value): CallResult => ({ ok: value })),
        Effect.catchCause((cause) => {
          const failure = Cause.findErrorOption(cause)
          if (Option.isSome(failure)) {
            return Effect.succeed<CallResult>({ err: failure.value })
          }
          return Effect.succeed<CallResult>({ err: cause })
        }),
      )
    }),
    pluginHostOverrides,
  ) as Effect.Effect<CallResult>

describe("generic plugin handler delegation", () => {
  it("plugins.runAction delegates through the plugin host", async () => {
    const actionCalls: Array<Record<string, unknown>> = []

    const result = await Effect.runPromise(
      callHandler(
        "plugins.runAction",
        {
          pluginId: "systemd",
          actionId: "unit.restart",
          entity: { pluginId: "systemd", kind: "systemd.unit", id: "nginx.service" },
        },
        {
          runAction: (request: {
            pluginId: string
            actionId: string
            target: { nodeId: string; entity?: { pluginId: string; kind: string; nodeId: string; id: string } }
            input?: unknown
          }) => {
            actionCalls.push(request as unknown as Record<string, unknown>)
            return Effect.succeed({ ok: true })
          },
        },
      ),
    )

    expect("ok" in result).toBe(true)
    expect(actionCalls).toHaveLength(1)
    expect(actionCalls[0]?.["pluginId"]).toBe("systemd")
    expect(actionCalls[0]?.["actionId"]).toBe("unit.restart")
  })

  it("plugins.runAction keeps the plugin's error code and explanation", async () => {
    const result = await Effect.runPromise(
      callHandler(
        "plugins.runAction",
        {
          pluginId: "systemd",
          actionId: "unit.stop",
          entity: { pluginId: "systemd", kind: "systemd.unit", id: "nginx.service" },
        },
        {
          runAction: () =>
            Effect.fail(new PluginHostError("permission-denied", "systemctl stop nginx.service requires root")),
        },
      ),
    )

    expect(result).toMatchObject({
      err: { code: "permission-denied", message: "systemctl stop nginx.service requires root" },
    })
  })

  it("plugins.logs streams the plugin host's log chunks as batches", async () => {
    const streamCalls: Array<Record<string, unknown>> = []

    const batches = await Effect.runPromise(
      provideHandlers(
        Effect.gen(function* () {
          const handler = yield* HubAgentRpcs.accessHandler("plugins.logs")
          return yield* Stream.runCollect(
            handler(
              {
                pluginId: "systemd",
                streamId: "unit.logs",
                entity: { pluginId: "systemd", kind: "systemd.unit", id: "nginx.service" },
                input: { tail: 50 },
              },
              testOptions as never,
            ) as Stream.Stream<LogBatch, ManagementError>,
          )
        }),
        {
          openLogStream: (request) => {
            streamCalls.push(request as unknown as Record<string, unknown>)
            return Effect.succeed(Stream.make({ lines: ["hello"], ts: 42 }))
          },
        },
      ),
    )

    expect(Array.from(batches)).toEqual([{ lines: ["hello"], timestamp: 42 }])
    expect(streamCalls).toHaveLength(1)
    expect(streamCalls[0]?.["streamId"]).toBe("unit.logs")
  })

  it("plugins.logs keeps the plugin host's error code when the stream cannot open", async () => {
    const exit = await Effect.runPromiseExit(
      provideHandlers(
        Effect.gen(function* () {
          const handler = yield* HubAgentRpcs.accessHandler("plugins.logs")
          return yield* Stream.runDrain(
            handler(
              { pluginId: "missing", streamId: "logs" },
              testOptions as never,
            ) as Stream.Stream<LogBatch, ManagementError>,
          )
        }),
        {
          openLogStream: () =>
            Effect.fail(new PluginHostError("plugin-not-loaded", "Requested plugin is not loaded")),
        },
      ),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    const failure = Cause.findErrorOption(exit.cause)
    expect(Option.getOrUndefined(failure)).toMatchObject({ code: "plugin-not-loaded" })
  })

  it("plugins.logs releases the plugin stream when the request is interrupted", async () => {
    let released = false

    await Effect.runPromise(
      provideHandlers(
        Effect.gen(function* () {
          const handler = yield* HubAgentRpcs.accessHandler("plugins.logs")
          const stream = handler(
            { pluginId: "systemd", streamId: "unit.logs" },
            testOptions as never,
          ) as Stream.Stream<LogBatch, ManagementError>
          const received = yield* Deferred.make<void>()
          const fiber = yield* Stream.runForEach(stream, () => Deferred.succeed(received, undefined)).pipe(
            Effect.forkChild,
          )
          yield* Deferred.await(received)
          yield* Fiber.interrupt(fiber)
        }),
        {
          openLogStream: () =>
            Effect.succeed(
              Stream.concat(Stream.make({ lines: ["first"], ts: 1 }), Stream.never).pipe(
                Stream.ensuring(
                  Effect.sync(() => {
                    released = true
                  }),
                ),
              ),
            ),
        },
      ),
    )

    expect(released).toBe(true)
  })
})

// ── Terminal session tests ────────────────────────────────────────────────────

describe("terminal session management", () => {
  it("startTerminalSession queues end normally with an exit chunk", async () => {
    const chunks = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const terminals = yield* Ref.make(new Map())
          const queue = yield* startTerminalSession(
            terminals,
            spawnExecTerminalProcess({
              command: "printf 'hello\\n'; exit 7",
              cols: 80,
              rows: 24,
            }),
          )

          return yield* Stream.runCollect(Stream.fromQueue(queue)).pipe(
            Effect.map((items) => Array.from(items) as Array<TerminalOutput>),
          )
        }),
      ),
    )

    expect(chunks[0]?._tag).toBe("session-start")
    expect(chunks.at(-1)).toEqual({ _tag: "exit", exitCode: 7 })
  })

  it("terminal.exec spawn path exits with the child status and captures command output", async () => {
    const proc = await Effect.runPromise(
      spawnExecTerminalProcess({
        command: "printf 'hello\\n'; exit 7",
        cols: 80,
        rows: 24,
      }),
    )

    const [exitCode, outputText] = await Promise.all([
      proc.exited,
      new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    ])

    expect(exitCode).toBe(7)
    expect(outputText).toContain("hello")
  })

  it("terminal.open spawn path exits when the shell receives exit", async () => {
    // Pin the interactive shell: the spawn path otherwise runs the developer's
    // $SHELL with its full interactive rc (prompt frameworks, plugins), which
    // can swallow or never reach the scripted `exit`.
    vi.stubEnv("SHELL", "/bin/sh")
    try {
      const proc = await Effect.runPromise(
        spawnInteractiveTerminalProcess({
          cols: 80,
          rows: 24,
        }),
      )

      const stdin = proc.stdin as { write(data: Uint8Array): number }
      stdin.write(Buffer.from("exit\n", "utf8"))

      expect(await proc.exited).toBe(0)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("terminal.input fails with session-not-found for unknown sessionId", async () => {
    const result = await Effect.runPromise(
      callHandler("terminal.input", {
        sessionId: "nonexistent-session",
        dataBase64: btoa("hello"),
      }),
    )
    expect("err" in result).toBe(true)
    if ("err" in result) {
      expect(result.err).toBeInstanceOf(ManagementError)
      if (result.err instanceof ManagementError) {
        expect(result.err.code).toBe("session-not-found")
      }
    }
  })

  it("terminal.resize fails with session-not-found for unknown sessionId", async () => {
    const result = await Effect.runPromise(
      callHandler("terminal.resize", {
        sessionId: "nonexistent-session",
        cols: 80,
        rows: 24,
      }),
    )
    expect("err" in result).toBe(true)
    if ("err" in result) {
      expect(result.err).toBeInstanceOf(ManagementError)
      if (result.err instanceof ManagementError) {
        expect(result.err.code).toBe("session-not-found")
      }
    }
  })

  it("terminal.close fails with session-not-found for unknown sessionId", async () => {
    const result = await Effect.runPromise(
      callHandler("terminal.close", {
        sessionId: "nonexistent-session",
      }),
    )
    expect("err" in result).toBe(true)
    if ("err" in result) {
      expect(result.err).toBeInstanceOf(ManagementError)
      if (result.err instanceof ManagementError) {
        expect(result.err.code).toBe("session-not-found")
      }
    }
  })
})

// ── Layer health check ────────────────────────────────────────────────────────

describe("HubAgentHandlersLive layer", () => {
  it("can be built successfully", async () => {
    const result = await Effect.runPromise(
      Effect.succeed(true).pipe(
        Effect.provide(HubAgentHandlersLive),
        Effect.provide(
          Layer.succeed(AgentPluginHost, {
            ...makeStubPluginHost(),
          }),
        ),
      ),
    )
    expect(result).toBe(true)
  })
})
