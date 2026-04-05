import { Effect, Layer, PubSub, Queue, Ref, Schedule } from "effect"
import type * as Scope from "effect/Scope"
import * as ServiceMap from "effect/ServiceMap"
import type { Alert, AgentReport } from "@scout/shared"

// PubSub fan-out for real-time metrics and alerts.
// Metrics are coalesced over a 100ms window before being published.
// Alerts bypass coalescing and are published immediately.

/**
 * Envelope for every broadcast event. Stream handlers in
 * `rpc/client-handlers.ts` match on `event` and pull typed values out of
 * `data`. Kept loosely-typed here because the producers below emit many
 * different shapes (AgentReport[], Alert, system rows, etc.).
 */
export interface BroadcastEvent {
  readonly event: string
  readonly data?: unknown
}

export class MetricsBroadcast extends ServiceMap.Service<MetricsBroadcast, {
  /**
   * Enqueue an AgentReport for coalesced broadcast.
   * Reports are batched over 100ms and published as a single event.
   */
  readonly publishMetrics: (report: AgentReport) => Effect.Effect<void>
  /**
   * Publish an alert immediately — bypasses the coalescing queue.
   * Uses "alert.triggered" event type.
   */
  readonly publishAlert: (alert: Alert) => Effect.Effect<void>
  /**
   * Publish an alert resolved event immediately — bypasses the coalescing queue.
   * Uses "alert.resolved" event type.
   */
  readonly publishAlertResolved: (alert: Alert) => Effect.Effect<void>
  /**
   * Subscribe to the fan-out PubSub.
   * The returned subscription is scoped — it auto-unsubscribes when the
   * caller's Scope closes.
   */
  readonly subscribe: () => Effect.Effect<PubSub.Subscription<BroadcastEvent>, never, Scope.Scope>
  /**
   * Current number of active subscribers.
   */
  readonly subscriberCount: () => Effect.Effect<number>
}>()(
  "@scout/MetricsBroadcast",
  {
    make: Effect.gen(function* () {
      // Main fan-out channel
      const hub = yield* PubSub.bounded<BroadcastEvent>(256)
      // Coalescing buffer — sliding so the newest reports survive overflow
      const buffer = yield* Queue.sliding<AgentReport>(16)
      // Track subscriber count manually (PubSub has no public API for this)
      const subCount = yield* Ref.make(0)

      // Background fiber: every 100ms drain the buffer and publish a batch
      const flushLoop = Effect.repeat(
        Effect.gen(function* () {
          const reports = yield* Queue.clear(buffer)
          if (reports.length > 0) {
            const event: BroadcastEvent = { event: "metrics.data", data: reports }
            yield* PubSub.publish(hub, event)
          }
        }),
        Schedule.spaced("100 millis"),
      )

      // Start the flush fiber tied to this layer's scope
      yield* Effect.forkScoped(flushLoop)

      return {
        publishMetrics: (report: AgentReport) =>
          Queue.offer(buffer, report).pipe(Effect.asVoid),

        publishAlert: (alert: Alert) => {
          const event: BroadcastEvent = { event: "alert.triggered", data: alert }
          return PubSub.publish(hub, event).pipe(Effect.asVoid)
        },

        publishAlertResolved: (alert: Alert) => {
          const event: BroadcastEvent = { event: "alert.resolved", data: alert }
          return PubSub.publish(hub, event).pipe(Effect.asVoid)
        },

        subscribe: () =>
          Effect.gen(function* () {
            yield* Ref.update(subCount, (n) => n + 1)
            const sub = yield* PubSub.subscribe(hub)
            // Decrement count when the scope closes
            yield* Effect.addFinalizer((_exit) => Ref.update(subCount, (n) => n - 1))
            return sub
          }),

        subscriberCount: () => Ref.get(subCount),
      }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
