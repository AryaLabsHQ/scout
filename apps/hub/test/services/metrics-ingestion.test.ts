import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { Database } from "../../src/services/database.js"
import { MetricsIngestion } from "../../src/services/metrics-ingestion.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"
import { makeAgentReport } from "../helpers/fixtures.js"

const MetricsTestLayer = MetricsIngestion.layer.pipe(
  Layer.provide(TestDatabaseLayer),
)

const run = <A>(effect: Effect.Effect<A, unknown, MetricsIngestion | Database>) =>
  Effect.runPromise(effect.pipe(Effect.provide(MetricsTestLayer)))

describe("MetricsIngestion service", () => {
  it("ingest valid report → query returns it", async () => {
    const report = makeAgentReport({ systemId: "sys-ingest-01", timestamp: Date.now() })

    await run(
      Effect.gen(function* () {
        const svc = yield* MetricsIngestion
        const ts = yield* svc.ingest(report)
        expect(ts).toBe(report.timestamp)

        const rows = yield* svc.querySystemMetrics("sys-ingest-01", 24)
        expect(rows).toHaveLength(1)
        const stored = rows[0].data as typeof report
        expect(stored.systemId).toBe("sys-ingest-01")
      }),
    )
  })

  it("ingest invalid JSON → SchemaValidationError", async () => {
    await run(
      Effect.gen(function* () {
        const svc = yield* MetricsIngestion
        const result = yield* svc.ingestRaw({ bad: "data", missing: "required fields" }).pipe(
          Effect.either,
        )
        expect(result._tag).toBe("Left")
        if (result._tag === "Left") {
          expect(result.left._tag).toBe("SchemaValidationError")
        }
      }),
    )
  })

  it("ingest report with missing optional sections → succeeds", async () => {
    const minimalReport = makeAgentReport({
      systemId: "sys-minimal-01",
      timestamp: Date.now(),
      // no processes, temperatures, gpu, smart, systemd, docker, k8s
    })
    // Remove optional fields
    delete (minimalReport as Partial<typeof minimalReport>).processes
    delete (minimalReport as Partial<typeof minimalReport>).temperatures

    await run(
      Effect.gen(function* () {
        const svc = yield* MetricsIngestion
        const ts = yield* svc.ingest(minimalReport)
        expect(typeof ts).toBe("number")
      }),
    )
  })

  it("ingest 5 reports → querySystemMetrics returns 5", async () => {
    const systemId = "sys-five-01"
    const reports = Array.from({ length: 5 }, (_, i) =>
      makeAgentReport({ systemId, timestamp: Date.now() + i * 60_000 }),
    )

    await run(
      Effect.gen(function* () {
        const svc = yield* MetricsIngestion
        for (const report of reports) {
          yield* svc.ingest(report)
        }
        const rows = yield* svc.querySystemMetrics(systemId, 24)
        expect(rows).toHaveLength(5)
      }),
    )
  })

  it("queryLatest returns most recent", async () => {
    const systemId = "sys-latest-01"
    const base = Date.now()
    const older = makeAgentReport({ systemId, timestamp: base })
    const newer = makeAgentReport({ systemId, timestamp: base + 60_000 })

    await run(
      Effect.gen(function* () {
        const svc = yield* MetricsIngestion
        yield* svc.ingest(older)
        yield* svc.ingest(newer)

        const latest = yield* svc.queryLatest(systemId)
        expect(latest).not.toBeNull()
        expect(latest!.timestamp).toBe(newer.timestamp)
      }),
    )
  })

  it("ingestRaw valid payload → succeeds", async () => {
    const report = makeAgentReport({ systemId: "sys-raw-01", timestamp: Date.now() })

    await run(
      Effect.gen(function* () {
        const svc = yield* MetricsIngestion
        const ts = yield* svc.ingestRaw(report)
        expect(typeof ts).toBe("number")
      }),
    )
  })
})
