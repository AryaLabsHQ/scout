/**
 * Operator test fixtures: pi-ai's faux model, a fake node agent that records what it was asked to
 * run, a Docker manifest with a confirmed action, and the operator service graph over a file.
 */

import { Effect, Layer, Stream } from "effect"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import { AgentRegistry } from "../../src/rpc/agent-bridge.js"
import { MetricsIngestion } from "../../src/services/metrics-ingestion.js"
import { OperatorExtensions } from "../../src/services/operator-extensions.js"
import { OperatorHarness, openOperatorHarness } from "../../src/services/operator-harness.js"
import { OperatorModelRegistry } from "../../src/services/operator-model-registry.js"
import { OperatorResources } from "../../src/services/operator-resources.js"
import { OperatorSessions } from "../../src/services/operator-sessions.js"
import { OperatorSkills } from "../../src/services/operator-skills.js"
import { openBunSqliteStorage } from "../../src/services/operator-storage.js"
import { PluginRegistry } from "../../src/services/plugin-registry.js"
import { TestDatabaseLayer } from "./test-database.js"

export const faux = fauxProvider()
const models = createModels()
models.setProvider(faux.provider)

const ModelLayer = Layer.succeed(OperatorModelRegistry, {
  models,
  available: [{ providerId: "faux", modelId: "faux-1", label: "faux/faux-1", reasoning: false }],
  defaultModel: { providerId: "faux", modelId: "faux-1" },
  thinkingLevel: "off",
  systemPrompt: "You are a test operator.",
})

const dockerManifest = {
  id: "docker",
  displayName: "Docker",
  actions: [
    {
      id: "restart-container",
      displayName: "Restart container",
      targetKinds: ["container"],
      permissions: ["node:spawn-process"],
      requiresConfirmation: true,
    },
  ],
  streams: [],
  metrics: [],
  entityKinds: [],
} as never

export const PluginLayer = Layer.succeed(PluginRegistry, {
  list: () =>
    Effect.succeed([
      { rootDir: "/tmp/docker", pluginPath: "/tmp/docker/plugin.ts", manifest: dockerManifest },
    ]),
  get: () => Effect.succeed(null),
  listHubPlugins: () => Effect.succeed([]),
  listWebPlugins: () => Effect.succeed([]),
  listOperatorPlugins: () => Effect.succeed([]),
  getOperatorPlugin: () => Effect.succeed(null),
})

/** What the fake node agent was asked to do; clear it between tests. */
export const executed: Array<string> = []

const fakeClient = {
  "terminal.exec": ({ command }: { command: string }) => {
    executed.push(`bash:${command}`)
    if (command === "hang") {
      return Stream.concat(
        Stream.make({ _tag: "session-start" as const, sessionId: "term-hang" }),
        Stream.never,
      )
    }
    return Stream.make(
      { _tag: "session-start" as const, sessionId: "term-1" },
      { _tag: "output" as const, dataBase64: Buffer.from(`ran ${command}\r\n`).toString("base64") },
      { _tag: "exit" as const, exitCode: 0 },
    )
  },
  "terminal.close": () => Effect.void,
  "plugins.runAction": ({ actionId }: { actionId: string }) => {
    executed.push(`action:${actionId}`)
    return Effect.succeed({ success: true, summary: `${actionId} done` })
  },
}

export const AgentLayer = Layer.succeed(AgentRegistry, {
  getClient: () => Effect.succeed(fakeClient),
  listConnected: () => Effect.succeed([]),
} as never)

/** OperatorSessions and everything it needs, over the operator storage at `path`. */
export const operatorLayer = (path: string) => {
  const base = Layer.mergeAll(
    TestDatabaseLayer,
    PluginLayer,
    AgentLayer,
    ModelLayer,
    MetricsIngestion.layer.pipe(Layer.provide(TestDatabaseLayer)),
    OperatorExtensions.layer.pipe(Layer.provide(PluginLayer)),
    OperatorSkills.layer.pipe(Layer.provide(PluginLayer)),
    OperatorResources.layer.pipe(Layer.provide(PluginLayer)),
  )
  const harness = Layer.effect(
    OperatorHarness,
    openOperatorHarness(() => openBunSqliteStorage(path)),
  ).pipe(Layer.provide(base))
  return OperatorSessions.layer.pipe(Layer.provideMerge(Layer.merge(harness, base)))
}
