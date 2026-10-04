import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import type {
  OperatorAfterToolHookInput,
  OperatorPromptHookInput,
  OperatorToolHookInput,
  ScoutOperatorHookSet,
} from "@scout/plugin-sdk/operator"
import { PluginRegistry } from "./plugin-registry.js"

const summarizePluginSurface = (pluginIds: ReadonlyArray<string>): string | null =>
  pluginIds.length === 0
    ? null
    : [
        "Scout plugin operator surfaces are available in this installation.",
        `Known plugin ids: ${pluginIds.join(", ")}.`,
        "Use observe_plugins before plugin_run_action or plugin_logs so actions and streams stay bounded to installed capabilities.",
      ].join("\n")

export class OperatorExtensions extends Context.Service<
  OperatorExtensions,
  {
    readonly beforePrompt: (input: OperatorPromptHookInput) => Effect.Effect<ReadonlyArray<string>>
    readonly beforeToolCall: (input: OperatorToolHookInput) => Effect.Effect<void>
    readonly afterToolCall: (input: OperatorAfterToolHookInput) => Effect.Effect<void>
  }
>()("@scout/OperatorExtensions", {
  make: Effect.gen(function* () {
    const pluginRegistry = yield* PluginRegistry
    const plugins = yield* pluginRegistry.listOperatorPlugins()
    const pluginIds = plugins.map((plugin) => plugin.manifest.id)
    const hookSets = plugins.flatMap((plugin) => (plugin.operator?.hooks ? [plugin.operator.hooks] : []))

    const beforePrompt = (input: OperatorPromptHookInput) =>
      Effect.all([
        Effect.succeed(summarizePluginSurface(pluginIds)),
        ...hookSets.map((hooks: ScoutOperatorHookSet) => hooks.beforePrompt?.(input) ?? Effect.succeed(null)),
      ]).pipe(Effect.map((sections) => sections.filter((section): section is string => section !== null)))

    const beforeToolCall = (input: OperatorToolHookInput) =>
      Effect.forEach(hookSets, (hooks) => hooks.beforeToolCall?.(input) ?? Effect.void).pipe(Effect.asVoid)

    const afterToolCall = (input: OperatorAfterToolHookInput) =>
      Effect.forEach(hookSets, (hooks) => hooks.afterToolCall?.(input) ?? Effect.void).pipe(Effect.asVoid)

    return {
      beforePrompt,
      beforeToolCall,
      afterToolCall,
    }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
