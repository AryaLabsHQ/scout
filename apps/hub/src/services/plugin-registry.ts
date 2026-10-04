import { constants as fsConstants } from "node:fs"
import { access } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Config, Effect, Layer } from "effect"
import * as Context from "effect/Context"
import {
  getLoadedPluginRuntimes,
  loadPluginsFromDirectory,
  type LoadedScoutPlugin,
  type ScoutOperatorSurface,
  type ScoutHubPlugin,
  type ScoutWebPlugin,
} from "@scout/plugin-sdk"

const DEFAULT_PLUGIN_DIR = fileURLToPath(new URL("../../../../packages", import.meta.url))

export interface LoadedHubPlugin extends LoadedScoutPlugin {
  readonly hub: ScoutHubPlugin
}

export interface LoadedWebPlugin extends LoadedScoutPlugin {
  readonly web: ScoutWebPlugin
}

export interface LoadedOperatorPlugin extends LoadedScoutPlugin {
  readonly operator: ScoutOperatorSurface
}

const isDirectoryReadable = (path: string): Effect.Effect<boolean> =>
  Effect.promise(() =>
    access(path, fsConstants.R_OK).then(
      () => true,
      () => false,
    ),
  )

const hasHubRuntime = (plugin: LoadedScoutPlugin): plugin is LoadedHubPlugin => plugin.hub !== undefined

const hasWebRuntime = (plugin: LoadedScoutPlugin): plugin is LoadedWebPlugin => plugin.web !== undefined

const hasOperatorRuntime = (plugin: LoadedScoutPlugin): plugin is LoadedOperatorPlugin =>
  plugin.operator !== undefined

export class PluginRegistry extends Context.Service<
  PluginRegistry,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<LoadedScoutPlugin>>
    readonly get: (pluginId: string) => Effect.Effect<LoadedScoutPlugin | null>
    readonly listHubPlugins: () => Effect.Effect<ReadonlyArray<LoadedHubPlugin>>
    readonly listWebPlugins: () => Effect.Effect<ReadonlyArray<LoadedWebPlugin>>
    readonly listOperatorPlugins: () => Effect.Effect<ReadonlyArray<LoadedOperatorPlugin>>
    readonly getOperatorPlugin: (pluginId: string) => Effect.Effect<LoadedOperatorPlugin | null>
  }
>()("@scout/PluginRegistry", {
  make: Effect.gen(function* () {
    const pluginDir = yield* Config.withDefault(Config.String("SCOUT_PLUGIN_DIR"), DEFAULT_PLUGIN_DIR)
    const hasDirectory = yield* isDirectoryReadable(pluginDir)
    const loadedPlugins: ReadonlyArray<LoadedScoutPlugin> = hasDirectory
      ? yield* loadPluginsFromDirectory(pluginDir)
      : []

    yield* Effect.logInfo("PluginRegistry: loaded plugins", {
      pluginDir,
      pluginIds: loadedPlugins.map((plugin) => plugin.manifest.id).join(","),
      pluginCount: String(loadedPlugins.length),
      pluginRuntimes: loadedPlugins
        .map((plugin) => `${plugin.manifest.id}=${getLoadedPluginRuntimes(plugin).join("|")}`)
        .join(","),
    })

    const pluginsById = new Map<string, LoadedScoutPlugin>(
      loadedPlugins.map((plugin) => [plugin.manifest.id, plugin] as const),
    )
    const hubPlugins: ReadonlyArray<LoadedHubPlugin> = loadedPlugins.filter(hasHubRuntime)
    const webPlugins: ReadonlyArray<LoadedWebPlugin> = loadedPlugins.filter(hasWebRuntime)
    const operatorPlugins: ReadonlyArray<LoadedOperatorPlugin> = loadedPlugins.filter(hasOperatorRuntime)
    const operatorPluginsById = new Map<string, LoadedOperatorPlugin>(
      operatorPlugins.map((plugin) => [plugin.manifest.id, plugin] as const),
    )

    return {
      list: () => Effect.succeed(loadedPlugins),
      get: (pluginId: string) => Effect.succeed(pluginsById.get(pluginId) ?? null),
      listHubPlugins: () => Effect.succeed(hubPlugins),
      listWebPlugins: () => Effect.succeed(webPlugins),
      listOperatorPlugins: () => Effect.succeed(operatorPlugins),
      getOperatorPlugin: (pluginId: string) => Effect.succeed(operatorPluginsById.get(pluginId) ?? null),
    }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
