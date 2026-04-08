import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Layer, Queue } from "effect"
import { OperatorSessions } from "../../src/services/operator-sessions.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"

const OperatorSessionsTestLayer = OperatorSessions.layer.pipe(
  Layer.provide(TestDatabaseLayer),
)

describe("OperatorSessions service", () => {
  it.layer(OperatorSessionsTestLayer)(
    "create + list + get returns a durable empty session",
    (it) => {
      it.effect("session is persisted and queryable", () =>
        Effect.gen(function* () {
          const sessions = yield* OperatorSessions

          const created = yield* sessions.create({
            title: "Disk pressure triage",
            selectedNodeIds: ["node-a", "node-b"],
            attachedSkillIds: [],
            modelProviderId: "openai",
            modelId: "gpt-5.4",
          })

          expect(created.session.title).toBe("Disk pressure triage")
          expect(created.session.selectedNodeIds).toEqual(["node-a", "node-b"])
          expect(created.events).toHaveLength(0)
          expect(created.entries).toHaveLength(0)
          expect(created.toolCalls).toHaveLength(0)
          expect(created.approvals).toHaveLength(0)

          const list = yield* sessions.list()
          expect(list).toHaveLength(1)
          expect(list[0]?.id).toBe(created.session.id)

          const loaded = yield* sessions.get(created.session.id)
          expect(loaded).not.toBeNull()
          expect(loaded?.session.id).toBe(created.session.id)
          expect(loaded?.events).toHaveLength(0)
          expect(loaded?.entries).toHaveLength(0)
        }),
      )
    },
  )

  it.layer(OperatorSessionsTestLayer)(
    "appendEvent persists ordered history and updates the session cursor",
    (it) => {
      it.effect("message and completion events replay in order", () =>
        Effect.gen(function* () {
          const sessions = yield* OperatorSessions
          const created = yield* sessions.create({
            title: "Session replay",
            selectedNodeIds: ["node-a"],
            attachedSkillIds: [],
            modelProviderId: "openai",
            modelId: "gpt-5.4",
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
              content: "check memory pressure",
              createdAt: Date.now(),
            },
          })

          yield* sessions.appendEvent({
            id: crypto.randomUUID(),
            sessionId: created.session.id,
            at: Date.now(),
            type: "session.completed",
            status: "completed",
            summary: "Investigation finished",
          })

          const loaded = yield* sessions.get(created.session.id)
          expect(loaded).not.toBeNull()
          expect(loaded?.session.lastEventSeq).toBe(2)
          expect(loaded?.session.status).toBe("completed")
          expect(loaded?.session.summary).toBe("Investigation finished")
          expect(loaded?.events.map((event) => event.seq)).toEqual([1, 2])
          expect(loaded?.entries).toHaveLength(1)
          expect(loaded?.entries[0]?.kind).toBe("message")
          expect(loaded?.session.currentLeafEntryId).toBe(loaded?.entries[0]?.id)
        }),
      )
    },
  )

  it.layer(OperatorSessionsTestLayer)(
    "subscribe streams new events for one session only",
    (it) => {
      it.effect("subscriber receives matching session events", () =>
        Effect.scoped(
          Effect.gen(function* () {
            const sessions = yield* OperatorSessions

            const first = yield* sessions.create({
              title: "First",
              selectedNodeIds: ["node-a"],
              attachedSkillIds: [],
              modelProviderId: "openai",
              modelId: "gpt-5.4",
            })
            const second = yield* sessions.create({
              title: "Second",
              selectedNodeIds: ["node-b"],
              attachedSkillIds: [],
              modelProviderId: "openai",
              modelId: "gpt-5.4",
            })

            const queue = yield* sessions.subscribe(first.session.id)
            const takeFiber = yield* Effect.forkScoped(Queue.take(queue))

            yield* sessions.appendEvent({
              id: crypto.randomUUID(),
              sessionId: second.session.id,
              at: Date.now(),
              type: "message.created",
              message: {
                id: crypto.randomUUID(),
                sessionId: second.session.id,
                role: "user",
                content: "ignore me",
                createdAt: Date.now(),
              },
            })

            yield* sessions.appendEvent({
              id: crypto.randomUUID(),
              sessionId: first.session.id,
              at: Date.now(),
              type: "message.created",
              message: {
                id: crypto.randomUUID(),
                sessionId: first.session.id,
                role: "user",
                content: "deliver me",
                createdAt: Date.now(),
              },
            })

            const delivered = yield* Fiber.join(takeFiber)
            expect(delivered.sessionId).toBe(first.session.id)
            expect(delivered.type).toBe("message.created")
            expect(delivered.message?.content).toBe("deliver me")
          }),
        ),
      )
    },
  )

  it.layer(OperatorSessionsTestLayer)(
    "branch rewinds the current leaf and fork materializes the selected path",
    (it) => {
      it.effect("branch + fork preserve a Pi-style tree shape", () =>
        Effect.gen(function* () {
          const sessions = yield* OperatorSessions
          const created = yield* sessions.create({
            title: "Branch me",
            selectedNodeIds: ["node-a"],
            attachedSkillIds: [],
            modelProviderId: "openai",
            modelId: "gpt-5.4",
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
              content: "inspect disk",
              createdAt: Date.now(),
            },
          })

          yield* sessions.appendEvent({
            id: crypto.randomUUID(),
            sessionId: created.session.id,
            at: Date.now() + 1,
            type: "message.created",
            message: {
              id: crypto.randomUUID(),
              sessionId: created.session.id,
              role: "assistant",
              content: "checking disk pressure",
              createdAt: Date.now() + 1,
            },
          })

          yield* sessions.appendEvent({
            id: crypto.randomUUID(),
            sessionId: created.session.id,
            at: Date.now() + 2,
            type: "tool.finished",
            toolCall: {
              id: crypto.randomUUID(),
              sessionId: created.session.id,
              name: "bash.run",
              status: "completed",
              nodeIds: ["node-a"],
              summary: "df -h complete",
              input: { command: "df -h" },
              output: { content: [{ type: "text", text: "disk output" }] },
              startedAt: Date.now() + 2,
              finishedAt: Date.now() + 3,
            },
          })

          const beforeBranch = yield* sessions.get(created.session.id)
          expect(beforeBranch).not.toBeNull()
          expect(beforeBranch?.entries).toHaveLength(3)

          const rewindTarget = beforeBranch?.entries[0]?.id ?? null
          const branched = yield* sessions.branch(created.session.id, rewindTarget)
          expect(branched.session.currentLeafEntryId).toBe(rewindTarget ?? undefined)

          yield* sessions.appendEvent({
            id: crypto.randomUUID(),
            sessionId: created.session.id,
            at: Date.now() + 4,
            type: "message.created",
            message: {
              id: crypto.randomUUID(),
              sessionId: created.session.id,
              role: "assistant",
              content: "taking a different path",
              createdAt: Date.now() + 4,
            },
          })

          const afterBranch = yield* sessions.get(created.session.id)
          const branchedLeaf = afterBranch?.entries.at(-1)
          expect(branchedLeaf?.parentEntryId).toBe(rewindTarget ?? undefined)

          const forked = yield* sessions.fork(
            created.session.id,
            branchedLeaf?.id ?? "",
            "Forked operator session",
          )
          expect(forked.session.parentSessionId).toBe(created.session.id)
          expect(forked.session.forkedFromEntryId).toBe(branchedLeaf?.id)
          expect(forked.entries.length).toBeGreaterThan(0)
          expect(forked.events.length).toBeGreaterThan(0)
          expect(forked.session.currentLeafEntryId).toBe(forked.entries.at(-1)?.id)
        }),
      )
    },
  )
})
