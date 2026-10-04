import { Effect } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { decodePluginManifest, PluginLoadError } from "./schemas.js"
import type { LoadedScoutPlugin, ScoutPlugin } from "./runtime.js"

const PLUGIN_ENTRYPOINT_CANDIDATES = [
  "plugin.ts",
  "plugin.js",
  "plugin.mjs",
  path.join("src", "plugin.ts"),
  path.join("src", "plugin.js"),
  path.join("src", "plugin.mjs"),
]

const failLoad = (code: string, message: string, opts?: { pluginId?: string; path?: string }) =>
  new PluginLoadError({
    code,
    message,
    ...(opts?.pluginId !== undefined && { pluginId: opts.pluginId }),
    ...(opts?.path !== undefined && { path: opts.path }),
  })

const importModule = (entryPath: string) =>
  Effect.tryPromise({
    try: async () => import(pathToFileURL(entryPath).href),
    catch: (cause) =>
      failLoad("import-failed", `Failed to import plugin module: ${String(cause)}`, {
        path: entryPath,
      }),
  })

const statIfExists = (filePath: string) =>
  Effect.tryPromise({
    try: async () => {
      try {
        return await fs.stat(filePath)
      } catch {
        return null
      }
    },
    catch: (cause) =>
      failLoad("fs-error", `Failed to stat plugin path: ${String(cause)}`, {
        path: filePath,
      }),
  })

const resolvePluginEntrypoint = (rootDir: string): Effect.Effect<string | null, PluginLoadError> =>
  Effect.gen(function* () {
    for (const relativePath of PLUGIN_ENTRYPOINT_CANDIDATES) {
      const candidate = path.join(rootDir, relativePath)
      const stat = yield* statIfExists(candidate)
      if (stat?.isFile()) {
        return candidate
      }
    }
    return null
  })

const hasPluginEntrypoint = (rootDir: string): Effect.Effect<boolean, PluginLoadError> =>
  resolvePluginEntrypoint(rootDir).pipe(Effect.map((entrypoint) => entrypoint !== null))

const pickPluginExport = (module: Record<string, unknown>) => module["plugin"] ?? module["default"] ?? null

export const loadPluginPackage = (rootDir: string): Effect.Effect<LoadedScoutPlugin, PluginLoadError> =>
  Effect.gen(function* () {
    const pluginPath = yield* resolvePluginEntrypoint(rootDir)
    if (pluginPath === null) {
      return yield* Effect.fail(
        failLoad("plugin-entrypoint-not-found", "Plugin entrypoint not found", {
          path: rootDir,
        }),
      )
    }

    const module = yield* importModule(pluginPath)
    const rawPlugin = pickPluginExport(module as Record<string, unknown>)
    if (rawPlugin === null || typeof rawPlugin !== "object") {
      return yield* Effect.fail(
        failLoad("plugin-export-missing", "Plugin module exports no plugin definition", {
          path: pluginPath,
        }),
      )
    }

    const plugin = rawPlugin as ScoutPlugin
    const manifest = yield* decodePluginManifest(plugin.manifest).pipe(
      Effect.mapError((cause) =>
        failLoad("manifest-invalid", `Plugin manifest failed validation: ${String(cause)}`, {
          path: pluginPath,
        }),
      ),
    )

    return {
      ...plugin,
      manifest,
      rootDir,
      pluginPath,
    } satisfies LoadedScoutPlugin
  })

export const loadPluginManifest = (rootDir: string) =>
  loadPluginPackage(rootDir).pipe(
    Effect.map(({ rootDir, pluginPath, manifest }) => ({
      rootDir,
      pluginPath,
      manifest,
    })),
  )

export const discoverPluginRoots = (
  pluginDirectory: string,
): Effect.Effect<ReadonlyArray<string>, PluginLoadError> =>
  Effect.gen(function* () {
    const entries = yield* Effect.tryPromise({
      try: async () => fs.readdir(pluginDirectory),
      catch: (cause) =>
        failLoad("plugin-directory-read-failed", `Failed to read plugin directory: ${String(cause)}`, {
          path: pluginDirectory,
        }),
    })

    const directoryEntries = yield* Effect.all(
      entries.map((entry) =>
        Effect.gen(function* () {
          const candidate = path.join(pluginDirectory, entry)
          const stat = yield* statIfExists(candidate)
          if (!stat?.isDirectory()) return null

          const hasPlugin = yield* hasPluginEntrypoint(candidate)
          return hasPlugin ? candidate : null
        }),
      ),
      { concurrency: "unbounded" },
    )

    return directoryEntries.filter((entry): entry is string => entry !== null).sort()
  })

export const loadPluginsFromDirectory = (
  pluginDirectory: string,
): Effect.Effect<ReadonlyArray<LoadedScoutPlugin>, PluginLoadError> =>
  Effect.gen(function* () {
    const roots = yield* discoverPluginRoots(pluginDirectory)
    const loadedPlugins = yield* Effect.all(roots.map((root) => loadPluginPackage(root)))

    const seen = new Map<string, string>()
    for (const plugin of loadedPlugins) {
      const existing = seen.get(plugin.manifest.id)
      if (existing !== undefined) {
        return yield* Effect.fail(
          failLoad(
            "duplicate-plugin-id",
            `Duplicate plugin id "${plugin.manifest.id}" found in plugin directory`,
            { pluginId: plugin.manifest.id, path: `${existing} :: ${plugin.rootDir}` },
          ),
        )
      }
      seen.set(plugin.manifest.id, plugin.rootDir)
    }

    return loadedPlugins
  })
