import { Config, Effect, Layer } from "effect"
import * as Context from "effect/Context"
import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai"
import type { Models } from "@earendil-works/pi-ai/models"
import { builtinModels } from "@earendil-works/pi-ai/providers/all"
import type { OperatorModelDescriptor } from "@scout/shared"
import { scriptedFauxProvider } from "./operator-faux-provider.js"

export interface OperatorModelRef {
  readonly providerId: string
  readonly modelId: string
}

export interface OperatorModelSettings {
  readonly models: Models
  /** Chat models whose provider has credentials configured. */
  readonly available: ReadonlyArray<OperatorModelDescriptor>
  /** Model for new sessions; null when no provider is configured. */
  readonly defaultModel: OperatorModelRef | null
  readonly thinkingLevel: ModelThinkingLevel
  readonly systemPrompt: string
}

const DEFAULT_SYSTEM_PROMPT = [
  "You are Scout, an operator for system administration.",
  "Operate within the explicit node scope for the current session.",
  "Use tools conservatively and explain concrete findings.",
].join(" ")

const THINKING_LEVELS: ReadonlyArray<ModelThinkingLevel> = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]

const parseThinkingLevel = (value: string): ModelThinkingLevel =>
  THINKING_LEVELS.find((level) => level === value) ?? "medium"

const describe = (model: Model<Api>): OperatorModelDescriptor => ({
  providerId: model.provider,
  modelId: model.id,
  label: `${model.provider}/${model.id}`,
  reasoning: Boolean(model.reasoning),
})

/** The configured model, else a reasoning model of a preferred configured provider, else any available. */
export const selectDefaultModel = (
  available: ReadonlyArray<OperatorModelDescriptor>,
  configured: { readonly providerId: string; readonly modelId: string },
): OperatorModelRef | null => {
  const ofProvider = (providerId: string) => available.filter((model) => model.providerId === providerId)
  if (configured.providerId.length > 0) {
    const candidates = ofProvider(configured.providerId)
    const match =
      configured.modelId.length > 0
        ? candidates.find((model) => model.modelId === configured.modelId)
        : (candidates.find((model) => model.reasoning) ?? candidates[0])
    return match === undefined ? null : { providerId: match.providerId, modelId: match.modelId }
  }
  const preferred = [...ofProvider("anthropic"), ...ofProvider("openai"), ...available]
  const match = preferred.find((model) => model.reasoning) ?? preferred[0]
  return match === undefined ? null : { providerId: match.providerId, modelId: match.modelId }
}

/**
 * pi-ai model access for the operator. Providers read their credentials from the environment
 * (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY); `SCOUT_OPERATOR_MODEL_PROVIDER` / `SCOUT_OPERATOR_MODEL_ID`
 * pick the default for new sessions. Provider `faux` registers a scripted local model for smoke tests.
 */
export class OperatorModelRegistry extends Context.Service<OperatorModelRegistry, OperatorModelSettings>()(
  "@scout/OperatorModelRegistry",
  {
    make: Effect.gen(function* () {
      const providerId = yield* Config.withDefault(Config.String("SCOUT_OPERATOR_MODEL_PROVIDER"), "")
      const modelId = yield* Config.withDefault(Config.String("SCOUT_OPERATOR_MODEL_ID"), "")
      const systemPrompt = yield* Config.withDefault(
        Config.String("SCOUT_OPERATOR_SYSTEM_PROMPT"),
        DEFAULT_SYSTEM_PROMPT,
      )
      const thinkingLevel = parseThinkingLevel(
        yield* Config.withDefault(Config.String("SCOUT_OPERATOR_THINKING_LEVEL"), "medium"),
      )

      const models = builtinModels()
      if (providerId === "faux") models.setProvider(scriptedFauxProvider())
      const available = (yield* Effect.promise(() => models.getAvailable())).map(describe)
      const defaultModel = selectDefaultModel(available, { providerId, modelId })

      if (defaultModel === null) {
        yield* Effect.logWarning(
          "OperatorModelRegistry: no configured model provider; operator sessions cannot be created",
          { configuredProvider: providerId, configuredModel: modelId },
        )
      } else {
        yield* Effect.logInfo("OperatorModelRegistry: default operator model", {
          ...defaultModel,
          thinkingLevel,
          availableModelCount: available.length,
        })
      }

      return { models, available, defaultModel, thinkingLevel, systemPrompt }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
