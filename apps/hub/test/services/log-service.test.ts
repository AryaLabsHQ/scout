import { describe, it, expect } from "vitest"
import { Effect, Layer, Ref } from "effect"
import * as Socket from "effect/unstable/socket/Socket"
import type { AgentInfo } from "@scout/shared"
import { AgentManager } from "../../src/services/agent-manager.js"
import { LogService } from "../../src/services/log-service.js"
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
const LogServiceTestLayer = LogService.layer.pipe(Layer.provide(AgentManagerTestLayer))

const FullTestLayer = Layer.mergeAll(AgentManagerTestLayer, LogServiceTestLayer)

const run = <A, E>(effect: Effect.Effect<A, E, AgentManager | LogService>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, FullTestLayer))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LogService", () => {
  describe("startStream", () => {
    it("returns streamId and sends logs.start RPC to agent", async () => {
      const { socket, sent } = createMockSocket()
      const agentId = "agent-log-01"

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          const logSvc = yield* LogService

          // Register agent
          yield* mgr.register(makeAgentInfo(agentId), socket)

          // Start stream
          const streamId = yield* logSvc.startStream({
            clientId: "client-01",
            agentId,
            source: "systemd",
            target: "nginx.service",
            tail: 100,
          })

          // Verify streamId is a UUID-like string
          expect(streamId).toBeTruthy()
          expect(typeof streamId).toBe("string")

          // Verify RPC sent to agent (2 messages: register sends none, logs.start is 1)
          // The sent messages include connect registration + logs.start
          const logsStartMsg = sent.find((s) => {
            const parsed = JSON.parse(s) as Record<string, unknown>
            return parsed["method"] === "logs.start"
          })
          expect(logsStartMsg).toBeTruthy()

          const parsed = JSON.parse(logsStartMsg!) as Record<string, unknown>
          expect(parsed["method"]).toBe("logs.start")
          const params = parsed["params"] as Record<string, unknown>
          expect(params["streamId"]).toBe(streamId)
          expect(params["source"]).toBe("systemd")
          expect(params["target"]).toBe("nginx.service")
          expect(params["tail"]).toBe(100)
        })
      )
    })

    it("fails with AgentNotConnected when agent is not registered", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const logSvc = yield* LogService
          return yield* Effect.exit(
            logSvc.startStream({
              clientId: "client-01",
              agentId: "nonexistent-agent",
              source: "k8s",
              target: "my-pod",
              tail: 100,
            })
          )
        }).pipe(Effect.provide(FullTestLayer))
      )
      expect(result._tag).toBe("Failure")
    })
  })

  describe("stopStream", () => {
    it("sends logs.stop RPC and removes stream from tracking", async () => {
      const { socket, sent } = createMockSocket()
      const agentId = "agent-log-02"

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          const logSvc = yield* LogService

          yield* mgr.register(makeAgentInfo(agentId), socket)

          const streamId = yield* logSvc.startStream({
            clientId: "client-02",
            agentId,
            source: "systemd",
            target: "sshd.service",
            tail: 50,
          })

          // Stop the stream
          yield* logSvc.stopStream(streamId)

          // Should have sent logs.stop
          const logsStopMsg = sent.find((s) => {
            const parsed = JSON.parse(s) as Record<string, unknown>
            return parsed["method"] === "logs.stop"
          })
          expect(logsStopMsg).toBeTruthy()

          const parsed = JSON.parse(logsStopMsg!) as Record<string, unknown>
          const params = parsed["params"] as Record<string, unknown>
          expect(params["streamId"]).toBe(streamId)
        })
      )
    })

    it("stopStream with unknown streamId is a no-op", async () => {
      await run(
        Effect.gen(function* () {
          const logSvc = yield* LogService
          // Should not throw
          yield* logSvc.stopStream("nonexistent-stream-id")
        })
      )
    })
  })

  describe("routeLogEvent", () => {
    it("forwards logs.data event to correct client", async () => {
      const { socket } = createMockSocket()
      const agentId = "agent-log-03"
      const clientId = "client-03"

      const forwarded: Array<{ clientId: string; data: string }> = []

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          const logSvc = yield* LogService

          yield* mgr.register(makeAgentInfo(agentId), socket)

          const streamId = yield* logSvc.startStream({
            clientId,
            agentId,
            source: "k8s",
            target: "my-pod",
            namespace: "default",
            tail: 100,
          })

          // Simulate routing a log event
          yield* logSvc.routeLogEvent(
            streamId,
            { event: "logs.data", streamId, data: { lines: ["line 1", "line 2"] } },
            (cid, data) => {
              forwarded.push({ clientId: cid, data })
              return Effect.void
            }
          )

          expect(forwarded).toHaveLength(1)
          expect(forwarded[0]!.clientId).toBe(clientId)
          const payload = JSON.parse(forwarded[0]!.data) as Record<string, unknown>
          expect(payload["event"]).toBe("logs.data")
          expect(payload["streamId"]).toBe(streamId)
        })
      )
    })

    it("does not forward event for unknown streamId", async () => {
      const forwarded: Array<unknown> = []

      await run(
        Effect.gen(function* () {
          const logSvc = yield* LogService
          yield* logSvc.routeLogEvent(
            "unknown-stream",
            { event: "logs.data", streamId: "unknown-stream", data: { lines: ["line"] } },
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
    it("returns clientId for active stream", async () => {
      const { socket } = createMockSocket()
      const agentId = "agent-log-04"
      const clientId = "client-04"

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          const logSvc = yield* LogService

          yield* mgr.register(makeAgentInfo(agentId), socket)

          const streamId = yield* logSvc.startStream({
            clientId,
            agentId,
            source: "systemd",
            target: "docker.service",
            tail: 100,
          })

          const result = yield* logSvc.getClientId(streamId)
          expect(result).toBe(clientId)
        })
      )
    })

    it("returns null for unknown streamId", async () => {
      await run(
        Effect.gen(function* () {
          const logSvc = yield* LogService
          const result = yield* logSvc.getClientId("unknown-stream")
          expect(result).toBeNull()
        })
      )
    })
  })
})
