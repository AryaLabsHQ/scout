import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  discoverPluginRoots,
  loadPluginManifest,
  loadPluginPackage,
  loadPluginsFromDirectory,
  PluginLoadError,
} from "../src/index.js"

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures")

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

describe("@scout/plugin-sdk loader", () => {
  it("discovers plugin roots in a directory", async () => {
    const roots = await run(discoverPluginRoots(fixturesDir))
    expect(roots.some((root) => root.endsWith("valid-plugin"))).toBe(true)
  })

  it("supports symlinked plugin roots for monorepo development", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scout-plugin-loader-"))
    const linkPath = path.join(tempRoot, "fixture-valid")

    try {
      await fs.symlink(path.join(fixturesDir, "valid-plugin"), linkPath)
      const roots = await run(discoverPluginRoots(tempRoot))
      expect(roots).toEqual([linkPath])
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  it("skips directories without plugin entrypoints", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scout-plugin-loader-"))
    const pluginRoot = path.join(tempRoot, "fixture-valid")
    const nonPluginRoot = path.join(tempRoot, "not-a-plugin")

    try {
      await fs.symlink(path.join(fixturesDir, "valid-plugin"), pluginRoot)
      await fs.mkdir(nonPluginRoot)
      const roots = await run(discoverPluginRoots(tempRoot))
      expect(roots).toEqual([pluginRoot])
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  it("loads and validates a unified plugin manifest from the canonical plugin entrypoint", async () => {
    const loaded = await run(loadPluginManifest(path.join(fixturesDir, "valid-plugin")))

    expect(loaded.manifest.id).toBe("fixture-valid")
    expect(loaded.pluginPath).toContain("plugin.ts")
  })

  it("loads a full unified plugin package", async () => {
    const plugin = await run(loadPluginPackage(path.join(fixturesDir, "valid-plugin")))

    expect(plugin.manifest.id).toBe("fixture-valid")
    expect(plugin.agent).toBeDefined()
    expect(plugin.hub).toBeDefined()
    expect(plugin.web).toBeDefined()
    expect(plugin.operator).toBeDefined()
    expect(plugin.web?.screens).toHaveLength(1)
  })

  it("rejects duplicate plugin ids in a plugin directory", async () => {
    await expect(run(loadPluginsFromDirectory(path.join(fixturesDir, "duplicates")))).rejects.toBeInstanceOf(
      PluginLoadError,
    )
  })

  it("rejects invalid plugin manifests", async () => {
    await expect(run(loadPluginManifest(path.join(fixturesDir, "invalid-plugin")))).rejects.toBeInstanceOf(
      PluginLoadError,
    )
  })
})
