/**
 * Tests for GET /health and DELETE /api/systems/:id routes.
 */

import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { BunHttpServer } from "@effect/platform-bun"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import { AgentManager } from "../../src/services/agent-manager.js"
import { MetricsIngestion } from "../../src/services/metrics-ingestion.js"
import { MetricsBroadcast } from "../../src/services/metrics-broadcast.js"
import { Retention } from "../../src/services/retention.js"
import { AlertEngine } from "../../src/services/alert-engine.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"
import { makeAgentReport } from "../helpers/fixtures.js"
import { AppRoutes } from "../../src/routes.js"
import * as Socket from "effect/unstable/socket/Socket"
import type { AgentInfo } from "@scout/shared"

// ── Test AppLayer ─────────────────────────────────────────────────────────────

const TestAppLayer = Layer.mergeAll(
  TestDatabaseLayer,
  MetricsBroadcast.layer,
  MetricsIngestion.layer.pipe(Layer.provide(TestDatabaseLayer)),
  AgentManager.layer.pipe(Layer.provide(TestDatabaseLayer)),
  Retention.layer.pipe(Layer.provide(TestDatabaseLayer)),
  AlertEngine.layer.pipe(
    Layer.provide(Layer.merge(TestDatabaseLayer, MetricsBroadcast.layer)),
  ),
)

const HttpInfraLayer = BunHttpServer.layerTest.pipe(
  Layer.provideMerge(TestAppLayer),
)

// ── Mock socket ───────────────────────────────────────────────────────────────

function createMockSocket() {
  return Socket.Socket.of({
    ["~effect/socket/Socket"]: "~effect/socket/Socket" as const,
    run: () => Effect.never,
    runRaw: () => Effect.never,
    writer: Effect.succeed(
      (_chunk: Uint8Array | string | Socket.CloseEvent): Effect.Effect<void, Socket.SocketError> =>
        Effect.void,
    ),
  })
}

function makeAgentInfo(id: string): AgentInfo {
  return {
    systemId: id,
    hostname: `host-${id}`,
    version: "1.0.0",
    platform: "linux",
  }
}

// ── GET /health ───────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it.effect("returns 200 with all required fields", () =>
    Effect.gen(function* () {
      yield* AppRoutes.pipe(HttpRouter.serve, Layer.build)

      const response = yield* HttpClient.get("/health")
      expect(response.status).toBe(200)

      const body = yield* response.json
      const health = body as Record<string, unknown>

      expect(health["status"]).toBe("ok")
      expect(health["version"]).toBe("0.0.1")
      expect(typeof health["uptime"]).toBe("number")
      expect((health["uptime"] as number) >= 0).toBe(true)
      expect(typeof health["connectedAgents"]).toBe("number")
      expect(typeof health["dbSizeBytes"]).toBe("number")
      expect(typeof health["totalSystems"]).toBe("number")
      expect(typeof health["activeAlerts"]).toBe("number")
    }).pipe(Effect.provide(HttpInfraLayer)),
  )

  it.effect("connectedAgents reflects actual connected agents", () =>
    Effect.gen(function* () {
      yield* AppRoutes.pipe(HttpRouter.serve, Layer.build)

      // Initially no agents connected
      const before = yield* HttpClient.get("/health")
      const bodyBefore = (yield* before.json) as Record<string, unknown>
      expect(bodyBefore["connectedAgents"]).toBe(0)

      // Register an agent
      const mgr = yield* AgentManager
      yield* mgr.register(makeAgentInfo("health-test-agent"), createMockSocket())

      const after = yield* HttpClient.get("/health")
      const bodyAfter = (yield* after.json) as Record<string, unknown>
      expect(bodyAfter["connectedAgents"]).toBe(1)
    }).pipe(Effect.provide(HttpInfraLayer)),
  )

  it.effect("totalSystems reflects systems in DB", () =>
    Effect.gen(function* () {
      yield* AppRoutes.pipe(HttpRouter.serve, Layer.build)

      const ingestion = yield* MetricsIngestion
      yield* ingestion.ingest(
        makeAgentReport({ systemId: "health-sys-1", timestamp: Date.now() }),
      )
      yield* ingestion.ingest(
        makeAgentReport({ systemId: "health-sys-2", timestamp: Date.now() }),
      )

      const response = yield* HttpClient.get("/health")
      const body = (yield* response.json) as Record<string, unknown>
      expect((body["totalSystems"] as number) >= 2).toBe(true)
    }).pipe(Effect.provide(HttpInfraLayer)),
  )
})

// ── DELETE /api/systems/:id ───────────────────────────────────────────────────

describe("DELETE /api/systems/:id", () => {
  it.effect("removes an offline system", () =>
    Effect.gen(function* () {
      yield* AppRoutes.pipe(HttpRouter.serve, Layer.build)

      // Create an offline system via ingestion
      const ingestion = yield* MetricsIngestion
      const systemId = "del-test-offline"
      yield* ingestion.ingest(makeAgentReport({ systemId, timestamp: Date.now() }))

      // System exists initially
      const listBefore = yield* HttpClient.get("/api/systems")
      const bodyBefore = (yield* listBefore.json) as Array<Record<string, unknown>>
      expect(bodyBefore.some((s) => s["id"] === systemId)).toBe(true)

      // Delete it
      const del = yield* HttpClient.del(`/api/systems/${systemId}`)
      expect(del.status).toBe(200)

      const delBody = (yield* del.json) as Record<string, unknown>
      expect(delBody["ok"]).toBe(true)

      // System is gone
      const listAfter = yield* HttpClient.get("/api/systems")
      const bodyAfter = (yield* listAfter.json) as Array<Record<string, unknown>>
      expect(bodyAfter.some((s) => s["id"] === systemId)).toBe(false)
    }).pipe(Effect.provide(HttpInfraLayer)),
  )

  it.effect("returns 404 for unknown system", () =>
    Effect.gen(function* () {
      yield* AppRoutes.pipe(HttpRouter.serve, Layer.build)

      const response = yield* HttpClient.del("/api/systems/does-not-exist")
      expect(response.status).toBe(404)
    }).pipe(Effect.provide(HttpInfraLayer)),
  )

  it.effect("rejects deleting an online system with 409", () =>
    Effect.gen(function* () {
      yield* AppRoutes.pipe(HttpRouter.serve, Layer.build)

      // Register as online
      const mgr = yield* AgentManager
      const systemId = "del-test-online"
      yield* mgr.register(makeAgentInfo(systemId), createMockSocket())

      const response = yield* HttpClient.del(`/api/systems/${systemId}`)
      expect(response.status).toBe(409)
    }).pipe(Effect.provide(HttpInfraLayer)),
  )
})
