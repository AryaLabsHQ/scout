import { constants as fsConstants } from "node:fs"
import { access } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Config, Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import {
  loadPluginsFromDirectory,
  type LoadedPluginPackage,
  type ScoutHubPlugin,
  type ScoutWebPlugin,
} from "@scout/plugin-sdk"

const DEFAULT_PLUGIN_DIR = fileURLToPath(new URL("../../../../packages", import.meta.url))

export interface LoadedHubPlugin extends LoadedPluginPackage {
  readonly hub: ScoutHubPlugin
}

export interface LoadedWebPlugin extends LoadedPluginPackage {
  readonly web: ScoutWebPlugin
}

const isDirectoryReadable = (path: string) =>
  Effect.tryPromise({
    try: async () => {
      await access(path, fsConstants.R_OK)
      return true
    },
    catch: () => false,
  })

const hasHubRuntime = (plugin: LoadedPluginPackage): plugin is LoadedHubPlugin =>
  plugin.hub !== undefined

const hasWebRuntime = (plugin: LoadedPluginPackage): plugin is LoadedWebPlugin =>
  plugin.web !== undefined

export class PluginRegistry extends ServiceMap.Service<
  PluginRegistry,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<LoadedPluginPackage>>
    readonly get: (pluginId: string) => Effect.Effect<LoadedPluginPackage | null>
    readonly listHubPlugins: () => Effect.Effect<ReadonlyArray<LoadedHubPlugin>>
    readonly listWebPlugins: () => Effect.Effect<ReadonlyArray<LoadedWebPlugin>>
  }
>()(
  "@scout/PluginRegistry",
  {
    make: Effect.gen(function* () {
      const pluginDir = yield* Config.withDefault(
        Config.string("SCOUT_PLUGIN_DIR"),
        DEFAULT_PLUGIN_DIR,
      )
      const hasDirectory = yield* isDirectoryReadable(pluginDir)
      const loadedPlugins: ReadonlyArray<LoadedPluginPackage> = hasDirectory
        ? yield* loadPluginsFromDirectory(pluginDir)
        : []

      yield* Effect.logInfo("PluginRegistry: loaded plugins", {
        pluginDir,
        pluginIds: loadedPlugins.map((plugin) => plugin.manifest.id).join(","),
        pluginCount: String(loadedPlugins.length),
      })

      const pluginsById = new Map<string, LoadedPluginPackage>(
        loadedPlugins.map((plugin) => [plugin.manifest.id, plugin] as const),
      )
      const hubPlugins: ReadonlyArray<LoadedHubPlugin> = loadedPlugins.filter(hasHubRuntime)
      const webPlugins: ReadonlyArray<LoadedWebPlugin> = loadedPlugins.filter(hasWebRuntime)

      return {
        list: () => Effect.succeed(loadedPlugins),
        get: (pluginId: string) => Effect.succeed(pluginsById.get(pluginId) ?? null),
        listHubPlugins: () => Effect.succeed(hubPlugins),
        listWebPlugins: () => Effect.succeed(webPlugins),
      }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
