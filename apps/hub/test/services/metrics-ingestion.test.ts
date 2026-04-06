import { describe, it, expect } from "vitest"
import { Cause, Effect, Exit, Layer } from "effect"
import { Database } from "../../src/services/database.js"
import { MetricsIngestion } from "../../src/services/metrics-ingestion.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"
import { makeCoreMetricsPayload } from "../helpers/fixtures.js"

// provideMerge exposes both MetricsIngestion and Database in the output layer
const MetricsTestLayer = MetricsIngestion.layer.pipe(Layer.provideMerge(TestDatabaseLayer))

const run = <A, E>(effect: Effect.Effect<A, E, Database | MetricsIngestion>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, MetricsTestLayer))

describe("MetricsIngestion service", () => {
  it("ingest valid report → query returns it", () =>
    run(
      Effect.gen(function* () {
        const svc = yield* MetricsIngestion
        const payload = makeCoreMetricsPayload("sys-ingest-01", { timestamp: Date.now() })
        const ts = yield* svc.ingest(payload)
        expect(ts).toBe(payload.sample.timestamp)

        const rows = yield* svc.querySystemMetrics("sys-ingest-01", 24)
        expect(rows).toHaveLength(1)
        const stored = rows[0].data as typeof payload.sample
        expect(rows[0]?.systemId).toBe("sys-ingest-01")
        expect(stored.cpuPercent).toBe(payload.sample.cpuPercent)
      }),
    ))

  it("ingest invalid JSON → SchemaValidationError", () =>
    run(
      Effect.gen(function* () {
        const svc = yield* MetricsIngestion
        const result = yield* Effect.exit(svc.ingestRaw({ bad: "data", missing: "required fields" }))
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          const failReasons = result.cause.reasons.filter(Cause.isFailReason)
          expect(failReasons.length).toBeGreaterThan(0)
          expect(failReasons[0].error._tag).toBe("SchemaValidationError")
        }
      }),
    ))

  it("ingest report with missing optional sections → succeeds", () =>
    run(
      Effect.gen(function* () {
        const svc = yield* MetricsIngestion
        const minimalPayload = makeCoreMetricsPayload("sys-minimal-01", {
          timestamp: Date.now(),
        })

        const ts = yield* svc.ingest(minimalPayload)
        expect(typeof ts).toBe("number")
      }),
    ))

  it("ingest 5 reports → querySystemMetrics returns 5", () =>
    run(
      Effect.gen(function* () {
        const svc = yield* MetricsIngestion
        const systemId = "sys-five-01"
        const payloads = Array.from({ length: 5 }, (_, i) =>
          makeCoreMetricsPayload(systemId, { timestamp: Date.now() + i * 60_000 }),
        )

        for (const payload of payloads) {
          yield* svc.ingest(payload)
        }
        const rows = yield* svc.querySystemMetrics(systemId, 24)
        expect(rows).toHaveLength(5)
      }),
    ))

  it("queryLatest returns most recent", () =>
    run(
      Effect.gen(function* () {
        const svc = yield* MetricsIngestion
        const systemId = "sys-latest-01"
        const base = Date.now()
        const older = makeCoreMetricsPayload(systemId, { timestamp: base })
        const newer = makeCoreMetricsPayload(systemId, { timestamp: base + 60_000 })

        yield* svc.ingest(older)
        yield* svc.ingest(newer)

        const latest = yield* svc.queryLatest(systemId)
        expect(latest).not.toBeNull()
        expect(latest!.timestamp).toBe(newer.sample.timestamp)
      }),
    ))

  it("ingestRaw valid payload → succeeds", () =>
    run(
      Effect.gen(function* () {
        const svc = yield* MetricsIngestion
        const payload = makeCoreMetricsPayload("sys-raw-01", { timestamp: Date.now() })
        const ts = yield* svc.ingestRaw(payload as unknown)
        expect(typeof ts).toBe("number")
      }),
    ))

  it("ingestPluginCollection persists plugin-native entities and metric points", () =>
    run(
      Effect.gen(function* () {
        const svc = yield* MetricsIngestion
        const now = Date.now()
        yield* svc.ingestPluginCollection("sys-plugin-01", {
          entities: [
            {
              ref: {
                pluginId: "systemd",
                kind: "systemd.unit",
                nodeId: "sys-plugin-01",
                id: "nginx.service",
              },
              ts: now,
              displayName: "Nginx",
              status: "active",
            },
            {
              ref: {
                pluginId: "systemd",
                kind: "systemd.unit",
                nodeId: "sys-plugin-01",
                id: "backup.service",
              },
              ts: now,
              displayName: "Backup",
              status: "failed",
            },
          ],
          metrics: [
            {
              pluginId: "systemd",
              metricId: "units.failed",
              ts: now,
              value: 1,
            },
            {
              pluginId: "systemd",
              metricId: "unit.memory.bytes",
              ts: now,
              entity: {
                pluginId: "systemd",
                kind: "systemd.unit",
                nodeId: "sys-plugin-01",
                id: "nginx.service",
              },
              value: 1024,
              unit: "bytes",
            },
          ],
        })

        const entities = yield* svc.queryPluginEntities("sys-plugin-01", "systemd")
        expect(entities).toHaveLength(2)
        expect(entities[0]?.ref.pluginId).toBe("systemd")

        const summaryPoints = yield* svc.queryPluginMetricPoints(
          "sys-plugin-01",
          "systemd",
          24,
          "units.failed",
        )
        expect(summaryPoints).toHaveLength(1)
        expect(summaryPoints[0]?.value).toBe(1)

        const unitPoints = yield* svc.queryPluginMetricPoints(
          "sys-plugin-01",
          "systemd",
          24,
          "unit.memory.bytes",
        )
        expect(unitPoints).toHaveLength(1)
        expect(unitPoints[0]?.entity?.id).toBe("nginx.service")
      }),
    ))

  it("ingestPluginCollection persists plugin-native events", () =>
    run(
      Effect.gen(function* () {
        const svc = yield* MetricsIngestion
        const now = Date.now()

        yield* svc.ingestPluginCollection("sys-events-01", {
          events: [
            {
              pluginId: "systemd",
              eventId: "unit.failed",
              ts: now,
              severity: "warning",
              message: "nginx.service failed once",
            },
          ],
        })

        const events = yield* svc.queryPluginEvents("sys-events-01", "systemd", 24, "unit.failed")
        expect(events).toHaveLength(1)
        expect(events[0]?.eventId).toBe("unit.failed")
        expect(events[0]?.message).toContain("nginx.service")
      }),
    ))
})
