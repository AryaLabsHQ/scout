import { describe, it, expect } from "vitest"
import { Cause, Effect, Exit, Layer } from "effect"
import { Database } from "../../src/services/database.js"
import { MetricsIngestion } from "../../src/services/metrics-ingestion.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"
import { makeAgentReport } from "../helpers/fixtures.js"

// provideMerge exposes both MetricsIngestion and Database in the output layer
const MetricsTestLayer = MetricsIngestion.layer.pipe(Layer.provideMerge(TestDatabaseLayer))

const run = <A, E>(effect: Effect.Effect<A, E, Database | MetricsIngestion>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, MetricsTestLayer))

describe("MetricsIngestion service", () => {
  it("ingest valid report → query returns it", () =>
    run(
      Effect.gen(function* () {
        const svc = yield* MetricsIngestion
        const report = makeAgentReport({ systemId: "sys-ingest-01", timestamp: Date.now() })
        const ts = yield* svc.ingest(report)
        expect(ts).toBe(report.timestamp)

        const rows = yield* svc.querySystemMetrics("sys-ingest-01", 24)
        expect(rows).toHaveLength(1)
        const stored = rows[0].data as typeof report
        expect(stored.systemId).toBe("sys-ingest-01")
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
        const minimalReport = makeAgentReport({
          systemId: "sys-minimal-01",
          timestamp: Date.now(),
        })

        const ts = yield* svc.ingest(minimalReport)
        expect(typeof ts).toBe("number")
      }),
    ))

  it("ingest 5 reports → querySystemMetrics returns 5", () =>
    run(
      Effect.gen(function* () {
        const svc = yield* MetricsIngestion
        const systemId = "sys-five-01"
        const reports = Array.from({ length: 5 }, (_, i) =>
          makeAgentReport({ systemId, timestamp: Date.now() + i * 60_000 }),
        )

        for (const report of reports) {
          yield* svc.ingest(report)
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
        const older = makeAgentReport({ systemId, timestamp: base })
        const newer = makeAgentReport({ systemId, timestamp: base + 60_000 })

        yield* svc.ingest(older)
        yield* svc.ingest(newer)

        const latest = yield* svc.queryLatest(systemId)
        expect(latest).not.toBeNull()
        expect(latest!.timestamp).toBe(newer.timestamp)
      }),
    ))

  it("ingestRaw valid payload → succeeds", () =>
    run(
      Effect.gen(function* () {
        const svc = yield* MetricsIngestion
        const report = makeAgentReport({ systemId: "sys-raw-01", timestamp: Date.now() })
        const ts = yield* svc.ingestRaw(report as unknown)
        expect(typeof ts).toBe("number")
      }),
    ))
})
