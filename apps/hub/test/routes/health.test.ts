/**
 * Tests for GET /health route.
 *
 * DELETE /api/systems/:id REST route was removed in the M9 cleanup pass —
 * its replacement is the `systems.remove` RPC mutation in ClientHubRpcs,
 * covered by the upcoming RPC-level e2e test.
 */

import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { BunHttpServer } from "@effect/platform-bun"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import { AgentRegistry, type HubAgentClient } from "../../src/rpc/agent-bridge.js"
import { MetricsIngestion } from "../../src/services/metrics-ingestion.js"
import { MetricsBroadcast } from "../../src/services/metrics-broadcast.js"
import { Retention } from "../../src/services/retention.js"
import { AlertEngine } from "../../src/services/alert-engine.js"
import { PluginRegistry } from "../../src/services/plugin-registry.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"
import { makeCoreMetricsPayload } from "../helpers/fixtures.js"
import { AppRoutes } from "../../src/routes.js"
import type { AgentCapabilities, AgentInfo } from "@scout/shared"

// ── Test AppLayer ─────────────────────────────────────────────────────────────

const TestAppLayer = Layer.mergeAll(
  TestDatabaseLayer,
  MetricsBroadcast.layer,
  MetricsIngestion.layer.pipe(Layer.provide(TestDatabaseLayer)),
  AgentRegistry.layer.pipe(Layer.provide(TestDatabaseLayer)),
  Retention.layer.pipe(Layer.provide(TestDatabaseLayer)),
  AlertEngine.layer.pipe(
    Layer.provide(Layer.merge(TestDatabaseLayer, MetricsBroadcast.layer)),
  ),
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

// Minimal mock — tests exercising /health never call through the typed
// HubAgentClient; an empty object satisfies the type at the
// registry.register() boundary.
const MOCK_HUB_AGENT_CLIENT = {} as HubAgentClient

const HttpInfraLayer = BunHttpServer.layerTest.pipe(
  Layer.provideMerge(TestAppLayer),
)

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

      // Register an agent via AgentRegistry
      const registry = yield* AgentRegistry
      yield* registry.register(
        makeAgentInfo("health-test-agent"),
        DEFAULT_CAPABILITIES,
        [],
        MOCK_HUB_AGENT_CLIENT,
      )

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
        makeCoreMetricsPayload("health-sys-1", { timestamp: Date.now() }),
      )
      yield* ingestion.ingest(
        makeCoreMetricsPayload("health-sys-2", { timestamp: Date.now() }),
      )

      const response = yield* HttpClient.get("/health")
      const body = (yield* response.json) as Record<string, unknown>
      expect((body["totalSystems"] as number) >= 2).toBe(true)
    }).pipe(Effect.provide(HttpInfraLayer)),
  )
})
