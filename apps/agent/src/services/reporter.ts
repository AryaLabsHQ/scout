import { Cause, Duration, Effect, Layer, Schedule } from "effect"
import * as Context from "effect/Context"
import { AgentConfig } from "../config.js"
import { HubClient } from "../rpc/connection.js"
import { CollectorRegistry } from "./collector-registry.js"
import { AgentPluginHost } from "./plugin-host.js"

// Runs on a schedule (every N seconds), collects all metrics, sends to hub.
export class Reporter extends Context.Service<
  Reporter,
  {
    /**
     * Long-running fiber: collect metrics on the configured interval and send
     * each core metrics sample plus plugin collections to the hub.
     */
    readonly run: Effect.Effect<never>
  }
>()("@scout/Reporter", {
  make: Effect.gen(function* () {
    const config = yield* AgentConfig.load
    const hub = yield* HubClient
    const registry = yield* CollectorRegistry
    const pluginHost = yield* AgentPluginHost

    const collectAndSend: Effect.Effect<void> = Effect.gen(function* () {
      const capabilities = yield* registry.discover()
      const sample = yield* registry.collectAll(capabilities)
      const pluginCollections = yield* pluginHost.collectCollections()

      yield* hub["agent.report"]({
        systemId: config.hostname,
        sample,
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Reporter: core metrics send failed", {
            error: Cause.pretty(cause),
          }),
        ),
      )

      yield* Effect.forEach(
        pluginCollections,
        (collection) =>
          hub["agent.reportPluginCollection"]({
            systemId: config.hostname,
            collection,
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Reporter: plugin collection send failed", {
                error: Cause.pretty(cause),
              }),
            ),
          ),
        { concurrency: "unbounded", discard: true },
      )
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Reporter: tick failed", {
          error: Cause.pretty(cause),
        }),
      ),
    )

    const run: Effect.Effect<never> = collectAndSend.pipe(
      Effect.repeat(Schedule.spaced(Duration.seconds(config.interval))),
      Effect.flatMap(() => Effect.never),
    )

    return { run }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
