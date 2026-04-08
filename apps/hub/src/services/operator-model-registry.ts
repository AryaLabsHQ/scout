import { Config, Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import {
  getModels,
  getProviders,
  type Api,
  type KnownProvider,
  type Model,
} from "@mariozechner/pi-ai"
import { ManagementError, type OperatorModelDescriptor, type OperatorSessionSummary } from "@scout/shared"
import type { ThinkingLevel } from "@mariozechner/pi-agent-core"

export interface OperatorResolvedModelConfig {
  readonly providerId: string
  readonly modelId: string
  readonly model: Model<Api>
  readonly systemPrompt: string
  readonly thinkingLevel: ThinkingLevel
}

const DEFAULT_SYSTEM_PROMPT = [
  "You are Scout, an operator for system administration.",
  "Operate within the explicit node scope for the current session.",
  "Use tools conservatively and explain concrete findings.",
].join(" ")

const parseThinkingLevel = (value: string): ThinkingLevel => {
  switch (value) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return value
    default:
      return "medium"
  }
}

const modelLabel = (providerId: string, model: Model<Api>): string =>
  `${providerId}/${model.id}`

const toManagementError = (code: string, message: string): ManagementError =>
  new ManagementError({ code, message })

const selectProvider = (configuredProviderId: string): KnownProvider | null => {
  const providers = getProviders()
  if (providers.length === 0) {
    return null
  }

  if (configuredProviderId.length > 0 && providers.includes(configuredProviderId as KnownProvider)) {
    return configuredProviderId as KnownProvider
  }

  const preferredProvider = providers.find(
    (providerId) => providerId === "openai" || providerId === "anthropic",
  )
  return preferredProvider ?? providers[0] ?? null
}

const selectDefaultModel = (
  providerId: KnownProvider,
  configuredModelId: string,
): Model<Api> | null => {
  const models = getModels(providerId) as Array<Model<Api>>
  if (models.length === 0) {
    return null
  }

  if (configuredModelId.length > 0) {
    return models.find((model) => model.id === configuredModelId) ?? null
  }

  return models.find((model) => model.reasoning) ?? models[0] ?? null
}

export class OperatorModelRegistry extends ServiceMap.Service<
  OperatorModelRegistry,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<OperatorModelDescriptor>>
    readonly getDefault: Effect.Effect<OperatorResolvedModelConfig, ManagementError>
    readonly resolveSession: (
      session: Pick<OperatorSessionSummary, "modelProviderId" | "modelId">,
    ) => Effect.Effect<OperatorResolvedModelConfig, ManagementError>
  }
>()(
  "@scout/OperatorModelRegistry",
  {
    make: Effect.gen(function* () {
      const configuredProviderId = yield* Config.withDefault(
        Config.string("SCOUT_OPERATOR_MODEL_PROVIDER"),
        "",
      )
      const configuredModelId = yield* Config.withDefault(
        Config.string("SCOUT_OPERATOR_MODEL_ID"),
        "",
      )
      const configuredSystemPrompt = yield* Config.withDefault(
        Config.string("SCOUT_OPERATOR_SYSTEM_PROMPT"),
        DEFAULT_SYSTEM_PROMPT,
      )
      const configuredThinkingLevel = yield* Config.withDefault(
        Config.string("SCOUT_OPERATOR_THINKING_LEVEL"),
        "medium",
      )

      const descriptors: Array<OperatorModelDescriptor> = []
      const resolvedModels = new Map<string, OperatorResolvedModelConfig>()

      for (const providerId of getProviders()) {
        const models = getModels(providerId) as Array<Model<Api>>
        for (const model of models) {
          descriptors.push({
            providerId,
            modelId: model.id,
            label: modelLabel(providerId, model),
            reasoning: Boolean(model.reasoning),
          })
          resolvedModels.set(`${providerId}:${model.id}`, {
            providerId,
            modelId: model.id,
            model,
            systemPrompt: configuredSystemPrompt,
            thinkingLevel: parseThinkingLevel(configuredThinkingLevel),
          })
        }
      }

      const defaultProviderId = selectProvider(configuredProviderId)
      if (defaultProviderId === null) {
        return yield* Effect.fail(
          toManagementError(
            "operator-model-provider-missing",
            "No pi-ai providers are available for the Scout operator runtime",
          ),
        )
      }

      const defaultModel = selectDefaultModel(defaultProviderId, configuredModelId)
      if (defaultModel === null) {
        return yield* Effect.fail(
          toManagementError(
            "operator-model-missing",
            configuredModelId.length > 0
              ? `Operator model ${configuredProviderId}/${configuredModelId} is not available`
              : `No operator models are available for provider ${defaultProviderId}`,
          ),
        )
      }

      const defaultKey = `${defaultProviderId}:${defaultModel.id}`
      const defaultResolved = resolvedModels.get(defaultKey)
      if (!defaultResolved) {
        return yield* Effect.fail(
          toManagementError(
            "operator-model-missing",
            `Resolved operator model ${defaultKey} is unavailable`,
          ),
        )
      }

      const resolveSession = (
        session: Pick<OperatorSessionSummary, "modelProviderId" | "modelId">,
      ) =>
        Effect.sync(() => resolvedModels.get(`${session.modelProviderId}:${session.modelId}`) ?? null).pipe(
          Effect.flatMap((resolved) =>
            resolved === null
              ? Effect.fail(
                  toManagementError(
                    "operator-model-missing",
                    `Operator session model ${session.modelProviderId}/${session.modelId} is unavailable`,
                  ),
                )
              : Effect.succeed(resolved),
          ),
        )

      yield* Effect.logInfo("OperatorModelRegistry: resolved default operator model", {
        providerId: defaultResolved.providerId,
        modelId: defaultResolved.modelId,
        thinkingLevel: defaultResolved.thinkingLevel,
        availableModelCount: descriptors.length,
      })

      return {
        list: () => Effect.succeed(descriptors),
        getDefault: Effect.succeed(defaultResolved),
        resolveSession,
      }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
