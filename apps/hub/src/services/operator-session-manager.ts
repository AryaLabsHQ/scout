import { Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import type { AgentMessage } from "@mariozechner/pi-agent-core"
import type {
  OperatorMessage as PersistedOperatorMessage,
  OperatorSessionCreateParams,
  OperatorSessionDetail,
  OperatorSessionEvent,
  OperatorSessionSummary,
  OperatorToolCall,
} from "@scout/shared"
import { ManagementError } from "@scout/shared"
import {
  OperatorModelRegistry,
  type OperatorResolvedModelConfig,
} from "./operator-model-registry.js"
import { OperatorSessions } from "./operator-sessions.js"
import { OperatorResources } from "./operator-resources.js"
import { OperatorSkills } from "./operator-skills.js"
import { OperatorExtensions } from "./operator-extensions.js"

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
} as const

const toManagementError = (code: string, message: string): ManagementError =>
  new ManagementError({ code, message })

const operatorMessageToPiMessage = (
  message: PersistedOperatorMessage,
  model: OperatorResolvedModelConfig["model"],
): AgentMessage | null => {
  switch (message.role) {
    case "user":
      return {
        role: "user",
        content: message.content,
        timestamp: message.createdAt,
      }
    case "assistant":
      return {
        role: "assistant",
        content:
          message.contentBlocks !== undefined
            ? (message.contentBlocks as Extract<AgentMessage, { role: "assistant" }>["content"])
            : ([{ type: "text", text: message.content }] as Extract<
                AgentMessage,
                { role: "assistant" }
              >["content"]),
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: EMPTY_USAGE,
        stopReason: "stop",
        timestamp: message.createdAt,
      }
    default:
      return null
  }
}

const toolResultToPiMessage = (toolCall: OperatorToolCall): AgentMessage => {
  const output =
    typeof toolCall.output === "object" && toolCall.output !== null
      ? (toolCall.output as {
          content?: Array<{ type: "text"; text: string }>
          details?: unknown
        })
      : undefined

  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content:
      output?.content !== undefined
        ? output.content
        : [{ type: "text", text: toolCall.summary ?? "(no output)" }],
    details: output?.details,
    isError:
      toolCall.status === "failed" ||
      toolCall.status === "blocked" ||
      toolCall.status === "canceled",
    timestamp: toolCall.finishedAt ?? toolCall.startedAt,
  }
}

const sessionEntriesToAgentMessages = (
  detail: OperatorSessionDetail,
  model: OperatorResolvedModelConfig["model"],
): Array<AgentMessage> => {
  const entryMap = new Map(detail.entries.map((entry) => [entry.id, entry]))
  const leafEntryId = detail.session.currentLeafEntryId
  const orderedEntries =
    leafEntryId === undefined
      ? detail.entries
      : (() => {
          const path = []
          let cursor: string | undefined = leafEntryId
          while (cursor !== undefined) {
            const entry = entryMap.get(cursor)
            if (!entry) {
              throw new Error(`Operator entry ${cursor} not found while rebuilding runtime state`)
            }
            path.push(entry)
            cursor = entry.parentEntryId
          }
          return path.reverse()
        })()

  return orderedEntries.flatMap((entry) => {
    if (entry.kind === "message") {
      const message = operatorMessageToPiMessage(entry.data as PersistedOperatorMessage, model)
      return message === null ? [] : [message]
    }

    if (entry.kind === "tool_result") {
      const data =
        typeof entry.data === "object" && entry.data !== null
          ? (entry.data as { toolCall?: OperatorToolCall })
          : undefined
      return data?.toolCall ? [toolResultToPiMessage(data.toolCall)] : []
    }

    return []
  })
}

const augmentDetail = (
  detail: OperatorSessionDetail,
  availableSkills: OperatorSessionDetail["availableSkills"],
  availableResources: OperatorSessionDetail["availableResources"],
  availableModels: OperatorSessionDetail["availableModels"],
): OperatorSessionDetail => ({
  ...detail,
  availableSkills,
  availableResources,
  availableModels,
})

export interface OperatorPreparedRuntimeSession {
  readonly detail: OperatorSessionDetail
  readonly resolvedModelConfig: OperatorResolvedModelConfig
  readonly systemPrompt: string
  readonly messages: ReadonlyArray<AgentMessage>
}

export class OperatorSessionManager extends ServiceMap.Service<
  OperatorSessionManager,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<OperatorSessionSummary>>
    readonly get: (sessionId: string) => Effect.Effect<OperatorSessionDetail | null>
    readonly create: (params: OperatorSessionCreateParams) => Effect.Effect<OperatorSessionDetail, ManagementError>
    readonly branch: (
      sessionId: string,
      entryId: string | null,
    ) => Effect.Effect<OperatorSessionDetail, ManagementError>
    readonly fork: (
      sessionId: string,
      entryId: string,
      title?: string,
    ) => Effect.Effect<OperatorSessionDetail, ManagementError>
    readonly setSkills: (
      sessionId: string,
      skillIds: ReadonlyArray<string>,
    ) => Effect.Effect<OperatorSessionDetail, ManagementError>
    readonly prepareRuntime: (
      sessionId: string,
    ) => Effect.Effect<OperatorPreparedRuntimeSession, ManagementError>
    readonly beforePromptSections: (
      session: OperatorSessionSummary,
    ) => Effect.Effect<ReadonlyArray<string>, ManagementError>
  }
>()(
  "@scout/OperatorSessionManager",
  {
    make: Effect.gen(function* () {
      const sessions = yield* OperatorSessions
      const modelRegistry = yield* OperatorModelRegistry
      const resources = yield* OperatorResources
      const skills = yield* OperatorSkills
      const extensions = yield* OperatorExtensions

      const list = () => sessions.list()

      const getAvailableState = Effect.all({
        skills: skills.list(),
        resources: resources.list(),
        models: modelRegistry.list(),
      })

      const get: (sessionId: string) => Effect.Effect<OperatorSessionDetail | null> = (sessionId) =>
        Effect.all({
          detail: sessions.get(sessionId),
          state: getAvailableState,
        }).pipe(
          Effect.map(({ detail, state }) =>
            detail === null
              ? null
              : augmentDetail(detail, state.skills, state.resources, state.models),
          ),
        )

      const create = (params: OperatorSessionCreateParams) =>
        Effect.gen(function* () {
          const attachedSkillIds = params.attachedSkillIds ?? []
          const selectedNodeIds = params.selectedNodeIds ?? []
          yield* skills.resolve(attachedSkillIds)
          const resolvedModel = yield* modelRegistry.getDefault
          const created = yield* sessions.create({
            title: params.title,
            selectedNodeIds,
            attachedSkillIds,
            modelProviderId: resolvedModel.providerId,
            modelId: resolvedModel.modelId,
          })
          const state = yield* getAvailableState
          return augmentDetail(created, state.skills, state.resources, state.models)
        })

      const branch = (sessionId: string, entryId: string | null) =>
        Effect.gen(function* () {
          const detail = yield* sessions.branch(sessionId, entryId)
          const state = yield* getAvailableState
          return augmentDetail(detail, state.skills, state.resources, state.models)
        })

      const fork = (sessionId: string, entryId: string, title?: string) =>
        Effect.gen(function* () {
          const detail = yield* sessions.fork(sessionId, entryId, title)
          const state = yield* getAvailableState
          return augmentDetail(detail, state.skills, state.resources, state.models)
        })

      const setSkills = (sessionId: string, skillIds: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          yield* skills.resolve(skillIds)
          const existing = yield* sessions.get(sessionId)
          if (existing === null) {
            return yield* Effect.fail(
              toManagementError(
                "session-not-found",
                `Operator session ${sessionId} not found`,
              ),
            )
          }

          const event: Omit<OperatorSessionEvent, "seq"> = {
            id: crypto.randomUUID(),
            sessionId,
            at: Date.now(),
            type: "skills.updated",
            skillIds: [...skillIds],
            summary:
              skillIds.length === 0
                ? "Removed all attached skills"
                : `Attached skills: ${skillIds.join(", ")}`,
          }

          yield* sessions.appendEvent(event)
          const detail = yield* get(sessionId)
          if (detail === null) {
            return yield* Effect.fail(
              toManagementError(
                "session-not-found",
                `Operator session ${sessionId} not found`,
              ),
            )
          }
          return detail
        })

      const beforePromptSections = (session: OperatorSessionSummary) =>
        Effect.gen(function* () {
          const attachedSkills = yield* skills.resolve(session.attachedSkillIds)
          const extensionSections = yield* extensions.beforePrompt({
            session,
            attachedSkillContents: attachedSkills.map((skill) => skill.content),
          })

          return [
            ...attachedSkills.map((skill) => [`Skill: ${skill.name}`, skill.content].join("\n")),
            ...extensionSections,
          ]
        })

      const prepareRuntime = (sessionId: string) =>
        Effect.gen(function* () {
          const detail = yield* get(sessionId)
          if (detail === null) {
            return yield* Effect.fail(
              toManagementError(
                "session-not-found",
                `Operator session ${sessionId} not found`,
              ),
            )
          }

          const resolvedModelConfig = yield* modelRegistry.resolveSession(detail.session)
          const promptSections = yield* beforePromptSections(detail.session)

          return {
            detail,
            resolvedModelConfig,
            systemPrompt: [
              resolvedModelConfig.systemPrompt,
              ...promptSections,
            ].filter((section) => section.trim().length > 0).join("\n\n"),
            messages: sessionEntriesToAgentMessages(detail, resolvedModelConfig.model),
          } satisfies OperatorPreparedRuntimeSession
        })

      return {
        list,
        get,
        create,
        branch,
        fork,
        setSkills,
        prepareRuntime,
        beforePromptSections,
      }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
