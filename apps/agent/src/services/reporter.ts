import { Cause, Duration, Effect, Layer, Schedule } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import { AgentConfig } from "../config.js"
import { HubClient } from "../rpc/connection.js"
import { CollectorRegistry } from "./collector-registry.js"

// Runs on a schedule (every N seconds), collects all metrics, sends to hub.
export class Reporter extends ServiceMap.Service<Reporter, {
  /**
   * Long-running fiber: collect metrics on the configured interval and send
   * each AgentReport to the hub. Never resolves under normal operation.
   */
  readonly run: Effect.Effect<never>
}>()(
  "@scout/Reporter",
  {
    make: Effect.gen(function* () {
      const config = yield* AgentConfig.load
      const hub = yield* HubClient
      const registry = yield* CollectorRegistry

      const collectAndSend: Effect.Effect<void> =
        registry.collectAll().pipe(
          Effect.flatMap((report) =>
            hub["agent.report"](report).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Reporter: send failed", {
                  error: Cause.pretty(cause),
                }),
              ),
            ),
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("Reporter: tick failed", {
              error: Cause.pretty(cause),
            }),
          ),
        )

      const run: Effect.Effect<never> =
        collectAndSend.pipe(
          Effect.repeat(Schedule.spaced(Duration.seconds(config.interval))),
          Effect.flatMap(() => Effect.never),
        )

      return { run }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
