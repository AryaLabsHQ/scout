import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import * as Socket from "effect/unstable/socket/Socket"
import type { AgentInfo } from "@scout/shared"
import { AgentManager } from "../../src/services/agent-manager.js"
import { K8sService } from "../../src/services/k8s-service.js"
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
const K8sServiceTestLayer = K8sService.layer.pipe(Layer.provide(AgentManagerTestLayer))
const FullTestLayer = Layer.mergeAll(AgentManagerTestLayer, K8sServiceTestLayer)

const run = <A, E>(effect: Effect.Effect<A, E, AgentManager | K8sService>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, FullTestLayer))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("K8sService", () => {
  describe("scale", () => {
    it("sends correct k8s.scale RPC with deployment, namespace, and replicas", async () => {
      const { socket, sent } = createMockSocket()
      const agentId = "agent-k8s-01"

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          yield* mgr.register(makeAgentInfo(agentId), socket)

          const svc = yield* K8sService

          yield* Effect.forkChild(
            svc.scale(agentId, "my-deployment", "production", 3).pipe(Effect.ignore)
          )

          yield* Effect.sleep(50)

          const msg = sent.find((s) => {
            try {
              const p = JSON.parse(s) as Record<string, unknown>
              return p["method"] === "k8s.scale"
            } catch { return false }
          })
          expect(msg).toBeTruthy()

          const parsed = JSON.parse(msg!) as Record<string, unknown>
          expect(parsed["method"]).toBe("k8s.scale")
          const params = parsed["params"] as Record<string, unknown>
          expect(params["deployment"]).toBe("my-deployment")
          expect(params["namespace"]).toBe("production")
          expect(params["replicas"]).toBe(3)
        })
      )
    })
  })

  describe("restartPod", () => {
    it("sends correct k8s.restart-pod RPC with podName and namespace", async () => {
      const { socket, sent } = createMockSocket()
      const agentId = "agent-k8s-02"

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          yield* mgr.register(makeAgentInfo(agentId), socket)

          const svc = yield* K8sService

          yield* Effect.forkChild(
            svc.restartPod(agentId, "my-pod-abc123", "default").pipe(Effect.ignore)
          )

          yield* Effect.sleep(50)

          const msg = sent.find((s) => {
            try {
              const p = JSON.parse(s) as Record<string, unknown>
              return p["method"] === "k8s.restart-pod"
            } catch { return false }
          })
          expect(msg).toBeTruthy()

          const parsed = JSON.parse(msg!) as Record<string, unknown>
          const params = parsed["params"] as Record<string, unknown>
          expect(params["podName"]).toBe("my-pod-abc123")
          expect(params["namespace"]).toBe("default")
        })
      )
    })
  })

  describe("describe", () => {
    it("sends correct k8s.describe RPC with resource, name, and namespace", async () => {
      const { socket, sent } = createMockSocket()
      const agentId = "agent-k8s-03"

      await run(
        Effect.gen(function* () {
          const mgr = yield* AgentManager
          yield* mgr.register(makeAgentInfo(agentId), socket)

          const svc = yield* K8sService

          yield* Effect.forkChild(
            svc.describe(agentId, "pod", "my-pod-abc123", "default").pipe(Effect.ignore)
          )

          yield* Effect.sleep(50)

          const msg = sent.find((s) => {
            try {
              const p = JSON.parse(s) as Record<string, unknown>
              return p["method"] === "k8s.describe"
            } catch { return false }
          })
          expect(msg).toBeTruthy()

          const parsed = JSON.parse(msg!) as Record<string, unknown>
          const params = parsed["params"] as Record<string, unknown>
          expect(params["resource"]).toBe("pod")
          expect(params["name"]).toBe("my-pod-abc123")
          expect(params["namespace"]).toBe("default")
        })
      )
    })
  })

  describe("agent not connected", () => {
    it("fails with AgentNotConnected for scale when agent is not registered", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* K8sService
          return yield* Effect.exit(svc.scale("nonexistent-agent", "my-deploy", "default", 2))
        }).pipe(Effect.provide(FullTestLayer))
      )
      expect(result._tag).toBe("Failure")
    })

    it("fails with AgentNotConnected for restartPod when agent is not registered", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* K8sService
          return yield* Effect.exit(svc.restartPod("nonexistent-agent", "my-pod", "default"))
        }).pipe(Effect.provide(FullTestLayer))
      )
      expect(result._tag).toBe("Failure")
    })

    it("fails with AgentNotConnected for describe when agent is not registered", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* K8sService
          return yield* Effect.exit(svc.describe("nonexistent-agent", "pod", "my-pod", "default"))
        }).pipe(Effect.provide(FullTestLayer))
      )
      expect(result._tag).toBe("Failure")
    })
  })
})
