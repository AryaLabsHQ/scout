import { Cause, Effect, Layer, Queue, Stream } from "effect"
import * as Context from "effect/Context"
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai"
import {
  configure,
  type AgentChange,
  type Conversation,
  type ConversationId,
  type ConversationView,
  type InboxState,
  type LiveState,
  LiveDoc,
} from "@earendil-works/pi-durable"
import {
  ManagementError,
  type OperatorApprovalMode,
  type OperatorApprovalRequest,
  type OperatorPlanMode,
  type OperatorSessionCreateParams,
  type OperatorSessionDetail,
  type OperatorSessionStatus,
  type OperatorSessionSummary,
  type OperatorTerminalOutput,
  type OperatorTimelineItem,
} from "@scout/shared"
import { durable, OperatorHarness } from "./operator-harness.js"
import {
  OperatorApprovalsDoc,
  type OperatorApprovalRecord,
  type OperatorSessionMeta,
  OperatorSessionsDoc,
} from "./operator-docs.js"
import { OperatorModelRegistry } from "./operator-model-registry.js"
import { OperatorResources } from "./operator-resources.js"
import { OperatorSkills } from "./operator-skills.js"
import { toolNodeIds } from "./operator-tools.js"

// ── Projection: durable state → wire detail ─────────────────────────────────

type Approvals = { readonly requests: Readonly<Record<string, OperatorApprovalRecord>> }

const textOf = (content: UserMessage["content"] | ToolResultMessage["content"]): string =>
  typeof content === "string"
    ? content
    : content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")

const terminalOf = (details: unknown): OperatorTerminalOutput | undefined => {
  if (typeof details !== "object" || details === null || !("terminal" in details)) return undefined
  const terminal = (details as { terminal?: unknown }).terminal
  if (typeof terminal !== "object" || terminal === null) return undefined
  const { nodeId, terminalSessionId, base64Chunks } = terminal as Record<string, unknown>
  if (typeof nodeId !== "string" || typeof terminalSessionId !== "string" || !Array.isArray(base64Chunks)) {
    return undefined
  }
  return { nodeId, terminalSessionId, base64Chunks: base64Chunks.filter((chunk) => typeof chunk === "string") }
}

const toApprovalRequest = (sessionId: string, record: OperatorApprovalRecord): OperatorApprovalRequest => ({
  ...record,
  sessionId,
})

export const sessionStatus = (
  meta: OperatorSessionMeta,
  live: LiveState | undefined,
  approvals: Approvals | undefined,
  lastAnswer: AssistantMessage | undefined,
): OperatorSessionStatus => {
  if (meta.archived) return "archived"
  if (Object.values(approvals?.requests ?? {}).some((record) => record.status === "pending")) {
    return "waiting_for_user"
  }
  if (live?.run !== undefined) return "running"
  if (lastAnswer?.stopReason === "error") return "failed"
  return "idle"
}

export const toSummary = (
  id: string,
  meta: OperatorSessionMeta,
  status: OperatorSessionStatus,
): OperatorSessionSummary => ({
  id,
  title: meta.title,
  status,
  selectedNodeIds: meta.selectedNodeIds,
  attachedSkillIds: meta.attachedSkillIds,
  approvalMode: meta.approvalMode,
  planMode: meta.planMode,
  modelProviderId: meta.modelProviderId,
  modelId: meta.modelId,
  ...(meta.parentSessionId === undefined ? {} : { parentSessionId: meta.parentSessionId }),
  ...(meta.forkedFromEntryId === undefined ? {} : { forkedFromEntryId: meta.forkedFromEntryId }),
  createdAt: meta.createdAt,
  updatedAt: meta.updatedAt,
})

/** The session's timeline, approvals, and status from its conversation view and approval document. */
export const projectSession = (
  id: string,
  meta: OperatorSessionMeta,
  view: ConversationView,
  approvals: Approvals | undefined,
): Omit<OperatorSessionDetail, "availableSkills" | "availableResources" | "availableModels"> => {
  const live = view.docs["pi.live"] as LiveState | undefined
  const inbox = view.docs["pi.inbox"] as InboxState | undefined
  const results = new Map<string, { readonly entryId: string; readonly message: ToolResultMessage }>()
  for (const entry of view.entries) {
    const message = entry.model?.[0]
    if (entry.kind === "pi.tool-result" && message?.role === "toolResult") {
      results.set(message.toolCallId, { entryId: String(entry.id), message })
    }
  }
  const slots = new Map((live?.tools ?? []).map((slot) => [slot.callId, slot]))
  const approvalByCall = new Map(
    Object.values(approvals?.requests ?? {}).map((record) => [record.toolCallId, record.id]),
  )

  const timeline: Array<OperatorTimelineItem> = []
  let lastAnswer: AssistantMessage | undefined
  const pushAssistant = (message: AssistantMessage, entryId: string | undefined) => {
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")
    const thinking = message.content.flatMap((block) => (block.type === "thinking" ? [block.thinking] : [])).join("")
    const errorMessage =
      message.stopReason === "error" || message.stopReason === "aborted"
        ? (message.errorMessage ?? message.stopReason)
        : undefined
    if (text.length > 0 || thinking.length > 0 || errorMessage !== undefined || entryId === undefined) {
      timeline.push({
        kind: "assistant",
        ...(entryId === undefined ? {} : { entryId }),
        text,
        ...(thinking.length > 0 ? { thinking } : {}),
        streaming: entryId === undefined,
        ...(errorMessage === undefined ? {} : { errorMessage }),
        createdAt: message.timestamp,
      })
    }
    if (entryId === undefined) return
    for (const block of message.content) {
      if (block.type !== "toolCall") continue
      const result = results.get(block.id)
      const slot = slots.get(block.id)
      const approvalId = approvalByCall.get(block.id)
      const output =
        result !== undefined ? textOf(result.message.content) : slot?.output !== undefined ? slot.output : undefined
      const terminal = terminalOf(result?.message.details ?? slot?.details)
      timeline.push({
        kind: "tool",
        toolCallId: block.id,
        ...(result === undefined ? {} : { entryId: result.entryId }),
        name: block.name,
        args: block.arguments,
        status:
          result !== undefined
            ? result.message.isError
              ? "failed"
              : "completed"
            : slot?.status === "running"
              ? "running"
              : "pending",
        ...(output === undefined ? {} : { output }),
        nodeIds: toolNodeIds(block.arguments, meta.selectedNodeIds),
        ...(approvalId === undefined ? {} : { approvalId }),
        ...(terminal === undefined ? {} : { terminal }),
        createdAt: message.timestamp,
      })
    }
  }

  for (const entry of view.entries) {
    const message = entry.model?.[0]
    if (entry.kind === "pi.user" && message?.role === "user") {
      timeline.push({ kind: "user", entryId: String(entry.id), text: textOf(message.content), createdAt: message.timestamp })
    } else if (entry.kind === "pi.assistant" && message?.role === "assistant") {
      lastAnswer = message
      pushAssistant(message, String(entry.id))
    }
  }
  const partial = live?.generation?.message as AssistantMessage | undefined
  if (partial !== undefined) pushAssistant(partial, undefined)

  return {
    session: toSummary(id, meta, sessionStatus(meta, live, approvals, lastAnswer)),
    timeline,
    approvals: Object.values(approvals?.requests ?? {})
      .map((record) => toApprovalRequest(id, record))
      .sort((left, right) => left.requestedAt - right.requestedAt),
    queuedInputs: (inbox?.items ?? []).filter((item) => item.mode !== "write").length,
  }
}

// ── Service ─────────────────────────────────────────────────────────────────

const notFound = (sessionId: string) =>
  new ManagementError({ code: "session-not-found", message: `Operator session ${sessionId} not found` })

const DEFAULT_TITLE = "New operator session"
const WATCH_COALESCE_MS = 50

export interface OperatorSessionsShape {
  readonly list: () => Effect.Effect<ReadonlyArray<OperatorSessionSummary>, ManagementError>
  readonly get: (sessionId: string) => Effect.Effect<OperatorSessionDetail | null, ManagementError>
  readonly create: (params: OperatorSessionCreateParams) => Effect.Effect<OperatorSessionDetail, ManagementError>
  readonly fork: (
    sessionId: string,
    entryId: string,
    title?: string,
  ) => Effect.Effect<OperatorSessionDetail, ManagementError>
  readonly setTitle: (sessionId: string, title: string) => Effect.Effect<void, ManagementError>
  readonly setApprovalMode: (sessionId: string, mode: OperatorApprovalMode) => Effect.Effect<void, ManagementError>
  readonly setPlanMode: (sessionId: string, mode: OperatorPlanMode) => Effect.Effect<void, ManagementError>
  readonly setSkills: (
    sessionId: string,
    skillIds: ReadonlyArray<string>,
  ) => Effect.Effect<OperatorSessionDetail, ManagementError>
  readonly archive: (sessionId: string) => Effect.Effect<void, ManagementError>
  readonly delete: (sessionId: string) => Effect.Effect<void, ManagementError>
  /** Durably admit a prompt; a busy session queues it as a follow-up. Does not wait for the answer. */
  readonly prompt: (sessionId: string, text: string, requestId?: string) => Effect.Effect<void, ManagementError>
  /** Abort the running answer and every tool call it owns; pending approvals become canceled. */
  readonly abort: (sessionId: string) => Effect.Effect<void, ManagementError>
  readonly resolveApproval: (params: {
    readonly sessionId: string
    readonly approvalId: string
    readonly decision: "approved" | "rejected"
    readonly answer?: string
    /** Verified identity of the decider, when the RPC context carries one. */
    readonly actor?: string
  }) => Effect.Effect<void, ManagementError>
  /** The session's detail now and after every durable change, coalesced. */
  readonly watch: (sessionId: string) => Stream.Stream<OperatorSessionDetail, ManagementError>
}

export class OperatorSessions extends Context.Service<OperatorSessions, OperatorSessionsShape>()(
  "@scout/OperatorSessions",
  {
    make: Effect.gen(function* () {
      const { harness, extensions } = yield* OperatorHarness
      const modelSettings = yield* OperatorModelRegistry
      const skills = yield* OperatorSkills
      const resources = yield* OperatorResources

      const available = Effect.all({ skillList: skills.list(), resourceList: resources.list() }).pipe(
        Effect.map(({ skillList, resourceList }) => ({
          availableSkills: skillList,
          availableResources: resourceList,
          availableModels: modelSettings.available,
        })),
      )

      const readIndex = durable("operator-read", (context) => harness.snapshot(OperatorSessionsDoc, context)).pipe(
        Effect.map((index) => index?.sessions ?? {}),
      )

      const requireSession = (sessionId: string) =>
        Effect.gen(function* () {
          const meta = (yield* readIndex)[sessionId]
          if (meta === undefined) return yield* Effect.fail(notFound(sessionId))
          const conversation = yield* durable("operator-read", (context) =>
            harness.conversation(Number(sessionId) as ConversationId, context),
          )
          if (conversation === undefined) return yield* Effect.fail(notFound(sessionId))
          return { meta, conversation }
        })

      const updateMeta = (sessionId: string, change: (meta: OperatorSessionMeta) => void) =>
        durable("operator-update", (context) =>
          harness.commit(async (tx) => {
            const meta = (await tx.doc(OperatorSessionsDoc)).sessions[sessionId]
            if (meta === undefined) throw notFound(sessionId)
            change(meta)
            meta.updatedAt = Date.now()
          }, context),
        )

      const planChange = (mode: OperatorPlanMode): AgentChange =>
        mode === "plan_first" ? { extensions: { add: [extensions.plan] } } : { extensions: null }

      const detailOf = (
        sessionId: string,
        meta: OperatorSessionMeta,
        view: ConversationView,
        approvals: Approvals | undefined,
      ) =>
        available.pipe(Effect.map((state) => ({ ...projectSession(sessionId, meta, view, approvals), ...state })))

      const readView = (conversation: Conversation) =>
        durable("operator-read", async (context) => {
          const state = await conversation.viewState(context)
          try {
            return state.value
          } finally {
            state.dispose()
          }
        })

      const get = (sessionId: string) =>
        Effect.gen(function* () {
          const meta = (yield* readIndex)[sessionId]
          if (meta === undefined) return null
          const { conversation } = yield* requireSession(sessionId)
          const view = yield* readView(conversation)
          const approvals = yield* durable("operator-read", (context) =>
            harness.snapshot(OperatorApprovalsDoc, conversation.id, context),
          )
          return yield* detailOf(sessionId, meta, view, approvals)
        })

      const requireDetail = (sessionId: string) =>
        get(sessionId).pipe(
          Effect.flatMap((detail) => (detail === null ? Effect.fail(notFound(sessionId)) : Effect.succeed(detail))),
        )

      const list = () =>
        Effect.gen(function* () {
          const index = yield* readIndex
          const summaries = yield* Effect.forEach(Object.entries(index), ([id, meta]) =>
            durable("operator-read", async (context) => {
              const conversationId = Number(id) as ConversationId
              const live = await harness.snapshot(LiveDoc, conversationId, context)
              const approvals = await harness.snapshot(OperatorApprovalsDoc, conversationId, context)
              return toSummary(id, meta, sessionStatus(meta, live, approvals, undefined))
            }),
          )
          return summaries.sort((left, right) => right.updatedAt - left.updatedAt)
        })

      const create = (params: OperatorSessionCreateParams) =>
        Effect.gen(function* () {
          const model = modelSettings.defaultModel
          if (model === null) {
            return yield* Effect.fail(
              new ManagementError({
                code: "operator-model-missing",
                message: "No operator model provider is configured (set a provider API key or SCOUT_OPERATOR_MODEL_PROVIDER)",
              }),
            )
          }
          const attachedSkillIds = [...(params.attachedSkillIds ?? [])]
          yield* skills.resolve(attachedSkillIds)
          const now = Date.now()
          const conversation = yield* durable("operator-create", (context) =>
            harness.createConversation(
              {
                ownership: { kind: "ownerless" },
                agent: {
                  model: { provider: model.providerId, modelId: model.modelId },
                  thinkingLevel: modelSettings.thinkingLevel,
                },
                init: async (tx, id) => {
                  ;(await tx.doc(OperatorSessionsDoc)).sessions[String(id)] = {
                    title: params.title?.trim() || DEFAULT_TITLE,
                    selectedNodeIds: [...(params.selectedNodeIds ?? [])],
                    attachedSkillIds,
                    approvalMode: "confirm_each_mutation",
                    planMode: "off",
                    archived: false,
                    modelProviderId: model.providerId,
                    modelId: model.modelId,
                    createdAt: now,
                    updatedAt: now,
                  }
                },
              },
              context,
            ),
          )
          return yield* requireDetail(String(conversation.id))
        })

      const fork = (sessionId: string, entryId: string, title?: string) =>
        Effect.gen(function* () {
          const { meta, conversation } = yield* requireSession(sessionId)
          const at = Number(entryId)
          if (!Number.isSafeInteger(at)) {
            return yield* Effect.fail(new ManagementError({ code: "entry-not-found", message: `Entry ${entryId} not found` }))
          }
          const now = Date.now()
          const forked = yield* durable("operator-fork", (context) =>
            conversation.fork(
              at as Parameters<Conversation["fork"]>[0],
              {
                ownership: { kind: "ownerless" },
                // The fork's agent is its parent's as of the entry; Scout metadata decides plan mode.
                agent: planChange(meta.planMode),
                init: async (tx, id) => {
                  ;(await tx.doc(OperatorSessionsDoc)).sessions[String(id)] = {
                    ...(JSON.parse(JSON.stringify(meta)) as OperatorSessionMeta),
                    title: title?.trim() || `${meta.title} (fork)`,
                    archived: false,
                    parentSessionId: sessionId,
                    forkedFromEntryId: entryId,
                    createdAt: now,
                    updatedAt: now,
                  }
                },
              },
              context,
            ),
          )
          return yield* requireDetail(String(forked.id))
        })

      const setPlanMode = (sessionId: string, mode: OperatorPlanMode) =>
        Effect.gen(function* () {
          const { conversation } = yield* requireSession(sessionId)
          yield* durable("operator-update", (context) =>
            harness.commit(async (tx) => {
              const meta = (await tx.doc(OperatorSessionsDoc)).sessions[sessionId]
              if (meta === undefined) throw notFound(sessionId)
              meta.planMode = mode
              meta.updatedAt = Date.now()
              await configure(tx, conversation.id, planChange(mode))
            }, context),
          )
        })

      const setSkills = (sessionId: string, skillIds: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          yield* skills.resolve(skillIds)
          yield* updateMeta(sessionId, (meta) => {
            meta.attachedSkillIds = [...skillIds]
          })
          return yield* requireDetail(sessionId)
        })

      const cancelPendingApprovals = (conversation: Conversation) =>
        durable("operator-abort", (context) =>
          harness.commit(async (tx) => {
            const doc = await tx.doc(OperatorApprovalsDoc, conversation.id)
            for (const record of Object.values(doc.requests)) {
              if (record.status !== "pending") continue
              record.status = "canceled"
              record.resolvedAt = Date.now()
            }
          }, context),
        )

      const abort = (sessionId: string) =>
        Effect.gen(function* () {
          const { conversation } = yield* requireSession(sessionId)
          yield* durable("operator-abort", (context) => conversation.abort(context))
          yield* cancelPendingApprovals(conversation)
        })

      const remove = (sessionId: string) =>
        Effect.gen(function* () {
          const { conversation } = yield* requireSession(sessionId)
          yield* durable("operator-abort", (context) => conversation.abort(context))
          yield* cancelPendingApprovals(conversation)
          // pi-durable has no conversation deletion: the transcript stays in storage, unlisted.
          yield* durable("operator-delete", (context) =>
            harness.commit(async (tx) => {
              delete (await tx.doc(OperatorSessionsDoc)).sessions[sessionId]
            }, context),
          )
        })

      const prompt = (sessionId: string, text: string, requestId?: string) =>
        Effect.gen(function* () {
          const { conversation } = yield* requireSession(sessionId)
          yield* durable("operator-prompt", (context) =>
            conversation.submit(
              { type: "input", content: text, whenBusy: "followUp", ...(requestId === undefined ? {} : { requestId }) },
              context,
            ),
          )
          yield* updateMeta(sessionId, () => {})
        })

      const resolveApproval: OperatorSessionsShape["resolveApproval"] = (params) =>
        Effect.gen(function* () {
          const { conversation } = yield* requireSession(params.sessionId)
          yield* durable("operator-approval", (context) =>
            harness.commit(async (tx) => {
              const record = (await tx.doc(OperatorApprovalsDoc, conversation.id)).requests[params.approvalId]
              if (record === undefined) {
                throw new ManagementError({ code: "approval-not-found", message: `Approval ${params.approvalId} not found` })
              }
              if (record.status !== "pending") {
                throw new ManagementError({
                  code: "approval-already-resolved",
                  message: `Approval ${params.approvalId} is already ${record.status}`,
                })
              }
              record.status = params.decision
              record.resolvedAt = Date.now()
              if (params.actor !== undefined) record.actor = params.actor
              if (params.answer !== undefined) record.answer = params.answer
            }, context),
          )
        })

      const watch = (sessionId: string): Stream.Stream<OperatorSessionDetail, ManagementError> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const { conversation } = yield* requireSession(sessionId)
            const state = yield* available
            return Stream.callback<OperatorSessionDetail, ManagementError>(
              (queue) =>
                Effect.gen(function* () {
                  const sources = yield* Effect.acquireRelease(
                    durable("operator-watch", async (context) => ({
                      view: await conversation.viewState(context),
                      approvals: await harness.documentState(OperatorApprovalsDoc, conversation.id, context),
                      index: await harness.documentState(OperatorSessionsDoc, context),
                    })),
                    ({ view, approvals, index }) =>
                      Effect.sync(() => {
                        view.dispose()
                        approvals?.dispose()
                        index?.dispose()
                      }),
                  )
                  let timer: ReturnType<typeof setTimeout> | undefined
                  const publish = () => {
                    timer = undefined
                    const meta = sources.index?.value?.sessions[sessionId]
                    if (meta === undefined) {
                      Queue.failCauseUnsafe(queue, Cause.fail(notFound(sessionId)))
                      return
                    }
                    const approvals = sources.approvals?.value ?? undefined
                    Queue.offerUnsafe(queue, { ...projectSession(sessionId, meta, sources.view.value, approvals), ...state })
                  }
                  const schedule = () => {
                    timer ??= setTimeout(publish, WATCH_COALESCE_MS)
                  }
                  publish()
                  const unsubscribe = [
                    sources.view.subscribe(schedule),
                    sources.approvals?.subscribe(schedule),
                    sources.index?.subscribe(schedule),
                  ]
                  yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                      for (const stop of unsubscribe) stop?.()
                      if (timer !== undefined) clearTimeout(timer)
                    }),
                  )
                }),
              { bufferSize: 1, strategy: "sliding" },
            )
          }),
        )

      return {
        list,
        get,
        create,
        fork,
        setTitle: (sessionId, title) =>
          updateMeta(sessionId, (meta) => {
            meta.title = title.trim() || DEFAULT_TITLE
          }),
        setApprovalMode: (sessionId, mode) =>
          updateMeta(sessionId, (meta) => {
            meta.approvalMode = mode
          }),
        setPlanMode,
        setSkills,
        archive: (sessionId) =>
          updateMeta(sessionId, (meta) => {
            meta.archived = true
          }),
        delete: remove,
        prompt,
        abort,
        resolveApproval,
        watch,
      } satisfies OperatorSessionsShape
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
