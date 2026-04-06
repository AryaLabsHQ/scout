import { Cause, Effect, Layer, Stream } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import type {
  ActionRequest,
  LogChunk,
  PluginCapability,
  PluginCollectionResult,
  PluginExecutionError,
  StreamRequest,
  StreamChunk,
} from "@scout/plugin-sdk"
import { executePluginAction, openPluginStream } from "@scout/plugin-sdk"
import { AgentConfig } from "../config.js"
import {
  AgentPluginRegistry,
  type LoadedAgentPlugin,
} from "./plugin-registry.js"

const isPluginDetected = (capability: PluginCapability): boolean =>
  capability.status === "available" || capability.status === "degraded"

const mapExecutionError = (error: PluginExecutionError) =>
  new Error(
    error.code === "invalid-target"
      ? "invalid-input"
      : error.code,
  )

export class AgentPluginHost extends ServiceMap.Service<
  AgentPluginHost,
  {
    readonly listCapabilities: () => Effect.Effect<ReadonlyArray<PluginCapability>>
    readonly collectCollections: () => Effect.Effect<ReadonlyArray<PluginCollectionResult>>
    readonly runAction: (
      request: ActionRequest,
    ) => Effect.Effect<unknown, Error>
    readonly openLogStream: (
      request: StreamRequest,
    ) => Effect.Effect<Stream.Stream<LogChunk, Error>, Error>
  }
>()(
  "@scout/AgentPluginHost",
  {
    make: Effect.gen(function* () {
      const config = yield* AgentConfig.load
      const registry = yield* AgentPluginRegistry

      const getLoadedAgentPlugins = () => registry.listAgentPlugins()

      const listCapabilities = (): Effect.Effect<ReadonlyArray<PluginCapability>> =>
        getLoadedAgentPlugins().pipe(
          Effect.flatMap((plugins) =>
            Effect.all(
              plugins.map((plugin): Effect.Effect<PluginCapability> =>
                plugin.agent.detect({ nodeId: config.hostname, now: Date.now() }).pipe(
                  Effect.catchCause((cause) =>
                    Effect.succeed({
                      pluginId: plugin.manifest.id,
                      version: plugin.manifest.version,
                      status: "degraded" as const,
                      features: [],
                      reason: Cause.pretty(cause),
                    } satisfies PluginCapability),
                  ),
                ),
              ),
              { concurrency: "unbounded" },
                ),
              ),
        )

      const collectCollections = (): Effect.Effect<ReadonlyArray<PluginCollectionResult>> =>
        Effect.gen(function* () {
          const plugins = yield* getLoadedAgentPlugins()
          const detectedPlugins = yield* Effect.all(
            plugins.map((plugin) =>
              plugin.agent.detect({ nodeId: config.hostname, now: Date.now() }).pipe(
                Effect.map((capability) => ({ plugin, detected: isPluginDetected(capability) })),
                Effect.orElseSucceed(() => ({ plugin, detected: false })),
              ),
            ),
            { concurrency: "unbounded" },
          )
          const enabledPlugins = detectedPlugins
            .filter((entry) => entry.detected)
            .map((entry) => entry.plugin)

          const collections = yield* Effect.all(
            enabledPlugins.flatMap((plugin) => {
              if (plugin.agent.collect === undefined) {
                return []
              }
              return [plugin.agent.collect({ nodeId: config.hostname, now: Date.now() }).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning(
                    `AgentPluginHost: plugin "${plugin.manifest.id}" failed, excluding from plugin collection`,
                    { error: String(cause) },
                  ).pipe(Effect.as(null as PluginCollectionResult | null)),
                ),
              )]
            }),
            { concurrency: "unbounded" },
          )

          return collections.filter(
            (collection): collection is PluginCollectionResult => collection !== null,
          )
        })

      const getPlugin = (pluginId: string): Effect.Effect<LoadedAgentPlugin, Error> =>
        registry.getAgentPlugin(pluginId).pipe(
          Effect.flatMap((plugin) =>
            plugin === null
              ? Effect.fail(new Error("plugin-not-loaded"))
              : Effect.succeed(plugin),
          ),
        )

      const runAction = (request: ActionRequest): Effect.Effect<unknown, Error> =>
        Effect.gen(function* () {
          const plugin = yield* getPlugin(request.pluginId)
          const result = yield* executePluginAction(
            plugin,
            {
              nodeId: config.hostname,
              permissions: new Set(plugin.manifest.permissions),
            },
            request,
          ).pipe(Effect.mapError((error) => mapExecutionError(error)))

          return result.output ?? {}
        })

      const openLogStream = (
        request: StreamRequest,
      ): Effect.Effect<Stream.Stream<LogChunk, Error>, Error> =>
        Effect.gen(function* () {
          const plugin = yield* getPlugin(request.pluginId)
          const stream = yield* openPluginStream(
            plugin,
            {
              nodeId: config.hostname,
              permissions: new Set(plugin.manifest.permissions),
            },
            request,
          ).pipe(Effect.mapError((error) => mapExecutionError(error)))

          return stream.pipe(
            Stream.mapEffect((chunk: StreamChunk) =>
              "lines" in chunk && Array.isArray(chunk.lines)
                ? Effect.succeed(chunk)
                : Effect.fail(new Error("invalid-log-stream")),
            ),
          ) as Stream.Stream<LogChunk, Error>
        })

      return {
        listCapabilities,
        collectCollections,
        runAction,
        openLogStream,
      }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
