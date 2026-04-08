import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { ManagementError, type OperatorResource, type OperatorSkill } from "@scout/shared"
import type { ThinkingLevel } from "@mariozechner/pi-agent-core"
import { OperatorExtensions } from "../../src/services/operator-extensions.js"
import {
  OperatorModelRegistry,
  type OperatorResolvedModelConfig,
} from "../../src/services/operator-model-registry.js"
import { OperatorResources } from "../../src/services/operator-resources.js"
import { OperatorSessionManager } from "../../src/services/operator-session-manager.js"
import { OperatorSessions } from "../../src/services/operator-sessions.js"
import { OperatorSkills } from "../../src/services/operator-skills.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"

const SKILLS: ReadonlyArray<OperatorSkill> = [
  {
    id: "incident-triage",
    name: "Incident Triage",
    description: "Investigate incidents with a structured operational flow.",
    source: "builtin",
    content: "Always start by checking alerts, metrics, and recent changes.",
  },
  {
    id: "plugin-ops",
    name: "Plugin Ops",
    description: "Use plugin discovery before plugin actions.",
    source: "builtin",
    content: "Prefer observe.plugins before plugin.runAction or plugin.logs.",
  },
]

const RESOURCES: ReadonlyArray<OperatorResource> = [
  {
    id: "docker/capabilities",
    title: "Docker Operator Capabilities",
    description: "Summary of Docker-specific operator affordances.",
    source: "plugin",
    content: "Prefer Docker plugin actions and logs before raw shell access.",
  },
]

const resolvedModelConfig: OperatorResolvedModelConfig = {
  providerId: "openai",
  modelId: "gpt-5.4",
  model: {
    id: "gpt-5.4",
    provider: "openai",
    api: "responses",
  } as never,
  systemPrompt: "You are Scout, an operator.",
  thinkingLevel: "medium" satisfies ThinkingLevel,
}

const OperatorSessionsTestLayer = OperatorSessions.layer.pipe(
  Layer.provide(TestDatabaseLayer),
)

const OperatorSkillsTestLayer = Layer.succeed(OperatorSkills, {
  list: () => Effect.succeed(SKILLS),
  resolve: (skillIds: ReadonlyArray<string>) =>
    Effect.forEach(skillIds, (skillId) => {
      const skill = SKILLS.find((candidate) => candidate.id === skillId)
      return skill === undefined
        ? Effect.fail(
            new ManagementError({
              code: "operator-skill-missing",
              message: `Operator skill ${skillId} is not available`,
            }),
          )
        : Effect.succeed(skill)
    }),
})

const OperatorModelRegistryTestLayer = Layer.succeed(OperatorModelRegistry, {
  list: () =>
    Effect.succeed([
      {
        providerId: resolvedModelConfig.providerId,
        modelId: resolvedModelConfig.modelId,
        label: `${resolvedModelConfig.providerId}/${resolvedModelConfig.modelId}`,
        reasoning: true,
      },
    ]),
  getDefault: Effect.succeed(resolvedModelConfig),
  resolveSession: () => Effect.succeed(resolvedModelConfig),
})

const OperatorResourcesTestLayer = Layer.succeed(OperatorResources, {
  list: () => Effect.succeed(RESOURCES),
  resolve: (resourceIds: ReadonlyArray<string>) =>
    Effect.succeed(
      resourceIds.map((resourceId) => {
        const resource = RESOURCES.find((candidate) => candidate.id === resourceId)
        if (resource === undefined) {
          throw new Error(`Operator resource ${resourceId} is not available`)
        }
        return resource
      }),
    ),
})

const OperatorExtensionsTestLayer = Layer.succeed(OperatorExtensions, {
  beforePrompt: () => Effect.succeed(["Extension section: plugin bridge is active."]),
  beforeToolCall: () => Effect.void,
  afterToolCall: () => Effect.void,
})

const OperatorSessionManagerDependenciesLayer = Layer.mergeAll(
  OperatorSessionsTestLayer,
  OperatorSkillsTestLayer,
  OperatorResourcesTestLayer,
  OperatorModelRegistryTestLayer,
  OperatorExtensionsTestLayer,
)

const OperatorSessionManagerTestLayer = Layer.mergeAll(
  OperatorSessionManager.layer.pipe(
    Layer.provide(OperatorSessionManagerDependenciesLayer),
  ),
  OperatorSessionManagerDependenciesLayer,
)

describe("OperatorSessionManager service", () => {
  it.layer(OperatorSessionManagerTestLayer)(
    "create augments session detail with model and skill metadata",
    (it) => {
      it.effect("created sessions expose available skills/models", () =>
        Effect.gen(function* () {
          const manager = yield* OperatorSessionManager

          const created = yield* manager.create({
            title: "Investigate node-a",
            selectedNodeIds: ["node-a"],
            attachedSkillIds: ["incident-triage"],
          })

          expect(created.session.modelProviderId).toBe("openai")
          expect(created.session.modelId).toBe("gpt-5.4")
          expect(created.session.attachedSkillIds).toEqual(["incident-triage"])
          expect(created.availableSkills.map((skill) => skill.id)).toEqual([
            "incident-triage",
            "plugin-ops",
          ])
          expect(created.availableResources.map((resource) => resource.id)).toEqual([
            "docker/capabilities",
          ])
          expect(created.availableModels).toHaveLength(1)
        }),
      )
    },
  )

  it.layer(OperatorSessionManagerTestLayer)(
    "prepareRuntime rebuilds Pi-style prompt state from entries and attached skills",
    (it) => {
      it.effect("system prompt includes skill and extension sections, and messages follow the entry path", () =>
        Effect.gen(function* () {
          const manager = yield* OperatorSessionManager
          const sessions = yield* OperatorSessions

          const created = yield* manager.create({
            title: "Triage memory",
            selectedNodeIds: ["node-a"],
            attachedSkillIds: ["incident-triage", "plugin-ops"],
          })

          yield* sessions.appendEvent({
            id: crypto.randomUUID(),
            sessionId: created.session.id,
            at: Date.now(),
            type: "message.created",
            message: {
              id: crypto.randomUUID(),
              sessionId: created.session.id,
              role: "user",
              content: "Investigate memory pressure",
              createdAt: Date.now(),
            },
          })

          const prepared = yield* manager.prepareRuntime(created.session.id)

          expect(prepared.systemPrompt).toContain("You are Scout, an operator.")
          expect(prepared.systemPrompt).toContain("Always start by checking alerts")
          expect(prepared.systemPrompt).toContain("Prefer observe.plugins")
          expect(prepared.systemPrompt).toContain("Extension section: plugin bridge is active.")
          expect(prepared.messages).toHaveLength(1)
          expect(prepared.messages[0]?.role).toBe("user")
        }),
      )
    },
  )

  it.layer(OperatorSessionManagerTestLayer)(
    "setSkills persists a session-level skill change through the manager",
    (it) => {
      it.effect("attached skills are updated and reflected in prompt construction", () =>
        Effect.gen(function* () {
          const manager = yield* OperatorSessionManager

          const created = yield* manager.create({
            title: "Plugin diagnostics",
            selectedNodeIds: ["node-a"],
            attachedSkillIds: [],
          })

          const updated = yield* manager.setSkills(created.session.id, ["plugin-ops"])

          expect(updated.session.attachedSkillIds).toEqual(["plugin-ops"])
          expect(updated.events.at(-1)?.type).toBe("skills.updated")

          const prepared = yield* manager.prepareRuntime(created.session.id)
          expect(prepared.systemPrompt).toContain("Prefer observe.plugins")
        }),
      )
    },
  )
})
