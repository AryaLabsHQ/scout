import { describe, expect, it } from "vitest"
import { ConfigProvider, Effect, Layer } from "effect"
import { AgentPluginHost } from "../../src/services/plugin-host.js"
import {
  AgentPluginRegistry,
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
  manifestPath: "/plugins/systemd/manifest.ts",
  entrypoints: {
    agent: "/plugins/systemd/agent.ts",
  },
  manifest: {
    apiVersion: "v0alpha1",
    id: "systemd",
    displayName: "systemd",
    version: "0.0.1",
    description: "systemd test plugin",
    runtimes: ["agent"],
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
  AgentPluginHost.layer.pipe(
    Layer.provide(makeRegistryLayer(plugins)),
    Layer.provide(configLayer),
  )

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
