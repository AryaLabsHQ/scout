import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { defineOperator } from "@scout/plugin-sdk/operator"
import { OperatorExtensions } from "../../src/services/operator-extensions.js"
import { PluginRegistry } from "../../src/services/plugin-registry.js"

const PluginRegistryTestLayer = Layer.succeed(PluginRegistry, {
  list: () =>
    Effect.succeed([
      {
        rootDir: "/tmp/plugins/docker",
        pluginPath: "/tmp/plugins/docker/src/plugin.ts",
        manifest: {
          id: "docker",
          displayName: "Docker",
        } as never,
        operator: defineOperator({
          hooks: {
            beforePrompt: () => Effect.succeed("Docker operator hint"),
          },
        }),
      },
      {
        rootDir: "/tmp/plugins/systemd",
        pluginPath: "/tmp/plugins/systemd/src/plugin.ts",
        manifest: {
          id: "systemd",
          displayName: "Systemd",
        } as never,
        operator: defineOperator({}),
      },
    ]),
  get: () => Effect.succeed(null),
  listHubPlugins: () => Effect.succeed([]),
  listWebPlugins: () => Effect.succeed([]),
  listOperatorPlugins: () =>
    Effect.succeed([
      {
        rootDir: "/tmp/plugins/docker",
        pluginPath: "/tmp/plugins/docker/src/plugin.ts",
        manifest: {
          id: "docker",
          displayName: "Docker",
        } as never,
        operator: defineOperator({
          hooks: {
            beforePrompt: () => Effect.succeed("Docker operator hint"),
          },
        }),
      },
      {
        rootDir: "/tmp/plugins/systemd",
        pluginPath: "/tmp/plugins/systemd/src/plugin.ts",
        manifest: {
          id: "systemd",
          displayName: "Systemd",
        } as never,
        operator: defineOperator({}),
      },
    ]),
  getOperatorPlugin: () => Effect.succeed(null),
})

describe("OperatorExtensions service", () => {
  it.effect("plugin bridge contributes a bounded prompt section", () =>
    Effect.gen(function* () {
      const extensions = yield* OperatorExtensions
      const sections = yield* extensions.beforePrompt({
        session: {
          id: "session-1",
          title: "Operator session",
          status: "active",
          selectedNodeIds: ["node-a"],
          attachedSkillIds: [],
          approvalMode: "confirm_each_mutation",
          planMode: "off",
          modelProviderId: "openai",
          modelId: "gpt-5.4",
        },
        attachedSkillContents: [],
      })

      expect(sections).toHaveLength(2)
      expect(sections[0]).toContain("Known plugin ids: docker, systemd")
      expect(sections[0]).toContain("observe_plugins")
      expect(sections[1]).toBe("Docker operator hint")
    }).pipe(Effect.provide(OperatorExtensions.layer.pipe(Layer.provide(PluginRegistryTestLayer)))),
  )
})
