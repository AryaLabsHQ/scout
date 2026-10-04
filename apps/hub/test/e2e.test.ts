/**
 * E2E integration test: validates the full data pipeline.
 *
 * Strategy:
 * - Service pipeline tests use TestAppLayer directly (no HTTP server).
 * - HTTP route tests use BunHttpServer.layerTest + AppRoutes to spin up an
 *   in-process HTTP server and make real HTTP requests against it.
 *
 * After the M9 cleanup pass, agent lifecycle (register/unregister/listConnected/
 * grace period) lives on AgentRegistry rather than the deleted AgentManager.
 */

import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Layer, PubSub } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { BunHttpServer } from "@effect/platform-bun"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpRouter from "effect/http/HttpRouter"
import { AgentRegistry, type HubAgentClient } from "../src/rpc/agent-bridge.js"
import { MetricsIngestion } from "../src/services/metrics-ingestion.js"
import { MetricsBroadcast } from "../src/services/metrics-broadcast.js"
import { Retention } from "../src/services/retention.js"
import { AlertEngine } from "../src/services/alert-engine.js"
import { PluginRegistry } from "../src/services/plugin-registry.js"
import { TestDatabaseLayer } from "./helpers/test-database.js"
import { makeCoreMetricsPayload } from "./helpers/fixtures.js"
import { AppRoutes } from "../src/routes.js"
import type { AgentCapabilities, AgentInfo } from "@scout/shared"

// ── Test AppLayer (uses in-memory DB) ─────────────────────────────────────────

const TestAppLayer = Layer.mergeAll(
  TestDatabaseLayer,
  MetricsBroadcast.layer,
  MetricsIngestion.layer.pipe(Layer.provide(TestDatabaseLayer)),
  AgentRegistry.layer.pipe(Layer.provide(TestDatabaseLayer)),
  Retention.layer.pipe(Layer.provide(TestDatabaseLayer)),
  AlertEngine.layer.pipe(Layer.provide(Layer.merge(TestDatabaseLayer, MetricsBroadcast.layer))),
  PluginRegistry.layer,
)

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEFAULT_CAPABILITIES: AgentCapabilities = {
  system: true,
  network: true,
  process: false,
  temperature: false,
  gpu: false,
  smart: false,
}

// Service-level pipeline tests never call through the typed HubAgentClient —
// an empty object satisfies the type at the registry.register() boundary.
const MOCK_HUB_AGENT_CLIENT = {} as HubAgentClient

function makeAgentInfo(id: string): AgentInfo {
  return {
    systemId: id,
    hostname: `host-${id}`,
    version: "1.0.0",
    platform: "linux",
  }
}

// ── Service-level pipeline tests ──────────────────────────────────────────────

describe("E2E service pipeline", () => {
  it.layer(TestAppLayer)("Step 1-3: agent connects, sends 3 reports, they are stored", (it) => {
    it.effect("3 metrics reports are stored in DB", () =>
      Effect.gen(function* () {
        const registry = yield* AgentRegistry
        const ingestion = yield* MetricsIngestion

        // Step 1: Register mock agent
        yield* registry.register(makeAgentInfo("test-agent"), DEFAULT_CAPABILITIES, [], MOCK_HUB_AGENT_CLIENT)

        const connected = yield* registry.listConnected()
        expect(connected.length).toBe(1)
        expect(connected[0]?.agentId).toBe("test-agent")

        // Step 2-3: Ingest 3 reports
        const now = Date.now()
        for (let i = 0; i < 3; i++) {
          const payload = makeCoreMetricsPayload("test-agent", {
            timestamp: now + i * 60_000,
          })
          yield* ingestion.ingest(payload)
        }

        // Verify they are stored
        const metrics = yield* ingestion.querySystemMetrics("test-agent", 24)
        expect(metrics.length).toBe(3)
      }),
    )
  })

  it.layer(TestAppLayer)("Step 4-5: client subscription receives coalesced broadcast", (it) => {
    it.effect("metrics published to broadcast are received by subscribers", () =>
      Effect.gen(function* () {
        const ingestion = yield* MetricsIngestion
        const broadcast = yield* MetricsBroadcast

        // Step 4: Subscribe before publishing
        yield* Effect.scoped(
          Effect.gen(function* () {
            const sub = yield* broadcast.subscribe()

            // Fork: collect the first coalesced event
            const collectFiber = yield* Effect.forkScoped(PubSub.take(sub))

            // Ingest and publish 2 reports
            for (let i = 0; i < 2; i++) {
              const payload = makeCoreMetricsPayload("test-broadcast", {
                timestamp: Date.now() + i * 60_000,
              })
              yield* ingestion.ingest(payload)
              yield* broadcast.publishMetrics(payload.sample)
            }

            // Step 5: Advance time to trigger coalescing flush
            yield* TestClock.adjust("100 millis")

            const event = yield* Fiber.join(collectFiber)
            // Verify we got a coalesced event
            expect(event.event).toBe("metrics.data")
            const reports = event.data as unknown[]
            expect(reports.length).toBeGreaterThanOrEqual(1)
          }),
        )
      }),
    )
  })

  it.layer(TestAppLayer)("Step 6-8: query latest metrics and system metrics history", (it) => {
    it.effect("queryLatest and querySystemMetrics return correct data", () =>
      Effect.gen(function* () {
        const ingestion = yield* MetricsIngestion

        const baseTime = Date.now()
        const payloads = Array.from({ length: 3 }, (_, i) =>
          makeCoreMetricsPayload("test-query", {
            timestamp: baseTime + i * 60_000,
          }),
        )

        // Ingest all 3
        for (const payload of payloads) {
          yield* ingestion.ingest(payload)
        }

        // Step 6: Query latest — should return the last report
        const latest = yield* ingestion.queryLatest("test-query")
        expect(latest).not.toBeNull()
        expect(latest?.timestamp).toBe(baseTime + 2 * 60_000) // most recent

        // Step 7-8: Query all metrics
        const allMetrics = yield* ingestion.querySystemMetrics("test-query", 24)
        expect(allMetrics.length).toBe(3)
      }),
    )
  })

  it.layer(TestAppLayer)("Step 9-12: agent disconnect + grace period + offline status", (it) => {
    it.effect("after 5s grace period agent is marked offline", () =>
      Effect.gen(function* () {
        const registry = yield* AgentRegistry

        // Step 9: Connect and then disconnect
        yield* registry.register(makeAgentInfo("test-grace"), DEFAULT_CAPABILITIES, [], MOCK_HUB_AGENT_CLIENT)

        const before = yield* registry.listConnected()
        expect(before.length).toBe(1)

        yield* registry.unregister("test-grace", MOCK_HUB_AGENT_CLIENT)

        // Agent should be removed from connected list immediately
        const afterUnregister = yield* registry.listConnected()
        expect(afterUnregister.length).toBe(0)

        // Step 10: Advance past grace period
        yield* TestClock.adjust("6 seconds")

        // Step 11-12: Agent is not in connected list, system is offline
        const agent = yield* registry.getConnected("test-grace")
        expect(agent).toBeNull()
      }),
    )
  })

  it.layer(TestAppLayer)("agent reconnect before the old socket closes", (it) => {
    it.effect("closing the superseded connection keeps the new one", () =>
      Effect.gen(function* () {
        const registry = yield* AgentRegistry
        const oldClient = {} as HubAgentClient
        const newClient = {} as HubAgentClient

        yield* registry.register(makeAgentInfo("test-overlap"), DEFAULT_CAPABILITIES, [], oldClient)
        yield* registry.register(makeAgentInfo("test-overlap"), DEFAULT_CAPABILITIES, [], newClient)

        yield* registry.unregister("test-overlap", oldClient)
        yield* TestClock.adjust("6 seconds")

        expect(yield* registry.getClient("test-overlap")).toBe(newClient)
      }),
    )
  })

  it.layer(TestAppLayer)("retention: runOnce does not throw", (it) => {
    it.effect("retention runOnce completes successfully", () =>
      Effect.gen(function* () {
        const ingestion = yield* MetricsIngestion
        const retention = yield* Retention

        // Insert some data so retention has something to process
        const payload = makeCoreMetricsPayload("test-retention", {
          timestamp: Date.now(),
        })
        yield* ingestion.ingest(payload)

        // runOnce should not fail
        yield* retention.runOnce()
      }),
    )
  })
})

// ── HTTP route tests ──────────────────────────────────────────────────────────

const HttpInfraLayer = BunHttpServer.layerTest.pipe(Layer.provideMerge(TestAppLayer))

describe("E2E HTTP routes", () => {
  it.effect("GET /health returns ok status", () =>
    Effect.gen(function* () {
      yield* AppRoutes.pipe(HttpRouter.serve, Layer.build)

      const response = yield* HttpClient.get("/health")
      expect(response.status).toBe(200)

      const body = yield* response.json
      const health = body as Record<string, unknown>
      expect(health["status"]).toBe("ok")
      expect(typeof health["uptime"]).toBe("number")
      expect(typeof health["connectedAgents"]).toBe("number")
      expect(health["version"]).toBe("0.0.1")
    }).pipe(Effect.provide(HttpInfraLayer)),
  )

  it.effect("GET /api/systems returns empty array initially", () =>
    Effect.gen(function* () {
      yield* AppRoutes.pipe(HttpRouter.serve, Layer.build)

      const response = yield* HttpClient.get("/api/systems")
      expect(response.status).toBe(200)

      const body = yield* response.json
      expect(Array.isArray(body)).toBe(true)
      expect((body as unknown[]).length).toBe(0)
    }).pipe(Effect.provide(HttpInfraLayer)),
  )

  it.effect("GET /api/systems returns systems after ingestion", () =>
    Effect.gen(function* () {
      yield* AppRoutes.pipe(HttpRouter.serve, Layer.build)

      // Seed via service
      const ingestion = yield* MetricsIngestion
      const payload = makeCoreMetricsPayload("http-test-system", {
        timestamp: Date.now(),
      })
      yield* ingestion.ingest(payload)

      const response = yield* HttpClient.get("/api/systems")
      expect(response.status).toBe(200)

      const body = yield* response.json
      expect(Array.isArray(body)).toBe(true)
      const systems = body as Array<Record<string, unknown>>
      const found = systems.find((s) => s["id"] === "http-test-system")
      expect(found).toBeDefined()
      expect(found?.["hostname"]).toBe("http-test-system")
    }).pipe(Effect.provide(HttpInfraLayer)),
  )

  it.effect("GET /api/alerts returns empty array initially", () =>
    Effect.gen(function* () {
      yield* AppRoutes.pipe(HttpRouter.serve, Layer.build)

      const response = yield* HttpClient.get("/api/alerts")
      expect(response.status).toBe(200)

      const body = yield* response.json
      expect(Array.isArray(body)).toBe(true)
    }).pipe(Effect.provide(HttpInfraLayer)),
  )

  it.effect("GET /api/alert-rules returns empty array initially", () =>
    Effect.gen(function* () {
      yield* AppRoutes.pipe(HttpRouter.serve, Layer.build)

      const response = yield* HttpClient.get("/api/alert-rules")
      expect(response.status).toBe(200)

      const body = yield* response.json
      expect(Array.isArray(body)).toBe(true)
    }).pipe(Effect.provide(HttpInfraLayer)),
  )

  it.effect("GET /api/systems/:id returns 404 for unknown system", () =>
    Effect.gen(function* () {
      yield* AppRoutes.pipe(HttpRouter.serve, Layer.build)

      const response = yield* HttpClient.get("/api/systems/nonexistent-system-id")
      expect(response.status).toBe(404)
    }).pipe(Effect.provide(HttpInfraLayer)),
  )

  it.effect("GET /api/systems/:id/metrics returns metrics for system", () =>
    Effect.gen(function* () {
      yield* AppRoutes.pipe(HttpRouter.serve, Layer.build)

      const ingestion = yield* MetricsIngestion
      const systemId = "http-metrics-test"
      for (let i = 0; i < 2; i++) {
        yield* ingestion.ingest(makeCoreMetricsPayload(systemId, { timestamp: Date.now() + i * 60_000 }))
      }

      const response = yield* HttpClient.get(`/api/systems/${systemId}/metrics?hours=24`)
      expect(response.status).toBe(200)
      const body = yield* response.json
      expect(Array.isArray(body)).toBe(true)
      expect((body as unknown[]).length).toBe(2)
    }).pipe(Effect.provide(HttpInfraLayer)),
  )
})
