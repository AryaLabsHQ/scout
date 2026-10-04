import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import type {
  OperatorAfterToolHookInput as PluginOperatorAfterToolHookInput,
  OperatorPromptHookInput as PluginOperatorPromptHookInput,
  OperatorSessionContext,
  OperatorToolHookInput as PluginOperatorToolHookInput,
  ScoutOperatorHookSet,
} from "@scout/plugin-sdk/operator"
import type { OperatorSessionSummary } from "@scout/shared"
import { PluginRegistry } from "./plugin-registry.js"

export interface OperatorBeforePromptInput {
  readonly session: OperatorSessionSummary
  readonly attachedSkillContents: ReadonlyArray<string>
}

export interface OperatorBeforeToolCallInput {
  readonly session: OperatorSessionSummary
  readonly toolName: string
  readonly args: unknown
}

export interface OperatorAfterToolCallInput extends OperatorBeforeToolCallInput {
  readonly result: unknown
  readonly isError: boolean
}

const toPluginSessionContext = (session: OperatorSessionSummary): OperatorSessionContext => ({
  id: session.id,
  title: session.title,
  status: session.status,
  selectedNodeIds: session.selectedNodeIds,
  attachedSkillIds: session.attachedSkillIds,
  approvalMode: session.approvalMode,
  planMode: session.planMode,
  modelProviderId: session.modelProviderId,
  modelId: session.modelId,
})

const toPromptHookInput = (
  input: OperatorBeforePromptInput,
): PluginOperatorPromptHookInput => ({
  session: toPluginSessionContext(input.session),
  attachedSkillContents: input.attachedSkillContents,
})

const toBeforeToolHookInput = (
  input: OperatorBeforeToolCallInput,
): PluginOperatorToolHookInput => ({
  session: toPluginSessionContext(input.session),
  toolName: input.toolName,
  args: input.args,
})

const toAfterToolHookInput = (
  input: OperatorAfterToolCallInput,
): PluginOperatorAfterToolHookInput => ({
  session: toPluginSessionContext(input.session),
  toolName: input.toolName,
  args: input.args,
  result: input.result,
  isError: input.isError,
})

const summarizePluginSurface = (pluginIds: ReadonlyArray<string>): string | null =>
  pluginIds.length === 0
    ? null
    : [
        "Scout plugin operator surfaces are available in this installation.",
        `Known plugin ids: ${pluginIds.join(", ")}.`,
        "Use observe.plugins before plugin.runAction or plugin.logs so actions and streams stay bounded to installed capabilities.",
      ].join("\n")

export class OperatorExtensions extends Context.Service<
  OperatorExtensions,
  {
    readonly beforePrompt: (
      input: OperatorBeforePromptInput,
    ) => Effect.Effect<ReadonlyArray<string>>
    readonly beforeToolCall: (input: OperatorBeforeToolCallInput) => Effect.Effect<void>
    readonly afterToolCall: (input: OperatorAfterToolCallInput) => Effect.Effect<void>
  }
>()(
  "@scout/OperatorExtensions",
  {
    make: Effect.gen(function* () {
      const pluginRegistry = yield* PluginRegistry
      const plugins = yield* pluginRegistry.listOperatorPlugins()
      const pluginIds = plugins.map((plugin) => plugin.manifest.id)
      const hookSets = plugins.flatMap((plugin) =>
        plugin.operator?.hooks ? [plugin.operator.hooks] : [],
      )

      const beforePrompt = (input: OperatorBeforePromptInput) =>
        Effect.all([
          Effect.succeed(summarizePluginSurface(pluginIds)),
          ...hookSets.map((hooks: ScoutOperatorHookSet) =>
            hooks.beforePrompt?.(toPromptHookInput(input)) ?? Effect.succeed(null),
          ),
        ]).pipe(
          Effect.map((sections) => sections.filter((section): section is string => section !== null)),
        )

      const beforeToolCall = (input: OperatorBeforeToolCallInput) =>
        Effect.forEach(hookSets, (hooks) =>
          hooks.beforeToolCall?.(toBeforeToolHookInput(input)) ?? Effect.void,
        ).pipe(Effect.asVoid)

      const afterToolCall = (input: OperatorAfterToolCallInput) =>
        Effect.forEach(hookSets, (hooks) =>
          hooks.afterToolCall?.(toAfterToolHookInput(input)) ?? Effect.void,
        ).pipe(Effect.asVoid)

      return {
        beforePrompt,
        beforeToolCall,
        afterToolCall,
      }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
