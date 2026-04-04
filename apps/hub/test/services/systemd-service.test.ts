import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import * as Socket from "effect/unstable/socket/Socket"
import type { AgentInfo } from "@scout/shared"
import { AgentManager } from "../../src/services/agent-manager.js"
import { SystemdService } from "../../src/services/systemd-service.js"
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
const SystemdServiceTestLayer = SystemdService.layer.pipe(Layer.provide(AgentManagerTestLayer))
const FullTestLayer = Layer.mergeAll(AgentManagerTestLayer, SystemdServiceTestLayer)

const run = <A, E>(effect: Effect.Effect<A, E, AgentManager | SystemdService>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, FullTestLayer))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SystemdService", () => {
  describe("restart", () => {
    it("sends correct systemd.restart RPC to agent", async () => {
      const { socket, sent } = createMockSocket()
      const agentId = "agent-systemd-01"

      // We need to simulate the agent responding so the call doesn't time out.
      // Since call() waits for a response, we'll fork a response simulation.
      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          yield* mgr.register(makeAgentInfo(agentId), socket)

          const svc = yield* SystemdService

          // Fork the restart call; it will timeout since no real agent responds,
          // but we can verify the message was sent
          yield* Effect.forkChild(
            svc.restart(agentId, "nginx.service").pipe(Effect.ignore)
          )

          // Give a brief moment for the message to be sent
          yield* Effect.sleep(50)

          const restartMsg = sent.find((s) => {
            try {
              const p = JSON.parse(s) as Record<string, unknown>
              return p["method"] === "systemd.restart"
            } catch { return false }
          })
          expect(restartMsg).toBeTruthy()

          const parsed = JSON.parse(restartMsg!) as Record<string, unknown>
          expect(parsed["method"]).toBe("systemd.restart")
          const params = parsed["params"] as Record<string, unknown>
          expect(params["unit"]).toBe("nginx.service")
        })
      )
    })
  })

  describe("agent not connected", () => {
    it("fails with AgentNotConnected when agent is not registered", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* SystemdService
          return yield* Effect.exit(svc.restart("nonexistent-agent", "nginx.service"))
        }).pipe(Effect.provide(FullTestLayer))
      )
      expect(result._tag).toBe("Failure")
    })

    it("fails with AgentNotConnected for start when agent is not connected", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* SystemdService
          return yield* Effect.exit(svc.start("nonexistent-agent", "sshd.service"))
        }).pipe(Effect.provide(FullTestLayer))
      )
      expect(result._tag).toBe("Failure")
    })
  })

  describe("editUnitFile", () => {
    it("sends correct systemd.unit-file-edit RPC with content", async () => {
      const { socket, sent } = createMockSocket()
      const agentId = "agent-systemd-02"

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          yield* mgr.register(makeAgentInfo(agentId), socket)

          const svc = yield* SystemdService
          const content = "[Unit]\nDescription=Test\n[Service]\nExecStart=/bin/true"

          yield* Effect.forkChild(
            svc.editUnitFile(agentId, "test.service", content).pipe(Effect.ignore)
          )

          yield* Effect.sleep(50)

          const editMsg = sent.find((s) => {
            try {
              const p = JSON.parse(s) as Record<string, unknown>
              return p["method"] === "systemd.unit-file-edit"
            } catch { return false }
          })
          expect(editMsg).toBeTruthy()

          const parsed = JSON.parse(editMsg!) as Record<string, unknown>
          const params = parsed["params"] as Record<string, unknown>
          expect(params["unit"]).toBe("test.service")
          expect(params["content"]).toBe(content)
        })
      )
    })
  })

  describe("getUnitFile", () => {
    it("sends correct systemd.unit-file RPC", async () => {
      const { socket, sent } = createMockSocket()
      const agentId = "agent-systemd-03"

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          yield* mgr.register(makeAgentInfo(agentId), socket)

          const svc = yield* SystemdService

          yield* Effect.forkChild(
            svc.getUnitFile(agentId, "nginx.service").pipe(Effect.ignore)
          )

          yield* Effect.sleep(50)

          const msg = sent.find((s) => {
            try {
              const p = JSON.parse(s) as Record<string, unknown>
              return p["method"] === "systemd.unit-file"
            } catch { return false }
          })
          expect(msg).toBeTruthy()

          const parsed = JSON.parse(msg!) as Record<string, unknown>
          const params = parsed["params"] as Record<string, unknown>
          expect(params["unit"]).toBe("nginx.service")
        })
      )
    })
  })
})
