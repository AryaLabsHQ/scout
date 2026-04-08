import { Effect, Layer, PubSub, Queue } from "effect"
import type { Scope } from "effect/Scope"
import * as ServiceMap from "effect/ServiceMap"
import { desc, eq, ne } from "drizzle-orm"
import type {
  OperatorApprovalRequest,
  OperatorEntry,
  OperatorMessage,
  OperatorPlanSnapshot,
  OperatorSessionDetail,
  OperatorSessionEvent,
  OperatorSessionSummary,
  OperatorTerminalProjection,
  OperatorToolCall,
} from "@scout/shared"
import { ManagementError } from "@scout/shared"
import { Database } from "./database.js"
import * as schema from "../../drizzle/schema.js"

type OperatorSessionEventInput = Omit<OperatorSessionEvent, "seq">
type OperatorSessionCreateRecord = {
  readonly title?: string
  readonly selectedNodeIds: ReadonlyArray<string>
  readonly attachedSkillIds: ReadonlyArray<string>
  readonly modelProviderId: string
  readonly modelId: string
}

const dateToMillis = (value: Date | null | undefined): number | undefined =>
  value === null || value === undefined ? undefined : value.getTime()

const rowToSessionSummary = (
  row: typeof schema.operatorSessions.$inferSelect,
): OperatorSessionSummary => ({
  id: row.id,
  title: row.title,
  status: row.status as OperatorSessionSummary["status"],
  selectedNodeIds: (row.selectedNodeIds as string[]) ?? [],
  attachedSkillIds: (row.attachedSkillIds as string[]) ?? [],
  approvalMode: row.approvalMode as OperatorSessionSummary["approvalMode"],
  bypassMode: row.bypassMode as OperatorSessionSummary["bypassMode"],
  ...(dateToMillis(row.bypassExpiresAt) !== undefined
    ? { bypassExpiresAt: dateToMillis(row.bypassExpiresAt)! }
    : {}),
  ...(row.summary !== null && row.summary !== undefined ? { summary: row.summary } : {}),
  modelProviderId: row.modelProviderId,
  modelId: row.modelId,
  ...(row.parentSessionId !== null && row.parentSessionId !== undefined
    ? { parentSessionId: row.parentSessionId }
    : {}),
  ...(row.forkedFromEntryId !== null && row.forkedFromEntryId !== undefined
    ? { forkedFromEntryId: row.forkedFromEntryId }
    : {}),
  ...(row.currentLeafEntryId !== null && row.currentLeafEntryId !== undefined
    ? { currentLeafEntryId: row.currentLeafEntryId }
    : {}),
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
  lastEventSeq: row.lastEventSeq,
})

const rowToEvent = (
  row: typeof schema.operatorSessionEvents.$inferSelect,
): OperatorSessionEvent => row.payload as OperatorSessionEvent

const rowToEntry = (
  row: typeof schema.operatorEntries.$inferSelect,
): OperatorEntry => ({
  id: row.id,
  sessionId: row.sessionId,
  ...(row.parentEntryId !== null && row.parentEntryId !== undefined
    ? { parentEntryId: row.parentEntryId }
    : {}),
  ...(row.sourceEventId !== null && row.sourceEventId !== undefined
    ? { sourceEventId: row.sourceEventId }
    : {}),
  kind: row.kind as OperatorEntry["kind"],
  ...(row.role !== null && row.role !== undefined ? { role: row.role as OperatorEntry["role"] } : {}),
  createdAt: row.createdAt.getTime(),
  data: row.data,
})

const rowToToolCall = (
  row: typeof schema.operatorToolCalls.$inferSelect,
): OperatorToolCall => ({
  id: row.id,
  sessionId: row.sessionId,
  ...(row.entryId !== null && row.entryId !== undefined ? { entryId: row.entryId } : {}),
  name: row.name,
  status: row.status as OperatorToolCall["status"],
  nodeIds: (row.nodeIds as string[]) ?? [],
  ...(row.summary !== null && row.summary !== undefined ? { summary: row.summary } : {}),
  ...(row.input !== null && row.input !== undefined ? { input: row.input } : {}),
  ...(row.output !== null && row.output !== undefined ? { output: row.output } : {}),
  startedAt: row.startedAt.getTime(),
  ...(dateToMillis(row.finishedAt) !== undefined ? { finishedAt: dateToMillis(row.finishedAt)! } : {}),
})

const rowToApproval = (
  row: typeof schema.operatorApprovals.$inferSelect,
): OperatorApprovalRequest => ({
  id: row.id,
  sessionId: row.sessionId,
  ...(row.entryId !== null && row.entryId !== undefined ? { entryId: row.entryId } : {}),
  ...(row.toolCallId !== null && row.toolCallId !== undefined ? { toolCallId: row.toolCallId } : {}),
  reason: row.reason,
  affectedNodeIds: (row.affectedNodeIds as string[]) ?? [],
  kind: row.kind as OperatorApprovalRequest["kind"],
  status: row.status as OperatorApprovalRequest["status"],
  requestedAt: row.requestedAt.getTime(),
  ...(dateToMillis(row.resolvedAt) !== undefined ? { resolvedAt: dateToMillis(row.resolvedAt)! } : {}),
})

const rowToTerminalProjection = (
  row: typeof schema.operatorTerminalProjections.$inferSelect,
): OperatorTerminalProjection => ({
  id: row.id,
  sessionId: row.sessionId,
  toolCallId: row.toolCallId,
  ...(row.entryId !== null && row.entryId !== undefined ? { entryId: row.entryId } : {}),
  nodeId: row.nodeId,
  mode: row.mode as OperatorTerminalProjection["mode"],
  streamRef: row.streamRef,
  createdAt: row.createdAt.getTime(),
})

const rowToPlanSnapshot = (
  row: typeof schema.operatorPlanSnapshots.$inferSelect,
): OperatorPlanSnapshot => ({
  id: row.id,
  sessionId: row.sessionId,
  ...(row.entryId !== null && row.entryId !== undefined ? { entryId: row.entryId } : {}),
  status: row.status as OperatorPlanSnapshot["status"],
  summary: row.summary,
  data: row.data,
  updatedAt: row.updatedAt.getTime(),
})

const operatorDetailFromRows = (args: {
  readonly session: typeof schema.operatorSessions.$inferSelect
  readonly events: ReadonlyArray<typeof schema.operatorSessionEvents.$inferSelect>
  readonly entries: ReadonlyArray<typeof schema.operatorEntries.$inferSelect>
  readonly toolCalls: ReadonlyArray<typeof schema.operatorToolCalls.$inferSelect>
  readonly approvals: ReadonlyArray<typeof schema.operatorApprovals.$inferSelect>
  readonly terminalProjections: ReadonlyArray<typeof schema.operatorTerminalProjections.$inferSelect>
  readonly planSnapshots: ReadonlyArray<typeof schema.operatorPlanSnapshots.$inferSelect>
}): OperatorSessionDetail => ({
  session: rowToSessionSummary(args.session),
  events: args.events.map(rowToEvent),
  entries: args.entries.map(rowToEntry),
  toolCalls: args.toolCalls.map(rowToToolCall),
  approvals: args.approvals.map(rowToApproval),
  terminalProjections: args.terminalProjections.map(rowToTerminalProjection),
  planSnapshots: args.planSnapshots.map(rowToPlanSnapshot),
  availableSkills: [],
  availableResources: [],
  availableModels: [],
})

const getEntryPath = (
  entries: ReadonlyArray<OperatorEntry>,
  leafEntryId: string | null | undefined,
): ReadonlyArray<OperatorEntry> => {
  if (leafEntryId === null || leafEntryId === undefined) {
    return []
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const path: Array<OperatorEntry> = []
  let cursor: string | undefined = leafEntryId
  const visited = new Set<string>()

  while (cursor !== undefined) {
    if (visited.has(cursor)) {
      throw new Error(`Operator entry cycle detected at ${cursor}`)
    }

    visited.add(cursor)
    const entry = byId.get(cursor)
    if (!entry) {
      throw new Error(`Operator entry ${cursor} not found`)
    }

    path.push(entry)
    cursor = entry.parentEntryId
  }

  return path.reverse()
}

const eventToSessionUpdates = (
  event: OperatorSessionEvent,
  session: typeof schema.operatorSessions.$inferSelect,
  currentLeafEntryId?: string | null,
): Partial<typeof schema.operatorSessions.$inferInsert> => {
  const updates: Partial<typeof schema.operatorSessions.$inferInsert> = {
    updatedAt: new Date(event.at),
    lastEventSeq: event.seq,
  }

  if (currentLeafEntryId !== undefined) {
    updates.currentLeafEntryId = currentLeafEntryId
  }

  if (event.type === "session.completed") {
    updates.status = event.status
    if (event.summary !== undefined) updates.summary = event.summary
  } else if (event.type === "approval.requested") {
    updates.status = "waiting_for_user"
  } else if (
    event.type === "approval.resolved" ||
    (event.type === "message.created" && event.message?.role === "user")
  ) {
    updates.status = "active"
  }

  if (event.type === "bypass.updated") {
    updates.bypassMode = event.bypassMode ?? session.bypassMode
    updates.bypassExpiresAt =
      event.bypassExpiresAt !== undefined ? new Date(event.bypassExpiresAt) : null
  }

  return updates
}

const operatorManagementError = (code: string, message: string): ManagementError =>
  new ManagementError({ code, message })

export class OperatorSessions extends ServiceMap.Service<
  OperatorSessions,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<OperatorSessionSummary>>
    readonly get: (sessionId: string) => Effect.Effect<OperatorSessionDetail | null>
    readonly create: (params: OperatorSessionCreateRecord) => Effect.Effect<OperatorSessionDetail>
    readonly appendEvent: (event: OperatorSessionEventInput) => Effect.Effect<OperatorSessionEvent>
    readonly setSkills: (
      sessionId: string,
      skillIds: ReadonlyArray<string>,
    ) => Effect.Effect<OperatorSessionDetail | null, ManagementError>
    readonly branch: (
      sessionId: string,
      entryId: string | null,
    ) => Effect.Effect<OperatorSessionDetail, ManagementError>
    readonly fork: (
      sessionId: string,
      entryId: string,
      title?: string,
    ) => Effect.Effect<OperatorSessionDetail, ManagementError>
    readonly setTitle: (
      sessionId: string,
      title: string,
    ) => Effect.Effect<void, ManagementError>
    readonly archive: (
      sessionId: string,
    ) => Effect.Effect<void, ManagementError>
    readonly delete: (
      sessionId: string,
    ) => Effect.Effect<void, ManagementError>
    readonly publishTransient: (event: OperatorSessionEvent) => Effect.Effect<void>
    readonly subscribe: (
      sessionId: string,
      afterSeq?: number,
    ) => Effect.Effect<Queue.Queue<OperatorSessionEvent>, never, Scope>
  }
>()(
  "@scout/OperatorSessions",
  {
    make: Effect.gen(function* () {
      const db = yield* Database
      const events = yield* PubSub.unbounded<OperatorSessionEvent>()

      const get: (sessionId: string) => Effect.Effect<OperatorSessionDetail | null> = (sessionId) =>
        Effect.sync(() => {
          const session = db
            .select()
            .from(schema.operatorSessions)
            .where(eq(schema.operatorSessions.id, sessionId))
            .get()

          if (!session) {
            return null
          }

          const eventRows = db
            .select()
            .from(schema.operatorSessionEvents)
            .where(eq(schema.operatorSessionEvents.sessionId, sessionId))
            .orderBy(schema.operatorSessionEvents.seq)
            .all()

          const entryRows = db
            .select()
            .from(schema.operatorEntries)
            .where(eq(schema.operatorEntries.sessionId, sessionId))
            .orderBy(schema.operatorEntries.createdAt)
            .all()

          const toolCallRows = db
            .select()
            .from(schema.operatorToolCalls)
            .where(eq(schema.operatorToolCalls.sessionId, sessionId))
            .orderBy(schema.operatorToolCalls.startedAt)
            .all()

          const approvalRows = db
            .select()
            .from(schema.operatorApprovals)
            .where(eq(schema.operatorApprovals.sessionId, sessionId))
            .orderBy(schema.operatorApprovals.requestedAt)
            .all()

          const terminalProjectionRows = db
            .select()
            .from(schema.operatorTerminalProjections)
            .where(eq(schema.operatorTerminalProjections.sessionId, sessionId))
            .orderBy(schema.operatorTerminalProjections.createdAt)
            .all()

          const planSnapshotRows = db
            .select()
            .from(schema.operatorPlanSnapshots)
            .where(eq(schema.operatorPlanSnapshots.sessionId, sessionId))
            .orderBy(schema.operatorPlanSnapshots.updatedAt)
            .all()

          return operatorDetailFromRows({
            session,
            events: eventRows,
            entries: entryRows,
            toolCalls: toolCallRows,
            approvals: approvalRows,
            terminalProjections: terminalProjectionRows,
            planSnapshots: planSnapshotRows,
          })
        })

      const list: () => Effect.Effect<ReadonlyArray<OperatorSessionSummary>> = () =>
        Effect.sync(() =>
          db.select().from(schema.operatorSessions)
            .where(ne(schema.operatorSessions.status, "archived"))
            .orderBy(desc(schema.operatorSessions.updatedAt))
            .all(),
        ).pipe(Effect.map((rows) => rows.map(rowToSessionSummary)))

      const create: (params: OperatorSessionCreateRecord) => Effect.Effect<OperatorSessionDetail> = (params) =>
        Effect.sync(() => {
          const now = new Date()
          const id = crypto.randomUUID()
          const title = params.title?.trim() || "New operator session"

          db.insert(schema.operatorSessions).values({
            id,
            title,
            status: "active",
            selectedNodeIds: [...params.selectedNodeIds],
            attachedSkillIds: [...params.attachedSkillIds],
            approvalMode: "confirm_each_mutation",
            bypassMode: "off",
            modelProviderId: params.modelProviderId,
            modelId: params.modelId,
            currentLeafEntryId: null,
            createdAt: now,
            updatedAt: now,
            lastEventSeq: 0,
          }).run()

          return {
            session: {
              id,
              title,
              status: "active",
              selectedNodeIds: [...params.selectedNodeIds],
              attachedSkillIds: [...params.attachedSkillIds],
              approvalMode: "confirm_each_mutation",
              bypassMode: "off",
              modelProviderId: params.modelProviderId,
              modelId: params.modelId,
              createdAt: now.getTime(),
              updatedAt: now.getTime(),
              lastEventSeq: 0,
            },
            events: [],
            entries: [],
            toolCalls: [],
            approvals: [],
            terminalProjections: [],
            planSnapshots: [],
            availableSkills: [],
            availableResources: [],
            availableModels: [],
          } satisfies OperatorSessionDetail
        })

      const appendEvent: (
        event: OperatorSessionEventInput,
      ) => Effect.Effect<OperatorSessionEvent> = (event) =>
        Effect.gen(function* () {
          const persistedEvent = yield* Effect.sync(() => {
            let nextEvent: OperatorSessionEvent | null = null

            db.$client.transaction(() => {
              const session = db
                .select()
                .from(schema.operatorSessions)
                .where(eq(schema.operatorSessions.id, event.sessionId))
                .get()

              if (!session) {
                throw new Error(`Operator session ${event.sessionId} not found`)
              }

              nextEvent = {
                ...event,
                seq: session.lastEventSeq + 1,
              }

              db.insert(schema.operatorSessionEvents).values({
                id: nextEvent.id,
                sessionId: nextEvent.sessionId,
                seq: nextEvent.seq,
                at: new Date(nextEvent.at),
                type: nextEvent.type,
                payload: nextEvent,
              }).run()

              let nextLeafId: string | null | undefined

              if (nextEvent.type === "message.created" && nextEvent.message !== undefined) {
                const entryId = crypto.randomUUID()
                db.insert(schema.operatorEntries).values({
                  id: entryId,
                  sessionId: nextEvent.sessionId,
                  parentEntryId: session.currentLeafEntryId,
                  sourceEventId: nextEvent.id,
                  kind: "message",
                  role: nextEvent.message.role,
                  createdAt: new Date(nextEvent.message.createdAt),
                  data: nextEvent.message,
                }).run()
                nextLeafId = entryId
              }

              if (nextEvent.type === "tool.started" && nextEvent.toolCall !== undefined) {
                db.insert(schema.operatorToolCalls).values({
                  id: nextEvent.toolCall.id,
                  sessionId: nextEvent.sessionId,
                  nodeIds: nextEvent.toolCall.nodeIds,
                  name: nextEvent.toolCall.name,
                  status: nextEvent.toolCall.status,
                  summary: nextEvent.toolCall.summary ?? null,
                  input: nextEvent.toolCall.input ?? null,
                  output: nextEvent.toolCall.output ?? null,
                  startedAt: new Date(nextEvent.toolCall.startedAt),
                  finishedAt:
                    nextEvent.toolCall.finishedAt !== undefined
                      ? new Date(nextEvent.toolCall.finishedAt)
                      : null,
                }).onConflictDoUpdate({
                  target: schema.operatorToolCalls.id,
                  set: {
                    sessionId: nextEvent.sessionId,
                    nodeIds: nextEvent.toolCall.nodeIds,
                    name: nextEvent.toolCall.name,
                    status: nextEvent.toolCall.status,
                    summary: nextEvent.toolCall.summary ?? null,
                    input: nextEvent.toolCall.input ?? null,
                    output: nextEvent.toolCall.output ?? null,
                    startedAt: new Date(nextEvent.toolCall.startedAt),
                    finishedAt:
                      nextEvent.toolCall.finishedAt !== undefined
                        ? new Date(nextEvent.toolCall.finishedAt)
                        : null,
                  },
                }).run()
              }

              if (nextEvent.type === "tool.finished" && nextEvent.toolCall !== undefined) {
                const entryId = crypto.randomUUID()
                db.insert(schema.operatorEntries).values({
                  id: entryId,
                  sessionId: nextEvent.sessionId,
                  parentEntryId: session.currentLeafEntryId,
                  sourceEventId: nextEvent.id,
                  kind: "tool_result",
                  createdAt: new Date(nextEvent.toolCall.finishedAt ?? nextEvent.toolCall.startedAt),
                  data: {
                    toolCall: nextEvent.toolCall,
                  },
                }).run()

                db.insert(schema.operatorToolCalls).values({
                  id: nextEvent.toolCall.id,
                  sessionId: nextEvent.sessionId,
                  entryId,
                  nodeIds: nextEvent.toolCall.nodeIds,
                  name: nextEvent.toolCall.name,
                  status: nextEvent.toolCall.status,
                  summary: nextEvent.toolCall.summary ?? null,
                  input: nextEvent.toolCall.input ?? null,
                  output: nextEvent.toolCall.output ?? null,
                  startedAt: new Date(nextEvent.toolCall.startedAt),
                  finishedAt:
                    nextEvent.toolCall.finishedAt !== undefined
                      ? new Date(nextEvent.toolCall.finishedAt)
                      : null,
                }).onConflictDoUpdate({
                  target: schema.operatorToolCalls.id,
                  set: {
                    sessionId: nextEvent.sessionId,
                    entryId,
                    nodeIds: nextEvent.toolCall.nodeIds,
                    name: nextEvent.toolCall.name,
                    status: nextEvent.toolCall.status,
                    summary: nextEvent.toolCall.summary ?? null,
                    input: nextEvent.toolCall.input ?? null,
                    output: nextEvent.toolCall.output ?? null,
                    startedAt: new Date(nextEvent.toolCall.startedAt),
                    finishedAt:
                      nextEvent.toolCall.finishedAt !== undefined
                        ? new Date(nextEvent.toolCall.finishedAt)
                        : null,
                  },
                }).run()

                nextLeafId = entryId
              }

              if (nextEvent.type === "approval.requested" && nextEvent.approval !== undefined) {
                db.insert(schema.operatorApprovals).values({
                  id: nextEvent.approval.id,
                  sessionId: nextEvent.sessionId,
                  entryId: nextEvent.approval.entryId ?? null,
                  toolCallId: nextEvent.approval.toolCallId ?? null,
                  kind: nextEvent.approval.kind,
                  status: nextEvent.approval.status,
                  reason: nextEvent.approval.reason,
                  affectedNodeIds: nextEvent.approval.affectedNodeIds,
                  requestedAt: new Date(nextEvent.approval.requestedAt),
                  resolvedAt:
                    nextEvent.approval.resolvedAt !== undefined
                      ? new Date(nextEvent.approval.resolvedAt)
                      : null,
                }).onConflictDoUpdate({
                  target: schema.operatorApprovals.id,
                  set: {
                    entryId: nextEvent.approval.entryId ?? null,
                    toolCallId: nextEvent.approval.toolCallId ?? null,
                    kind: nextEvent.approval.kind,
                    status: nextEvent.approval.status,
                    reason: nextEvent.approval.reason,
                    affectedNodeIds: nextEvent.approval.affectedNodeIds,
                    requestedAt: new Date(nextEvent.approval.requestedAt),
                    resolvedAt:
                      nextEvent.approval.resolvedAt !== undefined
                        ? new Date(nextEvent.approval.resolvedAt)
                        : null,
                  },
                }).run()
              }

              if (nextEvent.type === "approval.resolved" && nextEvent.approval !== undefined) {
                db.insert(schema.operatorApprovals).values({
                  id: nextEvent.approval.id,
                  sessionId: nextEvent.sessionId,
                  entryId: nextEvent.approval.entryId ?? null,
                  toolCallId: nextEvent.approval.toolCallId ?? null,
                  kind: nextEvent.approval.kind,
                  status: nextEvent.approval.status,
                  reason: nextEvent.approval.reason,
                  affectedNodeIds: nextEvent.approval.affectedNodeIds,
                  requestedAt: new Date(nextEvent.approval.requestedAt),
                  resolvedAt:
                    nextEvent.approval.resolvedAt !== undefined
                      ? new Date(nextEvent.approval.resolvedAt)
                      : null,
                }).onConflictDoUpdate({
                  target: schema.operatorApprovals.id,
                  set: {
                    entryId: nextEvent.approval.entryId ?? null,
                    toolCallId: nextEvent.approval.toolCallId ?? null,
                    kind: nextEvent.approval.kind,
                    status: nextEvent.approval.status,
                    reason: nextEvent.approval.reason,
                    affectedNodeIds: nextEvent.approval.affectedNodeIds,
                    requestedAt: new Date(nextEvent.approval.requestedAt),
                    resolvedAt:
                      nextEvent.approval.resolvedAt !== undefined
                        ? new Date(nextEvent.approval.resolvedAt)
                        : null,
                  },
                }).run()
              }

              if (nextEvent.type === "plan.updated" && nextEvent.plan !== undefined) {
                db.insert(schema.operatorPlanSnapshots).values({
                  id: nextEvent.plan.id,
                  sessionId: nextEvent.sessionId,
                  status: nextEvent.plan.status,
                  summary: nextEvent.plan.summary,
                  data: nextEvent.plan,
                  updatedAt: new Date(nextEvent.plan.updatedAt),
                }).onConflictDoUpdate({
                  target: schema.operatorPlanSnapshots.id,
                  set: {
                    status: nextEvent.plan.status,
                    summary: nextEvent.plan.summary,
                    data: nextEvent.plan,
                    updatedAt: new Date(nextEvent.plan.updatedAt),
                  },
                }).run()
              }

              if (nextEvent.type === "terminal.projected" && nextEvent.projection !== undefined) {
                db.insert(schema.operatorTerminalProjections).values({
                  id: nextEvent.projection.id,
                  sessionId: nextEvent.sessionId,
                  toolCallId: nextEvent.projection.toolCallId,
                  entryId: nextEvent.projection.entryId ?? null,
                  nodeId: nextEvent.projection.nodeId,
                  mode: nextEvent.projection.mode,
                  streamRef: nextEvent.projection.streamRef,
                  createdAt: new Date(nextEvent.projection.createdAt ?? nextEvent.at),
                }).onConflictDoUpdate({
                  target: schema.operatorTerminalProjections.id,
                  set: {
                    toolCallId: nextEvent.projection.toolCallId,
                    entryId: nextEvent.projection.entryId ?? null,
                    nodeId: nextEvent.projection.nodeId,
                    mode: nextEvent.projection.mode,
                    streamRef: nextEvent.projection.streamRef,
                    createdAt: new Date(nextEvent.projection.createdAt ?? nextEvent.at),
                  },
                }).run()
              }

              if (nextEvent.type === "skills.updated") {
                db.update(schema.operatorSessions)
                  .set({
                    attachedSkillIds: nextEvent.skillIds ?? [],
                  })
                  .where(eq(schema.operatorSessions.id, nextEvent.sessionId))
                  .run()
              }

              db.update(schema.operatorSessions)
                .set(eventToSessionUpdates(nextEvent, session, nextLeafId))
                .where(eq(schema.operatorSessions.id, nextEvent.sessionId))
                .run()
            })()

            if (nextEvent === null) {
              throw new Error("Failed to persist operator event")
            }

            return nextEvent
          })

          yield* PubSub.publish(events, persistedEvent)
          return persistedEvent
        }).pipe(Effect.orDie)

      const setSkills: (
        sessionId: string,
        skillIds: ReadonlyArray<string>,
      ) => Effect.Effect<OperatorSessionDetail | null, ManagementError> = (sessionId, skillIds) =>
        Effect.sync(() => {
          const session = db
            .select()
            .from(schema.operatorSessions)
            .where(eq(schema.operatorSessions.id, sessionId))
            .get()

          if (!session) {
            return null
          }

          db.update(schema.operatorSessions)
            .set({
              attachedSkillIds: [...skillIds],
              updatedAt: new Date(),
            })
            .where(eq(schema.operatorSessions.id, sessionId))
            .run()

          return get(sessionId).pipe(Effect.runSync)
        }).pipe(
          Effect.flatMap((detail) =>
            detail === null
              ? Effect.fail(
                  operatorManagementError(
                    "session-not-found",
                    `Operator session ${sessionId} not found`,
                  ),
                )
              : Effect.succeed(detail),
          ),
        )

      const branch: (
        sessionId: string,
        entryId: string | null,
      ) => Effect.Effect<OperatorSessionDetail, ManagementError> = (sessionId, entryId) =>
        Effect.gen(function* () {
          const session = yield* Effect.sync(() =>
            db.select()
              .from(schema.operatorSessions)
              .where(eq(schema.operatorSessions.id, sessionId))
              .get(),
          )

          if (!session) {
            return yield* Effect.fail(
              operatorManagementError(
                "session-not-found",
                `Operator session ${sessionId} not found`,
              ),
            )
          }

          if (entryId !== null) {
            const entry = yield* Effect.sync(() =>
              db.select()
                .from(schema.operatorEntries)
                .where(eq(schema.operatorEntries.id, entryId))
                .get(),
            )

            if (!entry || entry.sessionId !== sessionId) {
              return yield* Effect.fail(
                operatorManagementError(
                  "operator-entry-not-found",
                  `Operator entry ${entryId} not found in session ${sessionId}`,
                ),
              )
            }
          }

          yield* Effect.sync(() => {
            db.update(schema.operatorSessions)
              .set({
                currentLeafEntryId: entryId,
                updatedAt: new Date(),
              })
              .where(eq(schema.operatorSessions.id, sessionId))
              .run()
          })

          const detail = yield* get(sessionId)
          if (detail === null) {
            return yield* Effect.fail(
              operatorManagementError(
                "session-not-found",
                `Operator session ${sessionId} not found after branching`,
              ),
            )
          }

          return detail
        })

      const fork: (
        sessionId: string,
        entryId: string,
        title?: string,
      ) => Effect.Effect<OperatorSessionDetail, ManagementError> = (sessionId, entryId, title) =>
        Effect.gen(function* () {
          const detail = yield* get(sessionId)
          if (detail === null) {
            return yield* Effect.fail(
              operatorManagementError(
                "session-not-found",
                `Operator session ${sessionId} not found`,
              ),
            )
          }

          const entry = detail.entries.find((candidate) => candidate.id === entryId)
          if (!entry) {
            return yield* Effect.fail(
              operatorManagementError(
                "operator-entry-not-found",
                `Operator entry ${entryId} not found in session ${sessionId}`,
              ),
            )
          }

          const path = getEntryPath(detail.entries, entryId)
          const childId = crypto.randomUUID()
          const now = new Date()
          const childTitle = title?.trim() || `${detail.session.title} (fork)`

          yield* Effect.sync(() => {
            db.insert(schema.operatorSessions).values({
              id: childId,
              title: childTitle,
            status: "active",
            selectedNodeIds: [...detail.session.selectedNodeIds],
            attachedSkillIds: [...detail.session.attachedSkillIds],
            approvalMode: detail.session.approvalMode,
            bypassMode: "off",
            modelProviderId: detail.session.modelProviderId,
            modelId: detail.session.modelId,
            parentSessionId: detail.session.id,
            forkedFromEntryId: entryId,
            currentLeafEntryId: null,
              createdAt: now,
              updatedAt: now,
              lastEventSeq: 0,
            }).run()
          })

          for (const pathEntry of path) {
            if (pathEntry.kind === "message") {
              const message = pathEntry.data as OperatorMessage
              yield* appendEvent({
                id: crypto.randomUUID(),
                sessionId: childId,
                at: pathEntry.createdAt,
                type: "message.created",
                message: {
                  ...message,
                  id: crypto.randomUUID(),
                  sessionId: childId,
                },
              })
              continue
            }

            if (pathEntry.kind === "tool_result") {
              const toolCallData =
                typeof pathEntry.data === "object" &&
                pathEntry.data !== null &&
                "toolCall" in pathEntry.data
                  ? (pathEntry.data.toolCall as OperatorToolCall | undefined)
                  : undefined

              if (toolCallData !== undefined) {
                yield* appendEvent({
                  id: crypto.randomUUID(),
                  sessionId: childId,
                  at: toolCallData.finishedAt ?? toolCallData.startedAt,
                  type: "tool.finished",
                  toolCall: {
                    ...toolCallData,
                    id: crypto.randomUUID(),
                    sessionId: childId,
                  },
                })
              }
            }
          }

          const childDetail = yield* get(childId)
          if (childDetail === null) {
            return yield* Effect.fail(
              operatorManagementError(
                "session-not-found",
                `Operator fork ${childId} not found`,
              ),
            )
          }

          return childDetail
        })

      const setTitle: (
        sessionId: string,
        title: string,
      ) => Effect.Effect<void, ManagementError> = (sessionId, title) =>
        Effect.gen(function* () {
          const session = yield* Effect.sync(() =>
            db.select()
              .from(schema.operatorSessions)
              .where(eq(schema.operatorSessions.id, sessionId))
              .get(),
          )

          if (!session) {
            return yield* Effect.fail(
              operatorManagementError(
                "session-not-found",
                `Operator session ${sessionId} not found`,
              ),
            )
          }

          yield* Effect.sync(() => {
            db.update(schema.operatorSessions)
              .set({
                title,
                updatedAt: new Date(),
              })
              .where(eq(schema.operatorSessions.id, sessionId))
              .run()
          })
        })

      const archive: (
        sessionId: string,
      ) => Effect.Effect<void, ManagementError> = (sessionId) =>
        Effect.gen(function* () {
          const session = yield* Effect.sync(() =>
            db.select()
              .from(schema.operatorSessions)
              .where(eq(schema.operatorSessions.id, sessionId))
              .get(),
          )

          if (!session) {
            return yield* Effect.fail(
              operatorManagementError(
                "session-not-found",
                `Operator session ${sessionId} not found`,
              ),
            )
          }

          yield* Effect.sync(() => {
            db.update(schema.operatorSessions)
              .set({
                status: "archived",
                updatedAt: new Date(),
              })
              .where(eq(schema.operatorSessions.id, sessionId))
              .run()
          })
        })

      const del: (
        sessionId: string,
      ) => Effect.Effect<void, ManagementError> = (sessionId) =>
        Effect.gen(function* () {
          const session = yield* Effect.sync(() =>
            db.select()
              .from(schema.operatorSessions)
              .where(eq(schema.operatorSessions.id, sessionId))
              .get(),
          )

          if (!session) {
            return yield* Effect.fail(
              operatorManagementError(
                "session-not-found",
                `Operator session ${sessionId} not found`,
              ),
            )
          }

          yield* Effect.sync(() => {
            db.delete(schema.operatorSessions)
              .where(eq(schema.operatorSessions.id, sessionId))
              .run()
          })
        })

      const subscribe: (
        sessionId: string,
        afterSeq?: number,
      ) => Effect.Effect<Queue.Queue<OperatorSessionEvent>, never, Scope> = (sessionId, afterSeq) =>
        Effect.gen(function* () {
          const queue = yield* Queue.unbounded<OperatorSessionEvent>()
          if (afterSeq !== undefined) {
            const historical = yield* Effect.sync(() =>
              db.select()
                .from(schema.operatorSessionEvents)
                .where(eq(schema.operatorSessionEvents.sessionId, sessionId))
                .orderBy(schema.operatorSessionEvents.seq)
                .all()
                .filter((row) => row.seq > afterSeq)
                .map(rowToEvent),
            )

            for (const event of historical) {
              yield* Queue.offer(queue, event)
            }
          }

          const sub = yield* PubSub.subscribe(events)
          yield* Effect.forkScoped(
            Effect.forever(
              Effect.gen(function* () {
                const event = yield* PubSub.take(sub)
                if (event.sessionId === sessionId) {
                  yield* Queue.offer(queue, event)
                }
              }),
            ),
          )

          return queue
        })

      const publishTransient = (event: OperatorSessionEvent) =>
        PubSub.publish(events, event).pipe(Effect.asVoid)

      return {
        list,
        get,
        create,
        appendEvent,
        setSkills,
        setTitle,
        archive,
        delete: del,
        branch,
        fork,
        publishTransient,
        subscribe,
      }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
