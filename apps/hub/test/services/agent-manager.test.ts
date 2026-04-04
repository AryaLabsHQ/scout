import { describe, it } from "@effect/vitest"
import { strictEqual, deepStrictEqual } from "@effect/vitest/utils"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import * as Socket from "effect/unstable/socket/Socket"
import * as TestClock from "effect/testing/TestClock"
import { AgentManager } from "../../src/services/agent-manager.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"
import type { AgentInfo, RpcRequest, RpcResponse } from "@scout/shared"

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

// ── Helper: extract the first typed error from a Cause ──────────────────────

function firstFailError<E>(cause: Cause.Cause<E>): E | undefined {
  const failReason = cause.reasons.find(Cause.isFailReason)
  return failReason?.error
}

// ── Test layer ───────────────────────────────────────────────────────────────

const AgentManagerTestLayer = AgentManager.layer.pipe(Layer.provide(TestDatabaseLayer))

// ── Tests ────────────────────────────────────────────────────────────────────

describe("AgentManager", () => {
  describe("register + listConnected", () => {
    it.layer(AgentManagerTestLayer)("register 2 agents → listConnected returns 2", (it) => {
      it.effect("two registered agents appear in listConnected", () =>
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
  })

  describe("unregister", () => {
    it.layer(AgentManagerTestLayer)("register then unregister → listConnected returns 0", (it) => {
      it.effect("agent removed from list after unregister", () =>
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
  })

  describe("sendToAgent", () => {
    it.layer(AgentManagerTestLayer)("captures message in mock socket", (it) => {
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

    it.layer(AgentManagerTestLayer)("fails with AgentNotConnected for unknown agent", (it) => {
      it.effect("sendToAgent for unregistered agent → AgentNotConnected", () =>
        Effect.gen(function* () {
          const mgr = yield* AgentManager

          const exit = yield* mgr
            .sendToAgent("ghost-agent", { event: "hello" })
            .pipe(Effect.exit)

          if (Exit.isFailure(exit)) {
            const error = firstFailError(exit.cause)
            strictEqual(error?._tag, "AgentNotConnected")
            if (error?._tag === "AgentNotConnected") {
              strictEqual(error.agentId, "ghost-agent")
            }
          } else {
            // Force failure so test fails
            strictEqual("should have failed", "but succeeded")
          }
        })
      )
    })
  })

  describe("call (RPC invoke)", () => {
    it.layer(AgentManagerTestLayer)("invoke success: handleResponse resolves the deferred", (it) => {
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
            mgr.call("agent-1", request, 30_000)
          )

          // Yield to allow the forked fiber to run and register the deferred
          yield* Effect.yieldNow

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

    it.layer(AgentManagerTestLayer)("invoke timeout: TimeoutError after deadline", (it) => {
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
          if (Exit.isFailure(exit)) {
            const error = firstFailError(exit.cause)
            strictEqual(error?._tag, "TimeoutError")
            if (error?._tag === "TimeoutError") {
              strictEqual(error.method, "slow.operation")
            }
          } else {
            strictEqual("should have timed out", "but succeeded")
          }
        })
      )
    })

    it.layer(AgentManagerTestLayer)("error response fails with RpcCallError", (it) => {
      it.effect("handleResponse with ok=false → RpcCallError propagated to caller", () =>
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          const { socket } = createMockSocket()

          yield* mgr.register(makeAgentInfo("agent-err"), socket)

          const request: RpcRequest = { id: "req-err", method: "will.fail" }
          const callFiber = yield* Effect.forkChild(mgr.call("agent-err", request, 30_000))

          // Yield to allow the forked fiber to run and register the deferred
          yield* Effect.yieldNow

          const errResponse: RpcResponse = {
            id: "req-err",
            ok: false,
            error: { code: "NOT_FOUND", message: "resource not found" },
          }
          yield* mgr.handleResponse(errResponse)

          const exit = yield* Fiber.await(callFiber)
          if (Exit.isFailure(exit)) {
            const error = firstFailError(exit.cause)
            strictEqual(error?._tag, "RpcCallError")
            if (error?._tag === "RpcCallError") {
              strictEqual(error.code, "NOT_FOUND")
            }
          } else {
            strictEqual("should have failed", "but succeeded")
          }
        })
      )
    })
  })

  describe("grace period on disconnect", () => {
    it.layer(AgentManagerTestLayer)("system not in list immediately after unregister", (it) => {
      it.effect("within 5s: agent removed from connected list", () =>
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          const { socket } = createMockSocket()

          yield* mgr.register(makeAgentInfo("agent-grace"), socket)
          yield* mgr.unregister("agent-grace")

          // Advance just under the grace period
          yield* TestClock.adjust("4 seconds")

          const connected = yield* mgr.listConnected()
          strictEqual(connected.length, 0)
        })
      )
    })

    it.layer(AgentManagerTestLayer)("after 5s: system goes offline", (it) => {
      it.effect("register, unregister → after 5s grace: system offline", () =>
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          const { socket } = createMockSocket()

          yield* mgr.register(makeAgentInfo("agent-offline"), socket)
          yield* mgr.unregister("agent-offline")

          // Advance past the grace period
          yield* TestClock.adjust("6 seconds")

          const connected = yield* mgr.listConnected()
          strictEqual(connected.length, 0)

          const agent = yield* mgr.getConnected("agent-offline")
          strictEqual(agent, null)
        })
      )
    })

    it.layer(AgentManagerTestLayer)("re-register within 5s cancels grace period", (it) => {
      it.effect("agent comes back before grace expires → stays connected", () =>
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
  })

  describe("getConnected", () => {
    it.layer(AgentManagerTestLayer)("returns ConnectedAgent when connected", (it) => {
      it.effect("registered agent is found by getConnected", () =>
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
  })

  describe("handleResponse edge cases", () => {
    it.layer(AgentManagerTestLayer)("unknown request ID is a no-op", (it) => {
      it.effect("handleResponse for unknown id does not fail", () =>
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          const response: RpcResponse = { id: "unknown-id", ok: true, result: {} }
          yield* mgr.handleResponse(response) // should not fail
        })
      )
    })
  })
})
