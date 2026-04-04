import { describe, it } from "@effect/vitest"
import { strictEqual, deepStrictEqual } from "@effect/vitest/utils"
import { Deferred, Effect, Fiber, Layer } from "effect"
import * as Socket from "effect/unstable/socket/Socket"
import * as TestClock from "effect/testing/TestClock"
import { AgentManager } from "../../src/services/agent-manager.js"
import { Database } from "../../src/services/database.js"
import type { AgentInfo } from "@scout/shared"
import type { RpcRequest, RpcResponse } from "@scout/shared"

// ── Mock socket factory ──────────────────────────────────────────────────────

/**
 * Creates a mock Socket.Socket that captures sent messages and never closes.
 */
function createMockSocket() {
  const sent: string[] = []
  const socket = Socket.Socket.of({
    ["~effect/socket/Socket"]: "~effect/socket/Socket" as const,
    run: () => Effect.never,
    runRaw: () => Effect.never,
    // writer is a scoped Effect that returns a write function
    writer: Effect.succeed(
      (chunk: Uint8Array | string | Socket.CloseEvent): Effect.Effect<void, Socket.SocketError> => {
        if (!(chunk instanceof Socket.CloseEvent)) {
          sent.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
        }
        return Effect.void
      }
    ),
  })
  return { socket, sent }
}

// ── Test agent info ──────────────────────────────────────────────────────────

function makeAgentInfo(id: string): AgentInfo {
  return {
    systemId: id,
    hostname: `host-${id}`,
    version: "1.0.0",
    platform: "linux",
  }
}

// ── Test layer ───────────────────────────────────────────────────────────────

const TestDatabaseLayer = Layer.succeed(Database, {
  _tag: "@scout/Database" as const,
})

const AgentManagerTestLayer = AgentManager.layer.pipe(
  Layer.provide(TestDatabaseLayer)
)

// ── Tests ────────────────────────────────────────────────────────────────────

describe("AgentManager", () => {
  it.layer(AgentManagerTestLayer)("register + listConnected returns connected agents", (it) => {
    it.effect("register 2 agents → listConnected returns 2", () =>
      Effect.gen(function* () {
        const mgr = yield* AgentManager
        const { socket: sock1 } = createMockSocket()
        const { socket: sock2 } = createMockSocket()

        yield* mgr.register(makeAgentInfo("agent-1"), sock1)
        yield* mgr.register(makeAgentInfo("agent-2"), sock2)

        const connected = yield* mgr.listConnected()
        strictEqual(connected.length, 2)
      })
    )
  })

  it.layer(AgentManagerTestLayer)("unregister removes agent from list", (it) => {
    it.effect("register then unregister → listConnected returns 0", () =>
      Effect.gen(function* () {
        const mgr = yield* AgentManager
        const { socket } = createMockSocket()

        yield* mgr.register(makeAgentInfo("agent-1"), socket)
        yield* mgr.unregister("agent-1")

        const connected = yield* mgr.listConnected()
        strictEqual(connected.length, 0)
      })
    )
  })

  it.layer(AgentManagerTestLayer)("sendToAgent captures message in mock socket", (it) => {
    it.effect("register, sendToAgent → mock socket receives JSON message", () =>
      Effect.gen(function* () {
        const mgr = yield* AgentManager
        const { socket, sent } = createMockSocket()

        yield* mgr.register(makeAgentInfo("agent-1"), socket)

        const msg = { event: "ping", data: { foo: "bar" } }
        yield* mgr.sendToAgent("agent-1", msg)

        strictEqual(sent.length, 1)
        deepStrictEqual(JSON.parse(sent[0]!), msg)
      })
    )
  })

  it.layer(AgentManagerTestLayer)("sendToAgent fails with AgentNotConnected for unknown agent", (it) => {
    it.effect("sendToAgent for unregistered agent → AgentNotConnected", () =>
      Effect.gen(function* () {
        const mgr = yield* AgentManager

        const result = yield* mgr
          .sendToAgent("ghost-agent", { event: "hello" })
          .pipe(Effect.exit)

        // Should fail with AgentNotConnected
        const failed = result._tag === "Failure"
        strictEqual(failed, true)
        if (result._tag === "Failure") {
          const cause = result.cause
          // Check the failure is an AgentNotConnected error
          const isExpectedError =
            cause._tag === "Fail" &&
            cause.error._tag === "AgentNotConnected" &&
            cause.error.agentId === "ghost-agent"
          strictEqual(isExpectedError, true)
        }
      })
    )
  })

  it.layer(AgentManagerTestLayer)("invoke (call) success: handleResponse resolves the deferred", (it) => {
    it.effect("call → handleResponse → result returned", () =>
      Effect.gen(function* () {
        const mgr = yield* AgentManager
        const { socket } = createMockSocket()

        yield* mgr.register(makeAgentInfo("agent-1"), socket)

        const request: RpcRequest = {
          id: "req-001",
          method: "system.info",
          params: {},
        }

        // Fork the call so it waits for handleResponse
        const callFiber = yield* Effect.forkChild(
          mgr.call("agent-1", request, 5_000)
        )

        // Simulate agent responding
        const response: RpcResponse = {
          id: "req-001",
          ok: true,
          result: { hostname: "host-agent-1" },
        }
        yield* mgr.handleResponse(response)

        const result = yield* Fiber.join(callFiber)
        strictEqual(result.ok, true)
        deepStrictEqual(result.result, { hostname: "host-agent-1" })
      })
    )
  })

  it.layer(AgentManagerTestLayer)("invoke (call) timeout: TimeoutError after deadline", (it) => {
    it.effect("call with 100ms timeout + advance clock 200ms → TimeoutError", () =>
      Effect.gen(function* () {
        const mgr = yield* AgentManager
        const { socket } = createMockSocket()

        yield* mgr.register(makeAgentInfo("agent-1"), socket)

        const request: RpcRequest = {
          id: "req-timeout",
          method: "slow.operation",
        }

        // Fork: call with short timeout
        const callFiber = yield* Effect.forkChild(
          mgr.call("agent-1", request, 100)
        )

        // Advance TestClock past the timeout
        yield* TestClock.adjust("200 millis")

        const exit = yield* Fiber.await(callFiber)
        const failed = exit._tag === "Failure"
        strictEqual(failed, true)
        if (exit._tag === "Failure") {
          const cause = exit.cause
          const isTimeout =
            cause._tag === "Fail" &&
            cause.error._tag === "TimeoutError" &&
            cause.error.method === "slow.operation"
          strictEqual(isTimeout, true)
        }
      })
    )
  })

  it.layer(AgentManagerTestLayer)("grace period: system stays connected within 5s, goes offline after", (it) => {
    it.effect("register, unregister → within 5s: system still in list (has system record)", () =>
      Effect.gen(function* () {
        const mgr = yield* AgentManager
        const { socket } = createMockSocket()

        yield* mgr.register(makeAgentInfo("agent-grace"), socket)
        yield* mgr.unregister("agent-grace")

        // Advance just under the grace period
        yield* TestClock.adjust("4 seconds")

        // Agent should not be connected (unregistered), but system record
        // should not yet be marked offline (grace period hasn't expired)
        const connected = yield* mgr.listConnected()
        strictEqual(connected.length, 0)
      })
    )

    it.effect("register, unregister → after 5s: system goes offline", () =>
      Effect.gen(function* () {
        const mgr = yield* AgentManager
        const { socket } = createMockSocket()

        yield* mgr.register(makeAgentInfo("agent-offline"), socket)
        yield* mgr.unregister("agent-offline")

        // Advance past the grace period
        yield* TestClock.adjust("6 seconds")

        // Agent should not be connected
        const connected = yield* mgr.listConnected()
        strictEqual(connected.length, 0)

        // getConnected should return null
        const agent = yield* mgr.getConnected("agent-offline")
        strictEqual(agent, null)
      })
    )

    it.effect("register, unregister, re-register within 5s cancels grace period", () =>
      Effect.gen(function* () {
        const mgr = yield* AgentManager
        const { socket: sock1 } = createMockSocket()
        const { socket: sock2 } = createMockSocket()

        yield* mgr.register(makeAgentInfo("agent-rejoin"), sock1)
        yield* mgr.unregister("agent-rejoin")

        // Re-register within grace period
        yield* TestClock.adjust("2 seconds")
        yield* mgr.register(makeAgentInfo("agent-rejoin"), sock2)

        // Advance past original grace period
        yield* TestClock.adjust("6 seconds")

        // Agent should still be connected (re-registered)
        const connected = yield* mgr.listConnected()
        strictEqual(connected.length, 1)
        strictEqual(connected[0]?.agentId, "agent-rejoin")
      })
    )
  })

  it.layer(AgentManagerTestLayer)("getConnected returns agent when connected, null otherwise", (it) => {
    it.effect("getConnected for registered agent returns ConnectedAgent", () =>
      Effect.gen(function* () {
        const mgr = yield* AgentManager
        const { socket } = createMockSocket()
        const info = makeAgentInfo("agent-get")

        yield* mgr.register(info, socket)
        const result = yield* mgr.getConnected("agent-get")

        strictEqual(result !== null, true)
        strictEqual(result?.agentId, "agent-get")
        strictEqual(result?.info.hostname, "host-agent-get")
      })
    )

    it.effect("getConnected for unregistered agent returns null", () =>
      Effect.gen(function* () {
        const mgr = yield* AgentManager
        const result = yield* mgr.getConnected("nobody")
        strictEqual(result, null)
      })
    )
  })

  it.layer(AgentManagerTestLayer)("handleResponse with unknown request ID is a no-op", (it) => {
    it.effect("handleResponse for unknown id does not throw", () =>
      Effect.gen(function* () {
        const mgr = yield* AgentManager
        const response: RpcResponse = { id: "unknown-id", ok: true, result: {} }
        yield* mgr.handleResponse(response) // should not fail
      })
    )
  })

  it.layer(AgentManagerTestLayer)("call with error response fails with RpcCallError", (it) => {
    it.effect("handleResponse with ok=false → RpcCallError propagated to caller", () =>
      Effect.gen(function* () {
        const mgr = yield* AgentManager
        const { socket } = createMockSocket()

        yield* mgr.register(makeAgentInfo("agent-err"), socket)

        const request: RpcRequest = { id: "req-err", method: "will.fail" }
        const callFiber = yield* Effect.forkChild(mgr.call("agent-err", request, 5_000))

        const errResponse: RpcResponse = {
          id: "req-err",
          ok: false,
          error: { code: "NOT_FOUND", message: "resource not found" },
        }
        yield* mgr.handleResponse(errResponse)

        const exit = yield* Fiber.await(callFiber)
        strictEqual(exit._tag, "Failure")
        if (exit._tag === "Failure") {
          const cause = exit.cause
          const isRpcCallError =
            cause._tag === "Fail" &&
            cause.error._tag === "RpcCallError" &&
            cause.error.code === "NOT_FOUND"
          strictEqual(isRpcCallError, true)
        }
      })
    )
  })
})
