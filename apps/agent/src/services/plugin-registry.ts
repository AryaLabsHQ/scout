import { constants as fsConstants } from "node:fs"
import { access } from "node:fs/promises"
import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { loadPluginsFromDirectory, type LoadedScoutPlugin, type ScoutAgentPlugin } from "@scout/plugin-sdk"
import { AgentConfig } from "../config.js"

export interface LoadedAgentPlugin extends LoadedScoutPlugin {
  readonly agent: ScoutAgentPlugin
}

const isDirectoryReadable = (path: string): Effect.Effect<boolean> =>
  Effect.promise(() =>
    access(path, fsConstants.R_OK).then(
      () => true,
      () => false,
    ),
  )

const hasAgentRuntime = (plugin: LoadedScoutPlugin): plugin is LoadedAgentPlugin => plugin.agent !== undefined

export class AgentPluginRegistry extends Context.Service<
  AgentPluginRegistry,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<LoadedScoutPlugin>>
    readonly listAgentPlugins: () => Effect.Effect<ReadonlyArray<LoadedAgentPlugin>>
    readonly get: (pluginId: string) => Effect.Effect<LoadedScoutPlugin | null>
    readonly getAgentPlugin: (pluginId: string) => Effect.Effect<LoadedAgentPlugin | null>
  }
>()("@scout/AgentPluginRegistry", {
  make: Effect.gen(function* () {
    const config = yield* AgentConfig.load
    const hasDirectory = yield* isDirectoryReadable(config.pluginDir)
    const loadedPlugins: ReadonlyArray<LoadedScoutPlugin> = hasDirectory
      ? yield* loadPluginsFromDirectory(config.pluginDir)
      : []

    yield* Effect.logInfo("AgentPluginRegistry: loaded plugins", {
      pluginDir: config.pluginDir,
      pluginIds: loadedPlugins.map((plugin) => plugin.manifest.id).join(","),
      pluginCount: String(loadedPlugins.length),
    })

    const pluginsById = new Map<string, LoadedScoutPlugin>(
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
      getAgentPlugin: (pluginId: string) => Effect.succeed(agentPluginsById.get(pluginId) ?? null),
    }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
