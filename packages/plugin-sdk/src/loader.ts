import { Effect } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  decodePluginManifest,
  type PluginManifest,
  PluginLoadError,
  type PluginRuntime,
} from "./schemas.js"
import type {
  ScoutAgentPlugin,
  ScoutHubPlugin,
  ScoutWebPlugin,
} from "./runtime.js"

type EntrypointKind = PluginRuntime | "manifest"

const ENTRYPOINT_CANDIDATES: Record<EntrypointKind, string[]> = {
  manifest: [
    "manifest.ts",
    "manifest.js",
    "manifest.mjs",
    path.join("src", "manifest.ts"),
    path.join("src", "manifest.js"),
    path.join("src", "manifest.mjs"),
  ],
  agent: [
    "agent.ts",
    "agent.js",
    "agent.mjs",
    path.join("src", "agent.ts"),
    path.join("src", "agent.js"),
    path.join("src", "agent.mjs"),
  ],
  hub: [
    "hub.ts",
    "hub.js",
    "hub.mjs",
    path.join("src", "hub.ts"),
    path.join("src", "hub.js"),
    path.join("src", "hub.mjs"),
  ],
  web: [
    "web.ts",
    "web.js",
    "web.mjs",
    path.join("src", "web.ts"),
    path.join("src", "web.js"),
    path.join("src", "web.mjs"),
  ],
}

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

const resolveEntrypoint = (
  rootDir: string,
  kind: EntrypointKind,
): Effect.Effect<string | null, PluginLoadError> =>
  Effect.gen(function* () {
    for (const relativePath of ENTRYPOINT_CANDIDATES[kind]) {
      const candidate = path.join(rootDir, relativePath)
      const stat = yield* statIfExists(candidate)
      if (stat?.isFile()) return candidate
    }
    return null
  })

const hasEntrypoint = (
  rootDir: string,
  kind: EntrypointKind,
): Effect.Effect<boolean, PluginLoadError> =>
  resolveEntrypoint(rootDir, kind).pipe(
    Effect.map((entrypoint) => entrypoint !== null),
  )

const pickManifestExport = (module: Record<string, unknown>) =>
  module["manifest"] ?? module["default"] ?? null

const pickRuntimeExport = <T>(module: Record<string, unknown>, runtime: PluginRuntime): T | null => {
  const named = module[runtime]
  if (named !== undefined) return named as T
  const fallback = module["default"]
  return fallback !== undefined ? (fallback as T) : null
}

export interface LoadedPluginManifest {
  readonly rootDir: string
  readonly manifestPath: string
  readonly manifest: PluginManifest
}

export interface LoadedPluginPackage {
  readonly rootDir: string
  readonly manifestPath: string
  readonly entrypoints: Partial<Record<PluginRuntime, string>>
  readonly manifest: PluginManifest
  readonly agent?: ScoutAgentPlugin
  readonly hub?: ScoutHubPlugin
  readonly web?: ScoutWebPlugin
}

export const loadPluginManifest = (
  rootDir: string,
): Effect.Effect<LoadedPluginManifest, PluginLoadError> =>
  Effect.gen(function* () {
    const manifestPath = yield* resolveEntrypoint(rootDir, "manifest")
    if (manifestPath === null) {
      return yield* Effect.fail(
        failLoad("manifest-not-found", "Plugin manifest entrypoint not found", {
          path: rootDir,
        }),
      )
    }

    const module = yield* importModule(manifestPath)
    const rawManifest = pickManifestExport(module as Record<string, unknown>)
    if (rawManifest === null) {
      return yield* Effect.fail(
        failLoad("manifest-export-missing", "Plugin manifest module exports no manifest", {
          path: manifestPath,
        }),
      )
    }

    const manifest = yield* decodePluginManifest(rawManifest).pipe(
      Effect.mapError((cause) =>
        failLoad("manifest-invalid", `Plugin manifest failed validation: ${String(cause)}`, {
          path: manifestPath,
        }),
      ),
    )

    return {
      rootDir,
      manifestPath,
      manifest,
    }
  })

export const loadPluginPackage = (
  rootDir: string,
): Effect.Effect<LoadedPluginPackage, PluginLoadError> =>
  Effect.gen(function* () {
    const loadedManifest = yield* loadPluginManifest(rootDir)
    const entrypoints: Partial<Record<PluginRuntime, string>> = {}
    let agent: ScoutAgentPlugin | undefined
    let hub: ScoutHubPlugin | undefined
    let web: ScoutWebPlugin | undefined

    for (const runtime of loadedManifest.manifest.runtimes) {
      const entryPath = yield* resolveEntrypoint(rootDir, runtime)
      if (entryPath === null) {
        return yield* Effect.fail(
          failLoad(
            "runtime-entrypoint-missing",
            `Plugin ${loadedManifest.manifest.id} is missing a ${runtime} entrypoint`,
            { pluginId: loadedManifest.manifest.id, path: rootDir },
          ),
        )
      }

      const module = yield* importModule(entryPath)
      entrypoints[runtime] = entryPath

      switch (runtime) {
        case "agent": {
          const runtimeExport = pickRuntimeExport<ScoutAgentPlugin>(
            module as Record<string, unknown>,
            runtime,
          )
          if (runtimeExport === null) {
            return yield* Effect.fail(
              failLoad("runtime-export-missing", "Agent runtime entrypoint exports no plugin", {
                pluginId: loadedManifest.manifest.id,
                path: entryPath,
              }),
            )
          }
          agent = runtimeExport
          break
        }
        case "hub": {
          const runtimeExport = pickRuntimeExport<ScoutHubPlugin>(
            module as Record<string, unknown>,
            runtime,
          )
          if (runtimeExport === null) {
            return yield* Effect.fail(
              failLoad("runtime-export-missing", "Hub runtime entrypoint exports no plugin", {
                pluginId: loadedManifest.manifest.id,
                path: entryPath,
              }),
            )
          }
          hub = runtimeExport
          break
        }
        case "web": {
          const runtimeExport = pickRuntimeExport<ScoutWebPlugin>(
            module as Record<string, unknown>,
            runtime,
          )
          if (runtimeExport === null) {
            return yield* Effect.fail(
              failLoad("runtime-export-missing", "Web runtime entrypoint exports no plugin", {
                pluginId: loadedManifest.manifest.id,
                path: entryPath,
              }),
            )
          }
          web = runtimeExport
          break
        }
      }
    }

    return {
      rootDir,
      manifestPath: loadedManifest.manifestPath,
      entrypoints,
      manifest: loadedManifest.manifest,
      ...(agent !== undefined && { agent }),
      ...(hub !== undefined && { hub }),
      ...(web !== undefined && { web }),
    }
  })

export const discoverPluginRoots = (
  pluginDirectory: string,
): Effect.Effect<ReadonlyArray<string>, PluginLoadError> =>
  Effect.gen(function* () {
    const entries = yield* Effect.tryPromise({
      try: async () => fs.readdir(pluginDirectory),
      catch: (cause) =>
        failLoad(
          "plugin-directory-read-failed",
          `Failed to read plugin directory: ${String(cause)}`,
          { path: pluginDirectory },
        ),
    })

    const directoryEntries = yield* Effect.all(
      entries.map((entry) =>
        Effect.gen(function* () {
          const candidate = path.join(pluginDirectory, entry)
          const stat = yield* statIfExists(candidate)
          if (!stat?.isDirectory()) return null

          const hasManifest = yield* hasEntrypoint(candidate, "manifest")
          return hasManifest ? candidate : null
        }),
      ),
      { concurrency: "unbounded" },
    )

    return directoryEntries
      .filter((entry): entry is string => entry !== null)
      .sort()
  })

export const loadPluginsFromDirectory = (
  pluginDirectory: string,
): Effect.Effect<ReadonlyArray<LoadedPluginPackage>, PluginLoadError> =>
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
