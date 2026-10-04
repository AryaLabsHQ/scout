import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect, Fiber, Stream } from "effect"
import { fauxAssistantMessage, type FauxResponseStep, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import type { OperatorSessionDetail, OperatorTimelineItem } from "@scout/shared"
import { OperatorSessions } from "../../src/services/operator-sessions.js"
import { executed, faux, operatorLayer } from "../helpers/operator.js"

/** Run against the operator storage at `path`; the Harness closes when this returns, like a hub stop. */
const withOperator = <A>(path: string, use: (sessions: typeof OperatorSessions.Service) => Effect.Effect<A, unknown>) =>
  Effect.runPromise(
    Effect.scoped(Effect.gen(function* () { return yield* use(yield* OperatorSessions) })).pipe(Effect.provide(operatorLayer(path))) as Effect.Effect<A, unknown>,
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
  detail.timeline.filter((item): item is Extract<OperatorTimelineItem, { kind: "tool" }> => item.kind === "tool")

const lastAssistantText = (detail: OperatorSessionDetail) =>
  detail.timeline.filter((item) => item.kind === "assistant").at(-1)?.text

const isIdle = (detail: OperatorSessionDetail) => detail.session.status === "idle"

const script = (...steps: Array<FauxResponseStep>) => faux.setResponses(steps)

const mutatingBash = (command: string) =>
  fauxAssistantMessage(fauxToolCall("bash_run", { nodeId: "node-a", label: "restart", command, isMutation: true }), {
    stopReason: "toolUse",
  })

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
  sessions.create({ title: "Test", selectedNodeIds: ["node-a"] }).pipe(Effect.map((detail) => detail.session.id))

describe("OperatorSessions on pi-durable", () => {
  it("answers a prompt through a read-only tool call", async () => {
    script(
      fauxAssistantMessage(fauxToolCall("bash_run", { nodeId: "node-a", label: "uptime", command: "uptime", isMutation: false }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("The node is up."),
    )
    const detail = await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const id = yield* createSession(sessions)
        yield* sessions.prompt(id, "Is node-a up?")
        return yield* waitFor(sessions, id, (detail) => isIdle(detail) && lastAssistantText(detail) === "The node is up.")
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
        expect(approval).toMatchObject({ kind: "mutation", status: "pending", reason: "restart", affectedNodeIds: ["node-a"] })
        expect(toolItems(waiting)[0]?.approvalId).toBe(approval.id)
        yield* sessions.resolveApproval({ sessionId: id, approvalId: approval.id, decision: "approved", actor: "ops@example.com" })
        const done = yield* waitFor(sessions, id, (detail) => isIdle(detail) && lastAssistantText(detail) === "Restarted.")
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
        const done = yield* waitFor(sessions, id, (detail) => isIdle(detail) && lastAssistantText(detail) === "Done after restart.")
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
        yield* sessions.resolveApproval({ sessionId: id, approvalId: waiting.approvals[0]!.id, decision: "approved" })
        yield* waitFor(sessions, id, () => executed.length === 1)
        return id
      }),
    )
    expect(executed).toEqual(["bash:hang"])

    const detail = await withOperator(storagePath, (sessions) =>
      waitFor(sessions, id, (detail) => isIdle(detail) && lastAssistantText(detail) === "Reported the interruption."),
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
        yield* sessions.resolveApproval({ sessionId: id, approvalId: waiting.approvals[0]!.id, decision: "rejected" })
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
        seen = last?.role === "toolResult" ? last.content.map((block) => (block.type === "text" ? block.text : "")).join("") : ""
        return fauxAssistantMessage("Thanks.")
      },
    )
    await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const id = yield* createSession(sessions)
        yield* sessions.prompt(id, "Check something")
        const waiting = yield* waitFor(sessions, id, (detail) => detail.approvals[0]?.status === "pending")
        expect(waiting.approvals[0]).toMatchObject({ kind: "clarification", question: { question: "Which node?" } })
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
        fauxToolCall("plugin_run_action", { nodeId: "node-a", pluginId: "docker", actionId: "restart-container" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Plan: restart the container."),
    )
    const detail = await withOperator(storagePath, (sessions) =>
      Effect.gen(function* () {
        const id = yield* createSession(sessions)
        yield* sessions.setPlanMode(id, "plan_first")
        yield* sessions.prompt(id, "Restart the container")
        return yield* waitFor(sessions, id, (detail) => isIdle(detail) && lastAssistantText(detail) !== undefined)
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
        const first = yield* waitFor(sessions, id, (detail) => isIdle(detail) && lastAssistantText(detail) === "First answer.")
        yield* sessions.prompt(id, "Second question")
        const parent = yield* waitFor(sessions, id, (detail) => isIdle(detail) && lastAssistantText(detail) === "Second answer.")
        const answer = first.timeline.find((item) => item.kind === "assistant")
        const fork = yield* sessions.fork(id, answer!.kind === "assistant" ? answer!.entryId! : "", "Forked")
        return { parent, fork }
      }),
    )
    expect(parent.timeline.map((item) => item.kind)).toEqual(["user", "assistant", "user", "assistant"])
    expect(fork.session).toMatchObject({ title: "Forked", parentSessionId: parent.session.id, selectedNodeIds: ["node-a"] })
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
        return yield* waitFor(sessions, id, (detail) => detail.session.status !== "waiting_for_user" && detail.session.status !== "running")
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
        yield* waitFor(sessions, id, (detail) => isIdle(detail) && lastAssistantText(detail) === "Streamed answer.")
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
