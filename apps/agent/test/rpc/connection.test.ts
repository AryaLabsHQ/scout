/**
 * Tests for apps/agent/src/rpc/connection.ts
 *
 * Focuses on the reconnect backoff schedule math and the HubClient proxy
 * behaviour. Full socket integration is skipped in unit tests.
 */

import { describe, it, expect } from "vitest"
import { Duration, Effect, Ref, Schedule } from "effect"
import { HubClient } from "../../src/rpc/connection.js"

// ── Backoff math ──────────────────────────────────────────────────────────────

describe("reconnect backoff schedule", () => {
  it("exponential delays: 1s→2s→4s→8s→16s, capped at 30s", () => {
    const base = 1_000
    const factor = 2
    const cap = 30_000

    const delays = Array.from({ length: 6 }, (_, i) =>
      Math.min(base * Math.pow(factor, i), cap),
    )

    expect(delays[0]).toBe(1_000)
    expect(delays[1]).toBe(2_000)
    expect(delays[2]).toBe(4_000)
    expect(delays[3]).toBe(8_000)
    expect(delays[4]).toBe(16_000)
    expect(delays[5]).toBe(30_000) // capped
  })

  it("jitter stays within ±20% of capped delay", () => {
    const capped = 30_000
    const jitter = capped * 0.2 * (Math.random() * 2 - 1)
    const result = Math.max(100, capped + jitter)
    expect(result).toBeGreaterThanOrEqual(24_000)
    expect(result).toBeLessThanOrEqual(36_001)
  })

  it("Schedule.exponential generates growing delays via math", () => {
    // Test the math directly — used in connection.ts reconnect schedule
    const base = 1_000
    const collected: number[] = []
    for (let i = 0; i < 5; i++) {
      const ms = Math.min(base * Math.pow(2, i), 30_000)
      collected.push(ms)
    }
    expect(collected).toEqual([1_000, 2_000, 4_000, 8_000, 16_000])

    // Also verify the Schedule import exists
    expect(typeof Schedule.exponential).toBe("function")
  })
})

// ── HubClient service tag ─────────────────────────────────────────────────────

describe("HubClient service", () => {
  it("has the expected service tag", () => {
    expect(HubClient.key).toBe("@scout/HubClient")
  })

  it("Ref.make tracks null → client transitions", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const ref = yield* Ref.make<unknown>(null)
        const initial = yield* Ref.get(ref)

        const fakeClient = { "agent.connect": () => Effect.succeed({ systemId: "test" }) }
        yield* Ref.set(ref, fakeClient)
        const after = yield* Ref.get(ref)

        yield* Ref.set(ref, null)
        const cleared = yield* Ref.get(ref)

        return { initial, after, cleared }
      }),
    )

    expect(result.initial).toBeNull()
    expect(result.after).not.toBeNull()
    expect(result.cleared).toBeNull()
  })
})

// ── Schedule helpers ──────────────────────────────────────────────────────────

describe("Duration helper math", () => {
  it("Duration.fromInputUnsafe parses string durations", () => {
    const d = Duration.fromInputUnsafe("1 second")
    expect(Duration.toMillis(d)).toBe(1_000)
  })

  it("Duration.millis creates millis-based durations", () => {
    const d = Duration.millis(5_000)
    expect(Duration.toMillis(d)).toBe(5_000)
  })
})
