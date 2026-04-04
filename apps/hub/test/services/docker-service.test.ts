import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import * as Socket from "effect/unstable/socket/Socket"
import type { AgentInfo } from "@scout/shared"
import { AgentManager } from "../../src/services/agent-manager.js"
import { DockerService } from "../../src/services/docker-service.js"
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
const DockerServiceTestLayer = DockerService.layer.pipe(Layer.provide(AgentManagerTestLayer))
const FullTestLayer = Layer.mergeAll(AgentManagerTestLayer, DockerServiceTestLayer)

const run = <A, E>(effect: Effect.Effect<A, E, AgentManager | DockerService>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, FullTestLayer))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DockerService", () => {
  describe("start", () => {
    it("sends correct docker.start RPC to agent", async () => {
      const { socket, sent } = createMockSocket()
      const agentId = "agent-docker-01"

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          yield* mgr.register(makeAgentInfo(agentId), socket)

          const svc = yield* DockerService

          yield* Effect.forkChild(
            svc.start(agentId, "abc123def456").pipe(Effect.ignore)
          )

          yield* Effect.sleep(50)

          const msg = sent.find((s) => {
            try {
              const p = JSON.parse(s) as Record<string, unknown>
              return p["method"] === "docker.start"
            } catch { return false }
          })
          expect(msg).toBeTruthy()
          const parsed = JSON.parse(msg!) as Record<string, unknown>
          expect(parsed["method"]).toBe("docker.start")
          const params = parsed["params"] as Record<string, unknown>
          expect(params["containerId"]).toBe("abc123def456")
        })
      )
    })
  })

  describe("stop", () => {
    it("sends correct docker.stop RPC to agent", async () => {
      const { socket, sent } = createMockSocket()
      const agentId = "agent-docker-02"

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          yield* mgr.register(makeAgentInfo(agentId), socket)

          const svc = yield* DockerService

          yield* Effect.forkChild(
            svc.stop(agentId, "abc123def456").pipe(Effect.ignore)
          )

          yield* Effect.sleep(50)

          const msg = sent.find((s) => {
            try {
              const p = JSON.parse(s) as Record<string, unknown>
              return p["method"] === "docker.stop"
            } catch { return false }
          })
          expect(msg).toBeTruthy()
          const parsed = JSON.parse(msg!) as Record<string, unknown>
          const params = parsed["params"] as Record<string, unknown>
          expect(params["containerId"]).toBe("abc123def456")
        })
      )
    })
  })

  describe("restart", () => {
    it("sends correct docker.restart RPC to agent", async () => {
      const { socket, sent } = createMockSocket()
      const agentId = "agent-docker-03"

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          yield* mgr.register(makeAgentInfo(agentId), socket)

          const svc = yield* DockerService

          yield* Effect.forkChild(
            svc.restart(agentId, "mycontainer123").pipe(Effect.ignore)
          )

          yield* Effect.sleep(50)

          const msg = sent.find((s) => {
            try {
              const p = JSON.parse(s) as Record<string, unknown>
              return p["method"] === "docker.restart"
            } catch { return false }
          })
          expect(msg).toBeTruthy()
        })
      )
    })
  })

  describe("agent not connected", () => {
    it("fails with AgentNotConnected when agent is not registered", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DockerService
          return yield* Effect.exit(svc.start("nonexistent-agent", "abc123"))
        }).pipe(Effect.provide(FullTestLayer))
      )
      expect(result._tag).toBe("Failure")
    })

    it("fails for stop when agent is not connected", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DockerService
          return yield* Effect.exit(svc.stop("nonexistent-agent", "abc123"))
        }).pipe(Effect.provide(FullTestLayer))
      )
      expect(result._tag).toBe("Failure")
    })

    it("fails for restart when agent is not connected", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* DockerService
          return yield* Effect.exit(svc.restart("nonexistent-agent", "abc123"))
        }).pipe(Effect.provide(FullTestLayer))
      )
      expect(result._tag).toBe("Failure")
    })
  })
})
