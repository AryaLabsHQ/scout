import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Effect, Fiber, Stream } from "effect"
import {
  fauxAssistantMessage,
  type FauxResponseStep,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import type { OperatorSessionDetail, OperatorTimelineItem } from "@scout/shared"
import * as imagesBoundary from "../../src/services/operator-images.js"
import * as imageCodecs from "../../src/services/operator-image-codecs.js"
import { Database } from "bun:sqlite"
import { OperatorSessions } from "../../src/services/operator-sessions.js"
import { executed, faux, operatorLayer } from "../helpers/operator.js"

/** Run against the operator storage at `path`; the Harness closes when this returns, like a hub stop. */
const withOperator = <A>(
  path: string,
  use: (sessions: typeof OperatorSessions.Service) => Effect.Effect<A, unknown>,
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        return yield* use(yield* OperatorSessions)
      }),
    ).pipe(Effect.provide(operatorLayer(path))) as Effect.Effect<A, unknown>,
  )

/** Poll the session detail until `predicate` holds. */
const waitFor = (
  sessions: typeof OperatorSessions.Service,
  sessionId: string,
  predicate: (detail: OperatorSessionDetail) => boolean,
) =>
  Effect.gen(function* () {
    let last: OperatorSessionDetail | null = null
    for (let attempt = 0; attempt < 500; attempt++) {
      last = yield* sessions.get(sessionId)
      if (last !== null && predicate(last)) return last
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.die(new Error(`Timed out waiting; last detail: ${JSON.stringify(last, null, 2)}`))
  })

const toolItems = (detail: OperatorSessionDetail) =>
  detail.timeline.filter(
    (item): item is Extract<OperatorTimelineItem, { kind: "tool" }> => item.kind === "tool",
  )

const lastAssistantText = (detail: OperatorSessionDetail) =>
  detail.timeline.filter((item) => item.kind === "assistant").at(-1)?.text

const isIdle = (detail: OperatorSessionDetail) => detail.session.status === "idle"

const script = (...steps: Array<FauxResponseStep>) => faux.setResponses(steps)

const mutatingBash = (command: string) =>
  fauxAssistantMessage(
    fauxToolCall("bash_run", { nodeId: "node-a", label: "restart", command, isMutation: true }),
    {
      stopReason: "toolUse",
    },
  )

// ── Tests ────────────────────────────────────────────────────────────────────

let directory: string
let storagePath: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "scout-operator-"))
  storagePath = join(directory, "operator.sqlite")
  executed.length = 0
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

const createSession = (sessions: typeof OperatorSessions.Service) =>
  sessions
    .create({ title: "Test", selectedNodeIds: ["node-a"] })
    .pipe(Effect.map((detail) => detail.session.id))

describe("OperatorSessions on pi-durable", () => {
  it("answers a prompt through a read-only tool call", async () => {
    script(
      fauxAssistantMessage(
        fauxToolCall("bash_run", { nodeId: "node-a", label: "uptime", command: "uptime", isMutation: false }),
        {
          stopReason: "toolUse",
        },
      ),
      fauxAssistantMessage("The node is up."),
    )
    const detail = await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const id = yield* createSession(sessions)
        yield* sessions.prompt(id, "Is node-a up?")
        return yield* waitFor(
          sessions,
          id,
          (detail) => isIdle(detail) && lastAssistantText(detail) === "The node is up.",
        )
      }),
    )
    expect(executed).toEqual(["bash:uptime"])
    const [tool] = toolItems(detail)
    expect(tool).toMatchObject({ name: "bash_run", status: "completed", output: "ran uptime" })
    expect(tool?.terminal).toMatchObject({ nodeId: "node-a", terminalSessionId: "term-1" })
    expect(detail.timeline[0]).toMatchObject({ kind: "user", text: "Is node-a up?" })
    expect(detail.approvals).toEqual([])
  })

  it("does not execute a mutating call before approval, then executes it once", async () => {
    script(mutatingBash("systemctl restart nginx"), fauxAssistantMessage("Restarted."))
    await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const id = yield* createSession(sessions)
        yield* sessions.prompt(id, "Restart nginx")
        const waiting = yield* waitFor(sessions, id, (detail) => detail.session.status === "waiting_for_user")
        yield* Effect.sleep("50 millis")
        expect(executed).toEqual([])
        const approval = waiting.approvals[0]!
        expect(approval).toMatchObject({
          kind: "mutation",
          status: "pending",
          reason: "restart",
          affectedNodeIds: ["node-a"],
        })
        expect(toolItems(waiting)[0]?.approvalId).toBe(approval.id)
        yield* sessions.resolveApproval({
          sessionId: id,
          approvalId: approval.id,
          decision: "approved",
          actor: "ops@example.com",
        })
        const done = yield* waitFor(
          sessions,
          id,
          (detail) => isIdle(detail) && lastAssistantText(detail) === "Restarted.",
        )
        expect(done.approvals[0]).toMatchObject({ status: "approved", actor: "ops@example.com" })
      }),
    )
    expect(executed).toEqual(["bash:systemctl restart nginx"])
  })

  it("keeps a pending approval across a hub restart and executes exactly once after approval", async () => {
    script(mutatingBash("reboot-service"), fauxAssistantMessage("Done after restart."))
    const { id, approvalId } = await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const id = yield* createSession(sessions)
        yield* sessions.prompt(id, "Restart the service")
        const waiting = yield* waitFor(sessions, id, (detail) => detail.approvals[0]?.status === "pending")
        return { id, approvalId: waiting.approvals[0]!.id }
      }),
    )
    // The first hub closed with the call waiting; nothing ran.
    expect(executed).toEqual([])

    await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const resumed = yield* waitFor(sessions, id, (detail) => detail.session.status === "waiting_for_user")
        expect(resumed.approvals.map((approval) => approval.id)).toEqual([approvalId])
        expect(executed).toEqual([])
        yield* sessions.resolveApproval({ sessionId: id, approvalId, decision: "approved" })
        const done = yield* waitFor(
          sessions,
          id,
          (detail) => isIdle(detail) && lastAssistantText(detail) === "Done after restart.",
        )
        expect(toolItems(done)[0]).toMatchObject({ status: "completed", output: "ran reboot-service" })
      }),
    )
    expect(executed).toEqual(["bash:reboot-service"])
  })

  it("never re-executes a call a restart interrupted mid-execution", async () => {
    script(mutatingBash("hang"), fauxAssistantMessage("Reported the interruption."))
    const id = await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const id = yield* createSession(sessions)
        yield* sessions.prompt(id, "Run the job")
        const waiting = yield* waitFor(sessions, id, (detail) => detail.approvals[0]?.status === "pending")
        yield* sessions.resolveApproval({
          sessionId: id,
          approvalId: waiting.approvals[0]!.id,
          decision: "approved",
        })
        yield* waitFor(sessions, id, () => executed.length === 1)
        return id
      }),
    )
    expect(executed).toEqual(["bash:hang"])

    const detail = await withOperator(storagePath, (sessions) =>
      waitFor(
        sessions,
        id,
        (detail) => isIdle(detail) && lastAssistantText(detail) === "Reported the interruption.",
      ),
    )
    expect(executed).toEqual(["bash:hang"])
    const [tool] = toolItems(detail)
    expect(tool?.status).toBe("failed")
    expect(tool?.output).toContain("was not executed again")
  })

  it("reports a rejection to the model without executing", async () => {
    script(mutatingBash("rm -rf /var/cache"), fauxAssistantMessage("Understood, not deleting."))
    const detail = await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const id = yield* createSession(sessions)
        yield* sessions.prompt(id, "Clear the cache")
        const waiting = yield* waitFor(sessions, id, (detail) => detail.approvals[0]?.status === "pending")
        yield* sessions.resolveApproval({
          sessionId: id,
          approvalId: waiting.approvals[0]!.id,
          decision: "rejected",
        })
        return yield* waitFor(sessions, id, isIdle)
      }),
    )
    expect(executed).toEqual([])
    const [tool] = toolItems(detail)
    expect(tool?.status).toBe("failed")
    expect(tool?.output).toContain("rejected")
  })

  it("returns the user's typed answer from ask_user", async () => {
    let seen = ""
    script(
      fauxAssistantMessage(
        fauxToolCall("ask_user", {
          question: "Which node?",
          header: "Node",
          options: [{ label: "node-a", description: "The first node" }],
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const last = context.messages.at(-1)
        seen =
          last?.role === "toolResult"
            ? last.content.map((block) => (block.type === "text" ? block.text : "")).join("")
            : ""
        return fauxAssistantMessage("Thanks.")
      },
    )
    await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const id = yield* createSession(sessions)
        yield* sessions.prompt(id, "Check something")
        const waiting = yield* waitFor(sessions, id, (detail) => detail.approvals[0]?.status === "pending")
        expect(waiting.approvals[0]).toMatchObject({
          kind: "clarification",
          question: { question: "Which node?" },
        })
        yield* sessions.resolveApproval({
          sessionId: id,
          approvalId: waiting.approvals[0]!.id,
          decision: "approved",
          answer: "node-a, but only after 5pm",
        })
        yield* waitFor(sessions, id, (detail) => isIdle(detail) && lastAssistantText(detail) === "Thanks.")
      }),
    )
    expect(seen).toBe("User answered: node-a, but only after 5pm")
  })

  it("blocks mutating calls in plan mode", async () => {
    script(
      fauxAssistantMessage(
        fauxToolCall("plugin_run_action", {
          nodeId: "node-a",
          pluginId: "docker",
          actionId: "restart-container",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Plan: restart the container."),
    )
    const detail = await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const id = yield* createSession(sessions)
        yield* sessions.setPlanMode(id, "plan_first")
        yield* sessions.prompt(id, "Restart the container")
        return yield* waitFor(
          sessions,
          id,
          (detail) => isIdle(detail) && lastAssistantText(detail) !== undefined,
        )
      }),
    )
    expect(executed).toEqual([])
    expect(detail.session.planMode).toBe("plan_first")
    expect(detail.approvals).toEqual([])
    const [tool] = toolItems(detail)
    expect(tool?.status).toBe("failed")
    expect(tool?.output).toContain("Plan mode is active")
  })

  it("forks a session at an entry", async () => {
    script(fauxAssistantMessage("First answer."), fauxAssistantMessage("Second answer."))
    const { parent, fork } = await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const id = yield* createSession(sessions)
        yield* sessions.prompt(id, "First question")
        const first = yield* waitFor(
          sessions,
          id,
          (detail) => isIdle(detail) && lastAssistantText(detail) === "First answer.",
        )
        yield* sessions.prompt(id, "Second question")
        const parent = yield* waitFor(
          sessions,
          id,
          (detail) => isIdle(detail) && lastAssistantText(detail) === "Second answer.",
        )
        const answer = first.timeline.find((item) => item.kind === "assistant")
        const fork = yield* sessions.fork(id, answer!.kind === "assistant" ? answer!.entryId! : "", "Forked")
        return { parent, fork }
      }),
    )
    expect(parent.timeline.map((item) => item.kind)).toEqual(["user", "assistant", "user", "assistant"])
    expect(fork.session).toMatchObject({
      title: "Forked",
      parentSessionId: parent.session.id,
      selectedNodeIds: ["node-a"],
    })
    expect(fork.timeline.map((item) => (item.kind === "tool" ? item.name : item.text))).toEqual([
      "First question",
      "First answer.",
    ])
  })

  it("aborts a waiting call and cancels its approval", async () => {
    script(mutatingBash("long-job"), fauxAssistantMessage("unused"))
    const detail = await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const id = yield* createSession(sessions)
        yield* sessions.prompt(id, "Run the long job")
        yield* waitFor(sessions, id, (detail) => detail.approvals[0]?.status === "pending")
        yield* sessions.abort(id)
        return yield* waitFor(
          sessions,
          id,
          (detail) => detail.session.status !== "waiting_for_user" && detail.session.status !== "running",
        )
      }),
    )
    expect(executed).toEqual([])
    expect(detail.approvals[0]?.status).toBe("canceled")
    expect(toolItems(detail)[0]?.status).toBe("failed")
    faux.setResponses([])
  })

  it("lists unarchived sessions with their projected status", async () => {
    script(fauxAssistantMessage("", { stopReason: "error", errorMessage: "provider exploded" }))
    const { failedId, archivedId, listed } = await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const failedId = yield* createSession(sessions)
        yield* sessions.prompt(failedId, "Fail please")
        yield* waitFor(sessions, failedId, (detail) => detail.session.status === "failed")
        const archivedId = yield* createSession(sessions)
        yield* sessions.archive(archivedId)
        return { failedId, archivedId, listed: yield* sessions.list() }
      }),
    )
    expect(listed.map((session) => session.id)).toEqual([failedId])
    expect(listed[0]?.status).toBe("failed")
    expect(listed.some((session) => session.id === archivedId)).toBe(false)
  })

  it("streams session snapshots to a watcher", async () => {
    script(fauxAssistantMessage("Streamed answer."))
    const snapshots = await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const id = yield* createSession(sessions)
        const collected: Array<OperatorSessionDetail> = []
        const fiber = yield* sessions.watch(id).pipe(
          Stream.runForEach((detail) => Effect.sync(() => collected.push(detail))),
          Effect.forkChild,
        )
        yield* Effect.sleep("100 millis")
        yield* sessions.prompt(id, "Stream please")
        yield* waitFor(
          sessions,
          id,
          (detail) => isIdle(detail) && lastAssistantText(detail) === "Streamed answer.",
        )
        yield* Effect.sleep("150 millis")
        yield* Fiber.interrupt(fiber)
        return collected
      }),
    )
    expect(snapshots[0]?.timeline).toEqual([])
    expect(snapshots.at(-1)?.timeline.map((item) => item.kind)).toEqual(["user", "assistant"])
    expect(lastAssistantText(snapshots.at(-1)!)).toBe("Streamed answer.")
  })
})

describe("native operator image input", () => {
  it("delivers exact mixed bytes and order to the provider, then retrieves them after reopen and fork", async () => {
    const { png, secondPng: second } = await import("../helpers/operator-images.js")
    const seen: Array<unknown> = []
    script((context) => {
      const user = context.messages.find((message) => message.role === "user")
      seen.push(user?.content)
      return fauxAssistantMessage("Saw both images")
    })
    const { id, entryId } = await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const id = yield* createSession(sessions)
        yield* sessions.prompt(id, "Compare", "mixed-images", [png, second])
        const done = yield* waitFor(
          sessions,
          id,
          (detail) => isIdle(detail) && lastAssistantText(detail) === "Saw both images",
        )
        const user = done.timeline.find((item) => item.kind === "user")!
        expect(user.kind).toBe("user")
        if (user.kind !== "user") throw new Error("Missing input")
        expect(user.images).toHaveLength(2)
        expect(JSON.stringify(done)).not.toContain(png.data)
        expect(JSON.stringify(done)).not.toContain('"data":')
        expect(yield* sessions.getImage({ sessionId: id, entryId: user.entryId, imageIndex: 0 })).toEqual(png)
        return { id, entryId: user.entryId }
      }),
    )
    expect(seen).toEqual([
      [
        { type: "text", text: "Compare" },
        { type: "image", ...png },
        { type: "image", ...second },
      ],
    ])
    await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        expect(yield* sessions.getImage({ sessionId: id, entryId, imageIndex: 1 })).toEqual(second)
        const fork = yield* sessions.fork(id, entryId)
        expect(yield* sessions.getImage({ sessionId: fork.session.id, entryId, imageIndex: 0 })).toEqual(png)
        script(fauxAssistantMessage("A later image"))
        yield* sessions.prompt(id, "later", "later-image", [png])
        const later = yield* waitFor(
          sessions,
          id,
          (detail) => isIdle(detail) && lastAssistantText(detail) === "A later image",
        )
        const laterUser = later.timeline.filter((item) => item.kind === "user").at(-1)!
        const pastFork = yield* sessions
          .getImage({ sessionId: fork.session.id, entryId: laterUser.entryId, imageIndex: 0 })
          .pipe(Effect.flip)
        expect(pastFork.code).toBe("image-not-found")
        const other = yield* createSession(sessions)
        const wrong = yield* sessions.getImage({ sessionId: other, entryId, imageIndex: 0 }).pipe(Effect.flip)
        expect(wrong.code).toBe("image-not-found")
        const badIndex = yield* sessions.getImage({ sessionId: id, entryId, imageIndex: 2 }).pipe(Effect.flip)
        expect(badIndex.code).toBe("image-not-found")
        yield* sessions.delete(id)
        expect(yield* sessions.get(id)).toBeNull()
        // Session deletion unlists the parent; native inherited entries remain available to its fork.
        expect(yield* sessions.getImage({ sessionId: fork.session.id, entryId, imageIndex: 0 })).toEqual(png)
      }),
    )
  })

  it("rejects corrupt pixels before durable admission, user/run state or provider calls", async () => {
    const { corruptCompressedImages } = await import("../helpers/operator-images.js")
    let calls = 0
    script(() => {
      calls++
      return fauxAssistantMessage("Must not run")
    })
    await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const id = yield* createSession(sessions)
        const db = new Database(storagePath, { readonly: true })
        try {
          const before = {
            entries: db.query("SELECT * FROM entries").all(),
            tasks: db.query("SELECT * FROM tasks").all(),
            submissions: db.query("SELECT * FROM submissions").all(),
            documents: db.query("SELECT * FROM documents").all(),
          }
          for (const image of corruptCompressedImages) {
            expect(yield* sessions.prompt(id, "", "invalid", [image]).pipe(Effect.flip)).toMatchObject({
              code: "operator-input-invalid",
            })
            expect(db.query("SELECT * FROM entries").all()).toEqual(before.entries)
            expect(db.query("SELECT * FROM tasks").all()).toEqual(before.tasks)
            expect(db.query("SELECT * FROM submissions").all()).toEqual(before.submissions)
            expect(db.query("SELECT * FROM documents").all()).toEqual(before.documents)
            const detail = yield* sessions.get(id)
            expect(detail?.timeline).toEqual([])
            expect(detail?.queuedInputs).toBe(0)
            expect(detail?.session.status).toBe("idle")
          }
          expect(calls).toBe(0)
        } finally {
          db.close()
        }
      }),
    )
  })

  it("reuses bounded metadata across reads/watchers without decoding stored pixels", async () => {
    const { png } = await import("../helpers/operator-images.js")
    script(fauxAssistantMessage("Stored"))
    const inspect = vi.spyOn(imagesBoundary, "imageMetadata")
    const decode = vi.spyOn(imageCodecs, "decodeOperatorImage")
    try {
      await withOperator(storagePath, (sessions) =>
        Effect.gen(function* () {
          const id = yield* createSession(sessions)
          yield* sessions.prompt(id, "", "metadata-cache", [png])
          yield* waitFor(sessions, id, (detail) => isIdle(detail) && lastAssistantText(detail) === "Stored")
          expect(decode).toHaveBeenCalledTimes(1)
          inspect.mockClear()
          decode.mockClear()
          for (let i = 0; i < 5; i++) {
            const detail = yield* sessions.get(id)
            expect(JSON.stringify(detail)).not.toContain(png.data)
            yield* sessions.watch(id).pipe(Stream.take(1), Stream.runCollect)
          }
          expect(inspect).not.toHaveBeenCalled()
          expect(decode).not.toHaveBeenCalled()
        }),
      )
    } finally {
      inspect.mockRestore()
      decode.mockRestore()
    }
  })

  it("survives queued image-only input and pending approval restart, admits retries once and rejects changed keys", async () => {
    const { png } = await import("../helpers/operator-images.js")
    script(mutatingBash("restart"))
    const id = await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const id = yield* createSession(sessions)
        yield* sessions.prompt(id, "Ask approval", "first")
        yield* waitFor(sessions, id, (detail) => detail.session.status === "waiting_for_user")
        yield* sessions.prompt(id, "", "queued-image", [png])
        yield* sessions.prompt(id, "", "queued-image", [png])
        const waiting = yield* sessions.get(id)
        expect(waiting?.queuedInputs).toBe(1)
        expect(waiting?.queuedImages).toBe(1)
        expect(JSON.stringify(waiting)).not.toContain(png.data)
        const conflict = yield* sessions.prompt(id, "Changed", "queued-image", [png]).pipe(Effect.flip)
        expect(conflict.code).toBe("operator-request-conflict")
        return id
      }),
    )
    const seen: Array<unknown> = []
    script(fauxAssistantMessage("Rejected operation"), (context) => {
      seen.push(context.messages.filter((message) => message.role === "user").at(-1)?.content)
      return fauxAssistantMessage("Saw queued image")
    })
    await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const waiting = yield* sessions.get(id)
        expect(waiting?.queuedImages).toBe(1)
        yield* sessions.prompt(id, "", "queued-image", [png])
        const approval = waiting!.approvals[0]!
        yield* sessions.resolveApproval({ sessionId: id, approvalId: approval.id, decision: "rejected" })
        const done = yield* waitFor(
          sessions,
          id,
          (detail) => isIdle(detail) && lastAssistantText(detail) === "Saw queued image",
        )
        expect(done.timeline.filter((item) => item.kind === "user")).toHaveLength(2)
        expect(done.queuedImages).toBe(0)
        expect(executed).toEqual([])
      }),
    )
    expect(seen).toEqual([[{ type: "image", ...png }]])
  })
  it("acknowledges an exact retry under a strict model without counting its existing image twice", async () => {
    const { png } = await import("../helpers/operator-images.js")
    script(fauxAssistantMessage("Saw strict image"))
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sessions = yield* OperatorSessions
          const id = yield* createSession(sessions)
          yield* sessions.prompt(id, "", "strict-retry", [png])
          yield* waitFor(
            sessions,
            id,
            (detail) => isIdle(detail) && lastAssistantText(detail) === "Saw strict image",
          )
          yield* sessions.prompt(id, "", "strict-retry", [png])
          const tooMany = yield* sessions.prompt(id, "", "new-image", [png]).pipe(Effect.flip)
          expect(tooMany.code).toBe("operator-input-invalid")
        }),
      ).pipe(Effect.provide(operatorLayer(storagePath, "faux-strict"))),
    )
  })
})
