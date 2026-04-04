import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import * as Socket from "effect/unstable/socket/Socket"
import type { AgentInfo } from "@scout/shared"
import { AgentManager } from "../../src/services/agent-manager.js"
import { TerminalService } from "../../src/services/terminal.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"

// ── Mock socket factory ───────────────────────────────────────────────────────

function createMockSocket() {
  const sent: string[] = []
  const socket = Socket.Socket.of({
    ["~effect/socket/Socket"]: "~effect/socket/Socket" as const,
    run: () => Effect.never,
    runRaw: () => Effect.never,
    writer: Effect.succeed(
      (chunk: Uint8Array | string | Socket.CloseEvent): Effect.Effect<void, Socket.SocketError> => {
        if (!(chunk instanceof Socket.CloseEvent)) {
          sent.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
        }
        return Effect.void
      }
    ),
  })
  return { socket, sent }
}

function makeAgentInfo(id: string): AgentInfo {
  return {
    systemId: id,
    hostname: `host-${id}`,
    version: "1.0.0",
    platform: "linux",
  }
}

// ── Test layers ───────────────────────────────────────────────────────────────

const AgentManagerTestLayer = AgentManager.layer.pipe(Layer.provide(TestDatabaseLayer))
const TerminalServiceTestLayer = TerminalService.layer.pipe(Layer.provide(AgentManagerTestLayer))

const FullTestLayer = Layer.mergeAll(AgentManagerTestLayer, TerminalServiceTestLayer)

const run = <A, E>(effect: Effect.Effect<A, E, AgentManager | TerminalService>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, FullTestLayer))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TerminalService", () => {
  describe("createSession", () => {
    it("sends terminal.open RPC to agent and returns session with ID", async () => {
      const { socket, sent } = createMockSocket()
      const agentId = "agent-term-01"

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          const termSvc = yield* TerminalService

          // Register agent
          yield* mgr.register(makeAgentInfo(agentId), socket)

          // Create session
          const session = yield* termSvc.createSession({
            agentId,
            clientId: "client-01",
            mode: "shell",
            cols: 80,
            rows: 24,
          })

          // Verify session fields
          expect(session.id).toBeTruthy()
          expect(typeof session.id).toBe("string")
          expect(session.agentId).toBe(agentId)
          expect(session.mode).toBe("shell")
          expect(session.cols).toBe(80)
          expect(session.rows).toBe(24)
          expect(session.podName).toBeNull()
          expect(session.namespace).toBeNull()

          // Verify terminal.open was sent to agent
          const openMsg = sent.find((s) => {
            const parsed = JSON.parse(s) as Record<string, unknown>
            return parsed["method"] === "terminal.open"
          })
          expect(openMsg).toBeTruthy()

          const parsed = JSON.parse(openMsg!) as Record<string, unknown>
          expect(parsed["method"]).toBe("terminal.open")
          const params = parsed["params"] as Record<string, unknown>
          expect(params["sessionId"]).toBe(session.id)
          expect(params["mode"]).toBe("shell")
          expect(params["cols"]).toBe(80)
          expect(params["rows"]).toBe(24)
        })
      )
    })

    it("creates podExec session with podName and namespace", async () => {
      const { socket, sent } = createMockSocket()
      const agentId = "agent-term-02"

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          const termSvc = yield* TerminalService

          yield* mgr.register(makeAgentInfo(agentId), socket)

          const session = yield* termSvc.createSession({
            agentId,
            clientId: "client-02",
            mode: "podExec",
            cols: 120,
            rows: 40,
            podName: "nginx-pod",
            namespace: "production",
          })

          expect(session.mode).toBe("podExec")
          expect(session.podName).toBe("nginx-pod")
          expect(session.namespace).toBe("production")

          const openMsg = sent.find((s) => {
            const parsed = JSON.parse(s) as Record<string, unknown>
            return parsed["method"] === "terminal.open"
          })
          expect(openMsg).toBeTruthy()
          const parsed = JSON.parse(openMsg!) as Record<string, unknown>
          const params = parsed["params"] as Record<string, unknown>
          expect(params["podName"]).toBe("nginx-pod")
          expect(params["namespace"]).toBe("production")
        })
      )
    })
  })

  describe("closeSession", () => {
    it("sends terminal.close RPC and removes session from tracking", async () => {
      const { socket, sent } = createMockSocket()
      const agentId = "agent-term-03"

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          const termSvc = yield* TerminalService

          yield* mgr.register(makeAgentInfo(agentId), socket)

          const session = yield* termSvc.createSession({
            agentId,
            clientId: "client-03",
            mode: "shell",
            cols: 80,
            rows: 24,
          })

          // Close the session
          yield* termSvc.closeSession(session.id)

          // Verify terminal.close was sent
          const closeMsg = sent.find((s) => {
            const parsed = JSON.parse(s) as Record<string, unknown>
            return parsed["method"] === "terminal.close"
          })
          expect(closeMsg).toBeTruthy()

          const parsed = JSON.parse(closeMsg!) as Record<string, unknown>
          const params = parsed["params"] as Record<string, unknown>
          expect(params["sessionId"]).toBe(session.id)

          // After close, getClientId should return null
          const clientId = yield* termSvc.getClientId(session.id)
          expect(clientId).toBeNull()
        })
      )
    })

    it("closeSession with unknown sessionId is a no-op", async () => {
      await run(
        Effect.gen(function* () {
          const termSvc = yield* TerminalService
          // Should not throw
          yield* termSvc.closeSession("nonexistent-session-id")
        })
      )
    })
  })

  describe("sendInput", () => {
    it("sends terminal.input RPC with base64 data to agent", async () => {
      const { socket, sent } = createMockSocket()
      const agentId = "agent-term-04"

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          const termSvc = yield* TerminalService

          yield* mgr.register(makeAgentInfo(agentId), socket)

          const session = yield* termSvc.createSession({
            agentId,
            clientId: "client-04",
            mode: "shell",
            cols: 80,
            rows: 24,
          })

          const dataBase64 = btoa("ls -la\n")
          yield* termSvc.sendInput(session.id, dataBase64)

          const inputMsg = sent.find((s) => {
            const parsed = JSON.parse(s) as Record<string, unknown>
            return parsed["method"] === "terminal.input"
          })
          expect(inputMsg).toBeTruthy()

          const parsed = JSON.parse(inputMsg!) as Record<string, unknown>
          const params = parsed["params"] as Record<string, unknown>
          expect(params["sessionId"]).toBe(session.id)
          expect(params["dataBase64"]).toBe(dataBase64)
        })
      )
    })

    it("sendInput with unknown sessionId is a no-op", async () => {
      await run(
        Effect.gen(function* () {
          const termSvc = yield* TerminalService
          yield* termSvc.sendInput("nonexistent", btoa("hello"))
        })
      )
    })
  })

  describe("resize", () => {
    it("sends terminal.resize RPC to agent", async () => {
      const { socket, sent } = createMockSocket()
      const agentId = "agent-term-05"

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          const termSvc = yield* TerminalService

          yield* mgr.register(makeAgentInfo(agentId), socket)

          const session = yield* termSvc.createSession({
            agentId,
            clientId: "client-05",
            mode: "shell",
            cols: 80,
            rows: 24,
          })

          yield* termSvc.resize(session.id, 120, 40)

          const resizeMsg = sent.find((s) => {
            const parsed = JSON.parse(s) as Record<string, unknown>
            return parsed["method"] === "terminal.resize"
          })
          expect(resizeMsg).toBeTruthy()

          const parsed = JSON.parse(resizeMsg!) as Record<string, unknown>
          const params = parsed["params"] as Record<string, unknown>
          expect(params["sessionId"]).toBe(session.id)
          expect(params["cols"]).toBe(120)
          expect(params["rows"]).toBe(40)
        })
      )
    })
  })

  describe("routeOutput", () => {
    it("forwards terminal output to correct client", async () => {
      const { socket } = createMockSocket()
      const agentId = "agent-term-06"
      const clientId = "client-06"

      const forwarded: Array<{ clientId: string; data: string }> = []

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          const termSvc = yield* TerminalService

          yield* mgr.register(makeAgentInfo(agentId), socket)

          const session = yield* termSvc.createSession({
            agentId,
            clientId,
            mode: "shell",
            cols: 80,
            rows: 24,
          })

          const dataBase64 = btoa("Hello, World!\n")
          yield* termSvc.routeOutput(
            session.id,
            dataBase64,
            (cid, data) => {
              forwarded.push({ clientId: cid, data })
              return Effect.void
            }
          )

          expect(forwarded).toHaveLength(1)
          expect(forwarded[0]!.clientId).toBe(clientId)

          const payload = JSON.parse(forwarded[0]!.data) as Record<string, unknown>
          expect(payload["event"]).toBe("terminal.output")
          expect(payload["streamId"]).toBe(session.id)
          expect(payload["dataBase64"]).toBe(dataBase64)
        })
      )
    })

    it("does not forward output for unknown sessionId", async () => {
      const forwarded: Array<unknown> = []

      await run(
        Effect.gen(function* () {
          const termSvc = yield* TerminalService
          yield* termSvc.routeOutput(
            "unknown-session",
            btoa("data"),
            (_cid, data) => {
              forwarded.push(data)
              return Effect.void
            }
          )
          expect(forwarded).toHaveLength(0)
        })
      )
    })
  })

  describe("getClientId", () => {
    it("returns clientId for active session", async () => {
      const { socket } = createMockSocket()
      const agentId = "agent-term-07"
      const clientId = "client-07"

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          const termSvc = yield* TerminalService

          yield* mgr.register(makeAgentInfo(agentId), socket)

          const session = yield* termSvc.createSession({
            agentId,
            clientId,
            mode: "shell",
            cols: 80,
            rows: 24,
          })

          const result = yield* termSvc.getClientId(session.id)
          expect(result).toBe(clientId)
        })
      )
    })

    it("returns null for unknown sessionId", async () => {
      await run(
        Effect.gen(function* () {
          const termSvc = yield* TerminalService
          const result = yield* termSvc.getClientId("unknown-session")
          expect(result).toBeNull()
        })
      )
    })
  })
})
