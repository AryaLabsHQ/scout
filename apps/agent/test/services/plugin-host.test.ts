import { describe, expect, it } from "vitest"
import { ConfigProvider, Effect, Layer } from "effect"
import { AgentPluginHost } from "../../src/services/plugin-host.js"
import {
  AgentPluginRegistry,
  makeAgentPluginRegistry,
  type LoadedAgentPlugin,
} from "../../src/services/plugin-registry.js"

const configLayer = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    SCOUT_HUB_URL: "http://hub.local",
    SCOUT_TOKEN: "test-token",
    SCOUT_HOSTNAME: "node-1",
  }),
)

const makeSystemdPlugin = (): LoadedAgentPlugin => ({
  rootDir: "/plugins/systemd",
  pluginPath: "/plugins/systemd/src/plugin.ts",
  manifest: {
    apiVersion: "v0alpha1",
    id: "systemd",
    displayName: "systemd",
    version: "0.0.1",
    description: "systemd test plugin",
    permissions: ["node:systemd", "node:stream-logs"],
    capabilities: [],
    entityKinds: [],
    metrics: [],
    actions: [],
    streams: [],
    alerts: [],
  },
  agent: {
    detect: () =>
      Effect.succeed({
        pluginId: "systemd",
        version: "0.0.1",
        status: "available",
        features: [],
      }),
    collect: () =>
      Effect.succeed({
        entities: [
          {
            ref: {
              pluginId: "systemd",
              kind: "systemd.unit",
              nodeId: "node-1",
              id: "nginx.service",
            },
            ts: 1,
            displayName: "Nginx",
            status: "active",
          },
        ],
        metrics: [
          {
            pluginId: "systemd",
            metricId: "units.total",
            ts: 1,
            value: 1,
          },
        ],
      }),
  },
})

const makeRegistryLayer = (plugins: ReadonlyArray<LoadedAgentPlugin>) =>
  Layer.succeed(AgentPluginRegistry, {
    list: () => Effect.succeed(plugins),
    listAgentPlugins: () => Effect.succeed(plugins),
    get: (pluginId: string) =>
      Effect.succeed(plugins.find((plugin) => plugin.manifest.id === pluginId) ?? null),
    getAgentPlugin: (pluginId: string) =>
      Effect.succeed(plugins.find((plugin) => plugin.manifest.id === pluginId) ?? null),
  })

const makeHostLayer = (plugins: ReadonlyArray<LoadedAgentPlugin>) =>
  AgentPluginHost.layer.pipe(Layer.provide(makeRegistryLayer(plugins)), Layer.provide(configLayer))

describe("AgentPluginHost.collectCollections", () => {
  it("returns plugin-native collections for detected plugins", async () => {
    const collections = await Effect.runPromise(
      Effect.gen(function* () {
        const host = yield* AgentPluginHost
        return yield* host.collectCollections()
      }).pipe(Effect.provide(makeHostLayer([makeSystemdPlugin()]))),
    )

    expect(collections).toHaveLength(1)
    expect(collections[0]?.entities?.[0]?.ref.id).toBe("nginx.service")
    expect(collections[0]?.metrics?.[0]?.metricId).toBe("units.total")
  })

  it("skips plugins that report unsupported", async () => {
    const unsupportedPlugin = {
      ...makeSystemdPlugin(),
      agent: {
        ...makeSystemdPlugin().agent,
        detect: () =>
          Effect.succeed({
            pluginId: "systemd",
            version: "0.0.1",
            status: "unsupported" as const,
            features: [],
          }),
      },
    } satisfies LoadedAgentPlugin

    const collections = await Effect.runPromise(
      Effect.gen(function* () {
        const host = yield* AgentPluginHost
        return yield* host.collectCollections()
      }).pipe(Effect.provide(makeHostLayer([unsupportedPlugin]))),
    )

    expect(collections).toEqual([])
  })
})

const makeDegradedPlugin = (pluginId: string): LoadedAgentPlugin => {
  const base = makeSystemdPlugin()
  return {
    ...base,
    rootDir: `/plugins/${pluginId}`,
    pluginPath: `/plugins/${pluginId}/src/plugin.ts`,
    manifest: { ...base.manifest, id: pluginId, displayName: pluginId },
    agent: {
      detect: () =>
        Effect.succeed({
          pluginId,
          version: "0.0.1",
          status: "degraded" as const,
          features: [],
          reason: "cluster unreachable",
        }),
      collect: () => Effect.die(new Error("cluster unreachable")),
    },
  }
}

const withCallCounts = (plugin: LoadedAgentPlugin) => {
  const calls = { detect: 0, collect: 0 }
  const { detect, collect } = plugin.agent
  const counted: LoadedAgentPlugin = {
    ...plugin,
    agent: {
      ...plugin.agent,
      detect: (ctx) => {
        calls.detect += 1
        return detect(ctx)
      },
      ...(collect === undefined
        ? {}
        : {
            collect: (ctx: Parameters<typeof collect>[0]) => {
              calls.collect += 1
              return collect(ctx)
            },
          }),
    },
  }
  return { plugin: counted, calls }
}

const makeFilteredHostLayer = (
  plugins: ReadonlyArray<LoadedAgentPlugin>,
  pluginsDisable: ReadonlyArray<string>,
) =>
  AgentPluginHost.layer.pipe(
    Layer.provide(Layer.effect(AgentPluginRegistry, makeAgentPluginRegistry(plugins, pluginsDisable))),
    Layer.provide(configLayer),
  )

describe("SCOUT_PLUGINS_DISABLE", () => {
  const plugins = [makeSystemdPlugin(), makeDegradedPlugin("@scout/plugin-example")]

  it("omits disabled plugins from capabilities and collections while keeping the rest", async () => {
    const enabled = withCallCounts(makeSystemdPlugin())
    const disabled = withCallCounts(makeDegradedPlugin("@scout/plugin-example"))
    const { capabilities, collections, action } = await Effect.runPromise(
      Effect.gen(function* () {
        const host = yield* AgentPluginHost
        return {
          capabilities: yield* host.listCapabilities(),
          collections: yield* host.collectCollections(),
          action: yield* host
            .runAction({ pluginId: "@scout/plugin-example", actionId: "noop", target: { nodeId: "node-1" } })
            .pipe(Effect.flip),
        }
      }).pipe(
        Effect.provide(makeFilteredHostLayer([enabled.plugin, disabled.plugin], ["@scout/plugin-example"])),
      ),
    )

    expect(disabled.calls).toEqual({ detect: 0, collect: 0 })
    expect(enabled.calls.detect).toBeGreaterThan(0)
    expect(enabled.calls.collect).toBe(1)

    expect(capabilities.map((capability) => capability.pluginId)).toEqual(["systemd"])
    expect(collections).toHaveLength(1)
    expect(collections[0]?.entities?.[0]?.ref.pluginId).toBe("systemd")
    expect(action.message).toBe("Requested plugin is not loaded")
  })

  it("still advertises every plugin when nothing is disabled", async () => {
    const capabilities = await Effect.runPromise(
      Effect.gen(function* () {
        const host = yield* AgentPluginHost
        return yield* host.listCapabilities()
      }).pipe(Effect.provide(makeFilteredHostLayer(plugins, []))),
    )

    expect(capabilities.map((capability) => capability.pluginId)).toEqual([
      "systemd",
      "@scout/plugin-example",
    ])
  })

  it("fails startup when an id does not match a loaded plugin", async () => {
    const error = await Effect.runPromise(
      makeAgentPluginRegistry(plugins, ["systemd", "example"]).pipe(Effect.flip),
    )

    expect(error.message).toContain("unknown plugin id(s): example")
    expect(error.message).toContain("Loaded plugin ids: systemd, @scout/plugin-example")
  })

  it("reads the list from config and fails the registry layer for unknown ids", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* AgentPluginRegistry
      }).pipe(
        Effect.provide(
          AgentPluginRegistry.layer.pipe(
            Layer.provide(
              ConfigProvider.layer(
                ConfigProvider.fromUnknown({
                  SCOUT_HUB_URL: "http://hub.local",
                  SCOUT_TOKEN: "test-token",
                  SCOUT_PLUGIN_DIR: "/nonexistent/scout-plugins",
                  SCOUT_PLUGINS_DISABLE: " missing-plugin , ",
                }),
              ),
            ),
          ),
        ),
        Effect.flip,
      ),
    )

    expect(String(error)).toContain("unknown plugin id(s): missing-plugin")
    expect(String(error)).toContain("Loaded plugin ids: (none)")
  })
})
