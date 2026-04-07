import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { BunHttpServer } from "@effect/platform-bun"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import { AgentRegistry } from "../../src/rpc/agent-bridge.js"
import { MetricsIngestion } from "../../src/services/metrics-ingestion.js"
import { MetricsBroadcast } from "../../src/services/metrics-broadcast.js"
import { Retention } from "../../src/services/retention.js"
import { AlertEngine } from "../../src/services/alert-engine.js"
import { PluginRegistry } from "../../src/services/plugin-registry.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"
import { AppRoutes } from "../../src/routes.js"

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

const HttpInfraLayer = BunHttpServer.layerTest.pipe(
  Layer.provideMerge(TestAppLayer),
)

describe("GET /api/plugins", () => {
  it.effect("returns loaded plugin manifests from the first-party plugin package directory", () =>
    Effect.gen(function* () {
      yield* AppRoutes.pipe(HttpRouter.serve, Layer.build)

      const response = yield* HttpClient.get("/api/plugins")
      expect(response.status).toBe(200)

      const body = (yield* response.json) as Array<Record<string, unknown>>
      expect(body.some((plugin) => plugin["id"] === "systemd")).toBe(true)
    }).pipe(Effect.provide(HttpInfraLayer)),
  )
})

describe("GET /api/plugins/:id", () => {
  it.effect("returns manifest, agent action metadata, screens, and alerts for the requested plugin", () =>
    Effect.gen(function* () {
      yield* AppRoutes.pipe(HttpRouter.serve, Layer.build)

      const response = yield* HttpClient.get("/api/plugins/systemd")
      expect(response.status).toBe(200)

      const body = (yield* response.json) as Record<string, unknown>
      const agent = body["agent"] as Record<string, unknown>
      const manifest = body["manifest"] as Record<string, unknown>
      const hub = body["hub"] as Record<string, unknown>
      const web = body["web"] as Record<string, unknown>

      expect(manifest["id"]).toBe("systemd")
      expect(Array.isArray(agent["actions"])).toBe(true)
      expect(Array.isArray(hub["alerts"])).toBe(true)
      expect(Array.isArray(web["screens"])).toBe(true)
    }).pipe(Effect.provide(HttpInfraLayer)),
  )
})

describe("GET /api/systems/:id/plugins/:pluginId/*", () => {
  it.effect("returns plugin-native entities, metric points, and events for a system", () =>
    Effect.gen(function* () {
      yield* AppRoutes.pipe(HttpRouter.serve, Layer.build)

      const ingestion = yield* MetricsIngestion
      const timestamp = Date.now()
      yield* ingestion.ingestPluginCollection(
        "plugin-route-systemd",
        {
          entities: [
            {
              ref: {
                pluginId: "systemd",
                kind: "systemd.unit",
                nodeId: "plugin-route-systemd",
                id: "nginx.service",
              },
              ts: timestamp,
              displayName: "Nginx",
              status: "active",
            },
          ],
          metrics: [
            {
              pluginId: "systemd",
              metricId: "units.total",
              ts: timestamp,
              value: 1,
            },
          ],
          events: [
            {
              pluginId: "systemd",
              eventId: "unit.failed",
              ts: timestamp,
              severity: "warning",
              message: "nginx.service briefly failed",
            },
          ],
        },
      )

      const entitiesResponse = yield* HttpClient.get(
        "/api/systems/plugin-route-systemd/plugins/systemd/entities",
      )
      expect(entitiesResponse.status).toBe(200)
      const entities = (yield* entitiesResponse.json) as Array<Record<string, unknown>>
      expect(entities).toHaveLength(1)
      expect((entities[0]?.["ref"] as Record<string, unknown>)["id"]).toBe("nginx.service")

      const metricsResponse = yield* HttpClient.get(
        "/api/systems/plugin-route-systemd/plugins/systemd/metrics?metricId=units.total&hours=24",
      )
      expect(metricsResponse.status).toBe(200)
      const metrics = (yield* metricsResponse.json) as Array<Record<string, unknown>>
      expect(metrics).toHaveLength(1)
      expect(metrics[0]?.["value"]).toBe(1)

      const eventsResponse = yield* HttpClient.get(
        "/api/systems/plugin-route-systemd/plugins/systemd/events?eventId=unit.failed&hours=24",
      )
      expect(eventsResponse.status).toBe(200)
      const events = (yield* eventsResponse.json) as Array<Record<string, unknown>>
      expect(events).toHaveLength(1)
      expect(events[0]?.["eventId"]).toBe("unit.failed")
    }).pipe(Effect.provide(HttpInfraLayer)),
  )
})
