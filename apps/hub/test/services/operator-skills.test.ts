import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { defineOperatorSkill, defineOperator } from "@scout/plugin-sdk/operator"
import { ManagementError } from "@scout/shared"
import { OperatorSkills } from "../../src/services/operator-skills.js"
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
          skills: [
            defineOperatorSkill({
              id: "docker-ops",
              name: "Docker Operations",
              description: "Use Docker plugin capabilities before raw shell access.",
              content: "Prefer plugin.runAction and plugin.logs before bash.run.",
            }),
          ],
        }),
      } as never,
    ]),
  get: () => Effect.succeed(null),
  listHubPlugins: () => Effect.succeed([]),
  listWebPlugins: () => Effect.succeed([]),
  getOperatorPlugin: () => Effect.succeed(null),
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
          skills: [
            defineOperatorSkill({
              id: "docker-ops",
              name: "Docker Operations",
              description: "Use Docker plugin capabilities before raw shell access.",
              content: "Prefer plugin.runAction and plugin.logs before bash.run.",
            }),
          ],
        }),
      } as never,
    ]),
})

describe("OperatorSkills service", () => {
  it.effect("lists builtin skills in deterministic order", () =>
    Effect.gen(function* () {
      const skills = yield* OperatorSkills
      const list = yield* skills.list()

      expect(list.map((skill) => skill.id)).toEqual([
        "docker/docker-ops",
        "incident-triage",
        "plugin-ops",
      ])
      expect(list.find((skill) => skill.id === "incident-triage")?.source).toBe("builtin")
      expect(
        list.find((skill) => skill.id === "incident-triage")?.content.length,
      ).toBeGreaterThan(0)
      expect(list.find((skill) => skill.id === "docker/docker-ops")?.source).toBe("plugin")
    }).pipe(Effect.provide(OperatorSkills.layer.pipe(Layer.provide(PluginRegistryTestLayer)))),
  )

  it.effect("fails cleanly when a skill id is missing", () =>
    Effect.gen(function* () {
      const skills = yield* OperatorSkills
      const failure = yield* Effect.flip(skills.resolve(["missing-skill"]))

      expect(failure).toBeInstanceOf(ManagementError)
      expect(failure.message).toContain("missing-skill")
    }).pipe(Effect.provide(OperatorSkills.layer.pipe(Layer.provide(PluginRegistryTestLayer)))),
  )
})
