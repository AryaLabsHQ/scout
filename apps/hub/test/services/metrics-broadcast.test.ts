import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, PubSub } from "effect"
import * as TestClock from "effect/testing/TestClock"
import type { AgentReport, Alert } from "@scout/shared"
import { MetricsBroadcast, type BroadcastEvent } from "../../src/services/metrics-broadcast.js"

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

const makeReport = (systemId: string): AgentReport => ({
  systemId,
  timestamp: Date.now(),
  system: {
    cpu: {
      usage: 10,
      cores: 4,
      perCore: [10, 10, 10, 10],
      breakdown: { user: 5, system: 5, iowait: 0, steal: 0, idle: 90 },
    },
    memory: {
      used: 1024,
      total: 8192,
      available: 7168,
      buffersCache: 512,
      swap: { used: 0, total: 2048 },
    },
    disks: [],
    loadAvg: [0.1, 0.2, 0.3],
    uptime: 3600,
  },
  network: [],
})

const makeAlert = (id: string): Alert => ({
  id,
  ruleId: "rule-1",
  systemId: "sys-1",
  state: "active",
  severity: "warning",
  metric: "cpu.usage",
  value: 95,
  triggeredAt: Date.now(),
  acknowledgedAt: null,
  resolvedAt: null,
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run an effect with the MetricsBroadcast layer provided. */
const withBroadcast = <A, E>(
  eff: Effect.Effect<A, E, MetricsBroadcast>,
) => eff.pipe(Effect.provide(MetricsBroadcast.layer))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MetricsBroadcast", () => {
  it.effect(
    "coalescing — 3 rapid publishes become 1 batched event after 100ms",
    () =>
      withBroadcast(
        Effect.gen(function* () {
          const svc = yield* MetricsBroadcast

          // Subscribe before publishing so we receive messages
          const sub = yield* Effect.scoped(
            Effect.gen(function* () {
              const sub = yield* svc.subscribe()

              // Publish 3 reports without advancing the clock
              yield* svc.publishMetrics(makeReport("sys-1"))
              yield* svc.publishMetrics(makeReport("sys-2"))
              yield* svc.publishMetrics(makeReport("sys-3"))

              // Fork taking 1 event — this will suspend until the flush fires
              const fiber = yield* Effect.forkChild(PubSub.take(sub), {
                startImmediately: true,
              })

              // Advance clock 100ms — triggers the coalescing flush
              yield* TestClock.adjust("100 millis")

              const event = yield* Fiber.join(fiber)
              return event
            }),
          )

          const event = sub as BroadcastEvent
          expect(event.event).toBe("metrics.data")
          const reports = event.data as AgentReport[]
          expect(reports).toHaveLength(3)
          expect(reports.map((r) => r.systemId)).toEqual([
            "sys-1",
            "sys-2",
            "sys-3",
          ])
        }),
      ),
  )

  it.effect(
    "separate events when spaced apart — 3 publishes spaced 200ms each produce 3 events",
    () =>
      withBroadcast(
        Effect.gen(function* () {
          const svc = yield* MetricsBroadcast

          yield* Effect.scoped(
            Effect.gen(function* () {
              const sub = yield* svc.subscribe()

              const collectFiber = yield* Effect.gen(function* () {
                const e1 = yield* PubSub.take(sub)
                const e2 = yield* PubSub.take(sub)
                const e3 = yield* PubSub.take(sub)
                return [e1, e2, e3] as const
              }).pipe(Effect.forkChild({ startImmediately: true }))

              // Publish first metric and flush
              yield* svc.publishMetrics(makeReport("sys-1"))
              yield* TestClock.adjust("200 millis")

              // Publish second metric and flush
              yield* svc.publishMetrics(makeReport("sys-2"))
              yield* TestClock.adjust("200 millis")

              // Publish third metric and flush
              yield* svc.publishMetrics(makeReport("sys-3"))
              yield* TestClock.adjust("200 millis")

              const [e1, e2, e3] = yield* Fiber.join(collectFiber)

              expect(e1.event).toBe("metrics.data")
              expect((e1.data as AgentReport[])[0].systemId).toBe("sys-1")

              expect(e2.event).toBe("metrics.data")
              expect((e2.data as AgentReport[])[0].systemId).toBe("sys-2")

              expect(e3.event).toBe("metrics.data")
              expect((e3.data as AgentReport[])[0].systemId).toBe("sys-3")
            }),
          )
        }),
      ),
  )

  it.effect(
    "alerts bypass coalescing — received immediately without clock advance",
    () =>
      withBroadcast(
        Effect.gen(function* () {
          const svc = yield* MetricsBroadcast
          const alert = makeAlert("alert-1")

          yield* Effect.scoped(
            Effect.gen(function* () {
              const sub = yield* svc.subscribe()

              // Fork the take first so it's ready to receive
              const fiber = yield* Effect.forkChild(PubSub.take(sub), {
                startImmediately: true,
              })

              // Publish alert — should be delivered without advancing the clock
              yield* svc.publishAlert(alert)

              const event = yield* Fiber.join(fiber)

              expect(event.event).toBe("alert.triggered")
              expect((event.data as Alert).id).toBe("alert-1")
            }),
          )
        }),
      ),
  )

  it.effect("multiple subscribers — both receive the same batched event", () =>
    withBroadcast(
      Effect.gen(function* () {
        const svc = yield* MetricsBroadcast

        yield* Effect.scoped(
          Effect.gen(function* () {
            const sub1 = yield* svc.subscribe()
            const sub2 = yield* svc.subscribe()

            const fiber1 = yield* Effect.forkChild(PubSub.take(sub1), {
              startImmediately: true,
            })
            const fiber2 = yield* Effect.forkChild(PubSub.take(sub2), {
              startImmediately: true,
            })

            yield* svc.publishMetrics(makeReport("sys-1"))
            yield* TestClock.adjust("100 millis")

            const [e1, e2] = yield* Effect.all([
              Fiber.join(fiber1),
              Fiber.join(fiber2),
            ])

            expect(e1.event).toBe("metrics.data")
            expect(e2.event).toBe("metrics.data")
            // Both subscribers got the same payload
            expect(e1.data).toEqual(e2.data)
          }),
        )
      }),
    ))

  it.effect("subscriber count — tracks active subscriptions correctly", () =>
    withBroadcast(
      Effect.gen(function* () {
        const svc = yield* MetricsBroadcast

        // Initially no subscribers
        const countBefore = yield* svc.subscriberCount()
        expect(countBefore).toBe(0)

        // Open 2 subscribers and close them one at a time using nested scopes
        let countWith1 = 0
        let countWith2 = 0
        let countAfterSub2Closed = 0

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* svc.subscribe() // sub1

            countWith1 = yield* svc.subscriberCount()

            yield* Effect.scoped(
              Effect.gen(function* () {
                yield* svc.subscribe() // sub2

                countWith2 = yield* svc.subscriberCount()
              }),
            )

            // sub2 scope closed — sub1 still open
            countAfterSub2Closed = yield* svc.subscriberCount()
          }),
        )

        const countAfterBothClosed = yield* svc.subscriberCount()

        expect(countWith1).toBe(1)
        expect(countWith2).toBe(2)
        expect(countAfterSub2Closed).toBe(1)
        expect(countAfterBothClosed).toBe(0)
      }),
    ))
})
