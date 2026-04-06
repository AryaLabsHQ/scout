/**
 * Tests for apps/agent/src/rpc/handlers.ts — the HubAgentHandlersLive layer.
 *
 * Tests cover:
 *   - Generic plugin management delegation
 *   - Terminal handler behavior
 */

import { describe, it, expect } from "vitest"
import { Cause, Effect, Layer, Option, Stream } from "effect"
import { HubAgentHandlersLive } from "../../src/rpc/handlers.js"
import { HubAgentRpcs, ManagementError } from "@scout/shared"
import * as RpcMessage from "effect/unstable/rpc/RpcMessage"
import { AgentPluginHost } from "../../src/services/plugin-host.js"
import type { PluginCapability, PluginCollectionResult } from "@scout/plugin-sdk"

// ── Test helper ───────────────────────────────────────────────────────────────

const testOptions = {
  clientId: 0 as number,
  requestId: RpcMessage.RequestId(1n),
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
  (Effect.gen(function* () {
    const handler = yield* HubAgentRpcs.accessHandler(tag)
    const result = (handler as (p: unknown, o: unknown) => Effect.Effect<unknown, unknown, never>)(
      payload,
      testOptions,
    )
    return yield* result.pipe(
      Effect.map((v): CallResult => ({ ok: v })),
      Effect.catchCause((cause) => {
        const failure = Cause.findErrorOption(cause)
        if (Option.isSome(failure)) {
          return Effect.succeed<CallResult>({ err: failure.value })
        }
        return Effect.succeed<CallResult>({ err: cause })
      }),
    )
  }).pipe(
    Effect.provide(HubAgentHandlersLive),
    Effect.provide(
      Layer.succeed(
        AgentPluginHost,
        makeStubPluginHost(pluginHostOverrides),
      ),
    ),
  )) as Effect.Effect<CallResult>

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

  it("plugins.logs delegates through the plugin host", async () => {
    const streamCalls: Array<Record<string, unknown>> = []

    const result = await Effect.runPromise(
      callHandler(
        "plugins.logs",
        {
          pluginId: "systemd",
          streamId: "unit.logs",
          entity: { pluginId: "systemd", kind: "systemd.unit", id: "nginx.service" },
          input: { tail: 50 },
        },
        {
          openLogStream: (request: {
            pluginId: string
            streamId: string
            target: { nodeId: string; entity?: { pluginId: string; kind: string; nodeId: string; id: string } }
            input?: unknown
          }) => {
            streamCalls.push(request as unknown as Record<string, unknown>)
            return Effect.succeed(Stream.make({ lines: ["hello"], ts: Date.now() }))
          },
        },
      ),
    )

    expect("ok" in result).toBe(true)
    expect(streamCalls).toHaveLength(1)
    expect(streamCalls[0]?.["streamId"]).toBe("unit.logs")
  })
})

// ── Terminal session tests ────────────────────────────────────────────────────

describe("terminal session management", () => {
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
