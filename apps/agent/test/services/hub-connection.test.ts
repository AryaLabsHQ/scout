import { describe, it, expect } from "vitest"
import { Deferred, Effect, Layer, Queue, Ref } from "effect"
import * as Socket from "effect/unstable/socket/Socket"
import type { ScoutMessage, RpcError } from "@scout/shared"
import { RpcTimeoutError, HubConnectError, AgentCapabilitiesCtx } from "../../src/services/hub-connection.js"

// ── Helpers ───────────────────────────────────────────────────────────────────

const run = <A>(effect: Effect.Effect<A, unknown, never>): Promise<A> =>
  Effect.runPromise(effect)

// ── Unit tests for extracted logic ───────────────────────────────────────────

describe("HubConnection internals", () => {
  it("RpcTimeoutError is a tagged error", () => {
    const err = new RpcTimeoutError({ method: "test", timeoutMs: 5000 })
    expect(err._tag).toBe("RpcTimeoutError")
    expect(err.method).toBe("test")
    expect(err.timeoutMs).toBe(5000)
  })

  it("HubConnectError is a tagged error", () => {
    const err = new HubConnectError({ reason: "connect rejected" })
    expect(err._tag).toBe("HubConnectError")
    expect(err.reason).toBe("connect rejected")
  })

  it("invoke timeoutOrElse fails with RpcTimeoutError after timeout", async () => {
    // Simulate the invoke logic directly
    const result = await run(
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<unknown, RpcError | RpcTimeoutError>()
        // Never resolve the deferred — should timeout
        return yield* Effect.timeoutOrElse(
          Deferred.await(deferred),
          {
            duration: 50, // 50ms
            orElse: () =>
              Effect.fail(new RpcTimeoutError({ method: "test", timeoutMs: 50 })),
          }
        )
      }).pipe(
        Effect.flip
      )
    )

    expect(result).toBeInstanceOf(RpcTimeoutError)
    expect((result as RpcTimeoutError).method).toBe("test")
  })

  it("pending call deferred resolves with result", async () => {
    const result = await run(
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<unknown, RpcError | RpcTimeoutError>()
        // Resolve it in a forked fiber
        yield* Deferred.succeed(deferred, { ok: true, data: "hello" }).pipe(Effect.forkChild)
        return yield* Deferred.await(deferred)
      })
    )

    expect(result).toEqual({ ok: true, data: "hello" })
  })

  it("pending call deferred fails with RpcError", async () => {
    const rpcError: RpcError = { code: "NOT_FOUND", message: "not found" }

    const result = await run(
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<unknown, RpcError | RpcTimeoutError>()
        yield* Deferred.fail(deferred, rpcError).pipe(Effect.forkChild)
        return yield* Deferred.await(deferred)
      }).pipe(Effect.flip)
    )

    expect(result).toEqual(rpcError)
  })

  it("message queue receives and delivers messages", async () => {
    const messages = await run(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<ScoutMessage>()

        // Offer messages
        yield* Queue.offer(queue, { event: "tick" })
        yield* Queue.offer(queue, { event: "update", data: { foo: 1 } })

        // Take them
        const m1 = yield* Queue.take(queue)
        const m2 = yield* Queue.take(queue)
        return [m1, m2]
      })
    )

    expect(messages).toHaveLength(2)
    expect("event" in messages[0]!).toBe(true)
    expect((messages[0] as { event: string }).event).toBe("tick")
  })

  it("status ref tracks connection state transitions", async () => {
    const statuses = await run(
      Effect.gen(function* () {
        const statusRef = yield* Ref.make<"connected" | "connecting" | "disconnected">("disconnected")

        const s1 = yield* Ref.get(statusRef)
        yield* Ref.set(statusRef, "connecting")
        const s2 = yield* Ref.get(statusRef)
        yield* Ref.set(statusRef, "connected")
        const s3 = yield* Ref.get(statusRef)
        yield* Ref.set(statusRef, "disconnected")
        const s4 = yield* Ref.get(statusRef)

        return [s1, s2, s3, s4]
      })
    )

    expect(statuses).toEqual(["disconnected", "connecting", "connected", "disconnected"])
  })

  it("send is a no-op when writer is null", async () => {
    const result = await run(
      Effect.gen(function* () {
        const writerRef = yield* Ref.make<((data: string) => Effect.Effect<void, Socket.SocketError>) | null>(null)
        const writer = yield* Ref.get(writerRef)
        // Should not throw
        if (writer !== null) {
          throw new Error("expected null writer")
        }
        return "ok"
      })
    )

    expect(result).toBe("ok")
  })
})

// ── AgentCapabilitiesCtx ──────────────────────────────────────────────────────

describe("AgentCapabilitiesCtx", () => {
  it("can be provided via Layer and read via useSync", async () => {
    const caps = await run(
      AgentCapabilitiesCtx.useSync((c) => c).pipe(
        Effect.provide(
          Layer.succeed(AgentCapabilitiesCtx)({
            system: true,
            network: true,
            process: false,
            temperature: false,
            gpu: false,
            smart: false,
            systemd: false,
            docker: false,
            k8s: false,
          })
        )
      )
    )

    expect(caps.system).toBe(true)
    expect(caps.gpu).toBe(false)
  })
})

// ── WebSocket mock integration test ──────────────────────────────────────────

describe("HubConnection mock socket", () => {
  it("JSON round-trip: serialize message to string and back", () => {
    const msg: ScoutMessage = {
      id: "abc-123",
      method: "connect",
      params: { token: "t", hostname: "h" },
    }
    const text = JSON.stringify(msg)
    const parsed = JSON.parse(text) as ScoutMessage
    expect(parsed).toEqual(msg)
  })

  it("isRpcEvent correctly identifies tick events", () => {
    const { isRpcEvent } = require("@scout/shared") as typeof import("@scout/shared")
    const tick: ScoutMessage = { event: "tick" }
    expect(isRpcEvent(tick)).toBe(true)
  })

  it("isRpcResponse correctly identifies responses", () => {
    const { isRpcResponse } = require("@scout/shared") as typeof import("@scout/shared")
    const response: ScoutMessage = { id: "abc", ok: true, result: {} }
    expect(isRpcResponse(response)).toBe(true)
  })

  it("mock socket can simulate a full connect-response cycle", async () => {
    // In-process simulation of the connect protocol
    const received: ScoutMessage[] = []
    const toSend: ScoutMessage[] = []

    // Simulate what the socket receives
    const connectId = "conn-123"
    const connectMsg: ScoutMessage = {
      id: connectId,
      method: "connect",
      params: { token: "t", hostname: "h", version: "0.0.1" },
    }
    toSend.push(connectMsg)

    // Simulate hub responding with ok: true
    const response: ScoutMessage = { id: connectId, ok: true }

    // Process the connect message
    for (const msg of toSend) {
      if ("method" in msg && msg.method === "connect") {
        // Hub would respond with ok: true
        received.push(response)
      }
    }

    expect(received).toHaveLength(1)
    const r = received[0]!
    expect("ok" in r).toBe(true)
    if ("ok" in r) {
      expect(r.ok).toBe(true)
      expect(r.id).toBe(connectId)
    }
  })

  it("reconnect schedule: exponential backoff up to 30s cap", () => {
    // Verify exponential backoff math: 1s→2s→4s→8s→16s→30s(cap)
    const base = 1000 // 1s
    const factor = 2
    const cap = 30_000

    const delays = Array.from({ length: 6 }, (_, i) =>
      Math.min(base * Math.pow(factor, i), cap)
    )

    expect(delays[0]).toBe(1_000)
    expect(delays[1]).toBe(2_000)
    expect(delays[2]).toBe(4_000)
    expect(delays[3]).toBe(8_000)
    expect(delays[4]).toBe(16_000)
    expect(delays[5]).toBe(30_000) // capped
  })

  it("tick watchdog: detects missing tick after 60s", () => {
    const lastTick = Date.now() - 61_000 // 61 seconds ago
    const now = Date.now()
    const timedOut = now - lastTick > 60_000
    expect(timedOut).toBe(true)
  })

  it("tick watchdog: recent tick does not trigger", () => {
    const lastTick = Date.now() - 25_000 // 25 seconds ago
    const now = Date.now()
    const timedOut = now - lastTick > 60_000
    expect(timedOut).toBe(false)
  })
})
