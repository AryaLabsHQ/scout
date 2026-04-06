import { constants as fsConstants } from "node:fs"
import { access } from "node:fs/promises"
import { Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import {
  loadPluginsFromDirectory,
  type LoadedPluginPackage,
  type ScoutAgentPlugin,
} from "@scout/plugin-sdk"
import { AgentConfig } from "../config.js"

export interface LoadedAgentPlugin extends LoadedPluginPackage {
  readonly agent: ScoutAgentPlugin
}

const isDirectoryReadable = (path: string) =>
  Effect.tryPromise({
    try: async () => {
      await access(path, fsConstants.R_OK)
      return true
    },
    catch: () => false,
  })

const hasAgentRuntime = (plugin: LoadedPluginPackage): plugin is LoadedAgentPlugin =>
  plugin.agent !== undefined

export class AgentPluginRegistry extends ServiceMap.Service<
  AgentPluginRegistry,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<LoadedPluginPackage>>
    readonly listAgentPlugins: () => Effect.Effect<ReadonlyArray<LoadedAgentPlugin>>
    readonly get: (pluginId: string) => Effect.Effect<LoadedPluginPackage | null>
    readonly getAgentPlugin: (pluginId: string) => Effect.Effect<LoadedAgentPlugin | null>
  }
>()(
  "@scout/AgentPluginRegistry",
  {
    make: Effect.gen(function* () {
      const config = yield* AgentConfig.load
      const hasDirectory = yield* isDirectoryReadable(config.pluginDir)
      const loadedPlugins: ReadonlyArray<LoadedPluginPackage> = hasDirectory
        ? yield* loadPluginsFromDirectory(config.pluginDir)
        : []

      yield* Effect.logInfo("AgentPluginRegistry: loaded plugins", {
        pluginDir: config.pluginDir,
        pluginIds: loadedPlugins.map((plugin) => plugin.manifest.id).join(","),
        pluginCount: String(loadedPlugins.length),
      })

      const pluginsById = new Map<string, LoadedPluginPackage>(
        loadedPlugins.map((plugin) => [plugin.manifest.id, plugin] as const),
      )
      const agentPlugins: ReadonlyArray<LoadedAgentPlugin> = loadedPlugins.filter(hasAgentRuntime)
      const agentPluginsById = new Map<string, LoadedAgentPlugin>(
        agentPlugins.map((plugin) => [plugin.manifest.id, plugin] as const),
      )

      return {
        list: () => Effect.succeed(loadedPlugins),
        listAgentPlugins: () => Effect.succeed(agentPlugins),
        get: (pluginId: string) => Effect.succeed(pluginsById.get(pluginId) ?? null),
        getAgentPlugin: (pluginId: string) =>
          Effect.succeed(agentPluginsById.get(pluginId) ?? null),
      }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
