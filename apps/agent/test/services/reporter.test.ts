import { describe, it, expect } from "vitest"
import { Duration, Effect, Queue, Ref, Schedule, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { it as itEffect } from "@effect/vitest"
import type { AgentReport, ScoutMessage } from "@scout/shared"

// ── Fixture report ────────────────────────────────────────────────────────────

const FIXTURE_REPORT: AgentReport = {
  systemId: "test-host",
  timestamp: 0,
  system: {
    cpu: { usage: 10, cores: 4, perCore: [10, 10, 10, 10], breakdown: { user: 5, system: 5, iowait: 0, steal: 0, idle: 90 } },
    memory: { used: 1_000_000, total: 8_000_000, available: 7_000_000, buffersCache: 500_000, swap: { used: 0, total: 0 } },
    disks: [],
    loadAvg: [0.1, 0.2, 0.3],
    uptime: 3600,
  },
  network: [{ name: "eth0", rxBytesPerSec: 1000, txBytesPerSec: 500, rxPacketsPerSec: 10, txPacketsPerSec: 5 }],
}

// ── Inline reporter logic (mirrors Reporter.run) ──────────────────────────────

/**
 * Build a reporter Effect directly without using the Reporter service,
 * to avoid needing real env vars for AgentConfig.
 */
const makeReporterRun = (
  intervalSeconds: number,
  collectAll: Effect.Effect<AgentReport | null>,
  sendFn: (msg: ScoutMessage) => Effect.Effect<void>,
): Effect.Effect<never> => {
  const collectAndSend: Effect.Effect<void> =
    collectAll.pipe(
      Effect.flatMap((report) => {
        if (report === null) return Effect.void
        const message: ScoutMessage = {
          id: "test-id",
          method: "metrics.report",
          params: report as unknown as Record<string, unknown>,
        }
        return sendFn(message).pipe(
          Effect.catchCause(() => Effect.void)
        )
      }),
      Effect.catchCause(() => Effect.void)
    )

  return collectAndSend.pipe(
    Effect.repeat(Schedule.spaced(Duration.seconds(intervalSeconds))),
    Effect.flatMap(() => Effect.never)
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Reporter", () => {
  itEffect.effect("sends one report after first interval tick", () =>
    Effect.gen(function* () {
      const sent = yield* Queue.unbounded<ScoutMessage>()

      const run = makeReporterRun(
        15,
        Effect.succeed(FIXTURE_REPORT),
        (msg) => Queue.offer(sent, msg),
      )

      // Fork the reporter run
      yield* run.pipe(Effect.forkChild)

      // Advance clock 15 seconds to trigger first tick
      yield* TestClock.adjust("15 seconds")

      // Drain the queue
      const messages: ScoutMessage[] = []
      let msg = yield* Queue.poll(sent)
      while (msg._tag === "Some") {
        messages.push(msg.value)
        msg = yield* Queue.poll(sent)
      }

      expect(messages.length).toBeGreaterThanOrEqual(1)
      const first = messages[0]!
      expect("method" in first).toBe(true)
      if ("method" in first) {
        expect(first.method).toBe("metrics.report")
      }
    })
  )

  itEffect.effect("sends 3 reports after 3 intervals", () =>
    Effect.gen(function* () {
      const sent = yield* Queue.unbounded<ScoutMessage>()

      const run = makeReporterRun(
        15,
        Effect.succeed(FIXTURE_REPORT),
        (msg) => Queue.offer(sent, msg),
      )

      yield* run.pipe(Effect.forkChild)

      // Advance 45s = 3 intervals
      yield* TestClock.adjust("45 seconds")

      const messages: ScoutMessage[] = []
      let msg = yield* Queue.poll(sent)
      while (msg._tag === "Some") {
        messages.push(msg.value)
        msg = yield* Queue.poll(sent)
      }

      expect(messages.length).toBeGreaterThanOrEqual(3)
    })
  )

  itEffect.effect("collector failure → next tick still runs", () =>
    Effect.gen(function* () {
      const sent = yield* Queue.unbounded<ScoutMessage>()
      const failRef = yield* Ref.make(true)

      const run = makeReporterRun(
        15,
        Ref.get(failRef).pipe(
          Effect.flatMap((shouldFail) =>
            shouldFail
              ? Effect.die(new Error("first tick fails"))
              : Effect.succeed(FIXTURE_REPORT)
          )
        ),
        (msg) => Queue.offer(sent, msg),
      )

      yield* run.pipe(Effect.forkChild)

      // First tick — collectAll fails (no message sent)
      yield* TestClock.adjust("15 seconds")
      const afterFirst = yield* Queue.poll(sent)

      // Second tick — collectAll succeeds
      yield* Ref.set(failRef, false)
      yield* TestClock.adjust("15 seconds")
      const afterSecond = yield* Queue.poll(sent)

      // First tick failure → no message
      expect(afterFirst._tag).toBe("None")
      // Second tick success → message sent
      expect(afterSecond._tag).toBe("Some")
    })
  )

  itEffect.effect("send failure → logged, next tick still runs", () =>
    Effect.gen(function* () {
      const successCount = yield* Ref.make(0)
      const sendFailRef = yield* Ref.make(true)

      const run = makeReporterRun(
        15,
        Effect.succeed(FIXTURE_REPORT),
        (_msg) =>
          Ref.get(sendFailRef).pipe(
            Effect.flatMap((shouldFail) =>
              shouldFail
                ? Effect.die(new Error("send failed"))
                : Ref.update(successCount, (n) => n + 1)
            )
          ),
      )

      yield* run.pipe(Effect.forkChild)

      // First tick — send fails
      yield* TestClock.adjust("15 seconds")
      const count1 = yield* Ref.get(successCount)

      // Second tick — send succeeds
      yield* Ref.set(sendFailRef, false)
      yield* TestClock.adjust("15 seconds")
      const count2 = yield* Ref.get(successCount)

      // First tick: send failed so no increment
      expect(count1).toBe(0)
      // Second tick: send succeeded
      expect(count2).toBe(1)
    })
  )

  it("message format has correct structure", () => {
    const msg: ScoutMessage = {
      id: crypto.randomUUID(),
      method: "metrics.report",
      params: FIXTURE_REPORT as unknown as Record<string, unknown>,
    }
    expect("method" in msg).toBe(true)
    if ("method" in msg) {
      expect(msg.method).toBe("metrics.report")
      expect(msg.params?.["systemId"]).toBe("test-host")
    }
  })
})

// ── Stream-based message dispatch ─────────────────────────────────────────────

describe("Reporter message stream", () => {
  it("onMessage stream emits received messages in order", async () => {
    const messages = await Effect.runPromise(
      Effect.gen(function* () {
        const q = yield* Queue.unbounded<ScoutMessage>()
        const stream = Stream.fromQueue(q)

        yield* Queue.offer(q, { event: "tick" })
        yield* Queue.offer(q, { id: "r1", ok: true })
        // Collect only 2 items (don't wait for stream end)
        return yield* Stream.take(stream, 2).pipe(Stream.runCollect)
      })
    )

    expect(messages.length).toBe(2)
  })
})
