import { Effect, Layer, Schedule } from "effect"
import * as Context from "effect/Context"
import { and, eq, lt } from "drizzle-orm"
import type { SystemMetricsSample } from "@scout/shared"
import { Database } from "./database.js"
import * as schema from "../../drizzle/schema.js"

// Periodically downsample and prune old metrics rows to keep DB size bounded.
// Runs as a background fiber started during app boot.

export interface RetentionPolicy {
  /** Keep raw 1m metrics for this many hours (default 1) */
  readonly raw1mHours: number
  /** Keep 10m rollups for this many hours (default 12) */
  readonly rollup10mHours: number
  /** Keep 20m rollups for this many hours (default 24) */
  readonly rollup20mHours: number
  /** Keep 120m rollups for this many hours (default 168 = 7 days) */
  readonly rollup120mHours: number
  /** Keep 480m rollups for this many days (default 30) */
  readonly rollup480mDays: number
}

const defaultPolicy: RetentionPolicy = {
  raw1mHours: 1,
  rollup10mHours: 12,
  rollup20mHours: 24,
  rollup120mHours: 168, // 7 days
  rollup480mDays: 30,
}

type MetricType = typeof schema.systemMetrics.$inferSelect["type"]

interface RollupTier {
  readonly source: MetricType
  readonly target: MetricType
  readonly interval: string
  readonly retentionMs: (policy: RetentionPolicy) => number
}

const TIERS: RollupTier[] = [
  {
    source: "1m",
    target: "10m",
    interval: "10 minutes",
    retentionMs: (p) => p.raw1mHours * 60 * 60 * 1000,
  },
  {
    source: "10m",
    target: "20m",
    interval: "20 minutes",
    retentionMs: (p) => p.rollup10mHours * 60 * 60 * 1000,
  },
  {
    source: "20m",
    target: "120m",
    interval: "2 hours",
    retentionMs: (p) => p.rollup20mHours * 60 * 60 * 1000,
  },
  {
    source: "120m",
    target: "480m",
    interval: "8 hours",
    retentionMs: (p) => p.rollup120mHours * 60 * 60 * 1000,
  },
]

const CLEANUP_ONLY: { type: MetricType; retentionMs: (p: RetentionPolicy) => number } = {
  type: "480m",
  retentionMs: (p) => p.rollup480mDays * 24 * 60 * 60 * 1000,
}

// ---- Averaging helpers ----

function avgNumbers(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function avgArrays(arrays: ReadonlyArray<ReadonlyArray<number>>): number[] {
  if (arrays.length === 0) return []
  const len = arrays[0].length
  const result: number[] = []
  for (let i = 0; i < len; i++) {
    const vals = arrays.map((a) => a[i] ?? 0)
    result.push(avgNumbers(vals))
  }
  return result
}

function averageRecordMaps(
  reports: SystemMetricsSample[],
  select: (report: SystemMetricsSample) => Record<string, number>,
): Record<string, number> {
  const keys = [...new Set(reports.flatMap((report) => Object.keys(select(report))))]
  return Object.fromEntries(
    keys.map((key) => [
      key,
      avgNumbers(
        reports
          .map((report) => select(report)[key])
          .filter((value): value is number => value !== undefined),
      ),
    ]),
  )
}

function averageNullNumbers(values: Array<number | null>): number | null {
  const defined = values.filter((value): value is number => value !== null)
  return defined.length > 0 ? avgNumbers(defined) : null
}

function averageSamples(samples: SystemMetricsSample[]): SystemMetricsSample {
  const first = samples[0]

  return {
    timestamp: Math.round(avgNumbers(samples.map((sample) => sample.timestamp))),
    cpuPercent: avgNumbers(samples.map((sample) => sample.cpuPercent)),
    cpuCores: first.cpuCores,
    cpuPerCorePercent: avgArrays(samples.map((sample) => sample.cpuPerCorePercent)),
    cpuUserPercent: avgNumbers(samples.map((sample) => sample.cpuUserPercent)),
    cpuSystemPercent: avgNumbers(samples.map((sample) => sample.cpuSystemPercent)),
    cpuIowaitPercent: avgNumbers(samples.map((sample) => sample.cpuIowaitPercent)),
    cpuStealPercent: avgNumbers(samples.map((sample) => sample.cpuStealPercent)),
    cpuIdlePercent: avgNumbers(samples.map((sample) => sample.cpuIdlePercent)),
    memoryUsedBytes: avgNumbers(samples.map((sample) => sample.memoryUsedBytes)),
    memoryTotalBytes: first.memoryTotalBytes,
    memoryAvailableBytes: avgNumbers(samples.map((sample) => sample.memoryAvailableBytes)),
    memoryBuffersCacheBytes: avgNumbers(samples.map((sample) => sample.memoryBuffersCacheBytes)),
    swapUsedBytes: avgNumbers(samples.map((sample) => sample.swapUsedBytes)),
    swapTotalBytes: first.swapTotalBytes,
    memoryPercent: avgNumbers(samples.map((sample) => sample.memoryPercent)),
    diskUsedBytes: averageNullNumbers(samples.map((sample) => sample.diskUsedBytes)),
    diskTotalBytes: first.diskTotalBytes,
    diskPercent: averageNullNumbers(samples.map((sample) => sample.diskPercent)),
    diskReadBytesPerSec: avgNumbers(samples.map((sample) => sample.diskReadBytesPerSec)),
    diskWriteBytesPerSec: avgNumbers(samples.map((sample) => sample.diskWriteBytesPerSec)),
    networkRxBytesPerSec: avgNumbers(samples.map((sample) => sample.networkRxBytesPerSec)),
    networkTxBytesPerSec: avgNumbers(samples.map((sample) => sample.networkTxBytesPerSec)),
    networkRxBytesPerSecByInterface: averageRecordMaps(
      samples,
      (sample) => sample.networkRxBytesPerSecByInterface,
    ),
    networkTxBytesPerSecByInterface: averageRecordMaps(
      samples,
      (sample) => sample.networkTxBytesPerSecByInterface,
    ),
    gpuPercent: averageNullNumbers(samples.map((sample) => sample.gpuPercent)),
    gpuMemoryPercent: averageNullNumbers(samples.map((sample) => sample.gpuMemoryPercent)),
    gpuTemperatureCelsius: averageNullNumbers(
      samples.map((sample) => sample.gpuTemperatureCelsius),
    ),
    temperaturesCelsius: averageRecordMaps(
      samples,
      (sample) => sample.temperaturesCelsius,
    ),
    smartHealthFailing: samples.some((sample) => sample.smartHealthFailing),
    loadAvg1m: avgNumbers(samples.map((sample) => sample.loadAvg1m)),
    loadAvg5m: avgNumbers(samples.map((sample) => sample.loadAvg5m)),
    loadAvg15m: avgNumbers(samples.map((sample) => sample.loadAvg15m)),
    uptimeSeconds: avgNumbers(samples.map((sample) => sample.uptimeSeconds)),
  }
}

export class Retention extends Context.Service<Retention, {
  /**
   * Trigger a single retention + downsampling pass immediately.
   * Normally called by the background ticker, but exposed for testing.
   */
  readonly runOnce: () => Effect.Effect<void>
  /**
   * Start the background fiber that runs retention on a schedule.
   * Returns an Effect that runs until the scope is closed.
   */
  readonly runForever: () => Effect.Effect<void>
}>()(
  "@scout/Retention",
  {
    make: Effect.gen(function* () {
      const db = yield* Database

      const runOnce = (): Effect.Effect<void> =>
        Effect.gen(function* () {
          const now = Date.now()
          const policy = defaultPolicy

          yield* Effect.sync(() => {
          // Aggregate each tier
          for (const tier of TIERS) {
            // Get distinct systemIds that have source records
            const systemRows = db
              .selectDistinct({ systemId: schema.systemMetrics.systemId })
              .from(schema.systemMetrics)
              .where(eq(schema.systemMetrics.type, tier.source))
              .all()

            for (const { systemId } of systemRows) {
              // Get all source records for this system
              const rows = db
                .select()
                .from(schema.systemMetrics)
                .where(
                  and(
                    eq(schema.systemMetrics.systemId, systemId),
                    eq(schema.systemMetrics.type, tier.source),
                  ),
                )
                .orderBy(schema.systemMetrics.timestamp)
                .all()

              if (rows.length === 0) continue

              // Parse data blobs
              const reports = rows.map((r) => r.data as unknown as SystemMetricsSample)

              // Only aggregate if we have records
              const averaged = averageSamples(reports)

              // Insert aggregated record with target type
              db.insert(schema.systemMetrics)
                .values({
                  systemId,
                  timestamp: new Date(averaged.timestamp),
                  type: tier.target,
                  data: averaged as unknown as Record<string, unknown>,
                })
                .run()
            }

            // Cleanup source records past retention
            const cutoff = new Date(now - tier.retentionMs(policy))
            db.delete(schema.systemMetrics)
              .where(
                and(
                  eq(schema.systemMetrics.type, tier.source),
                  lt(schema.systemMetrics.timestamp, cutoff),
                ),
              )
              .run()
          }

          // Cleanup 480m records past their retention
          const cutoff480 = new Date(now - CLEANUP_ONLY.retentionMs(policy))
          db.delete(schema.systemMetrics)
            .where(
              and(
                eq(schema.systemMetrics.type, CLEANUP_ONLY.type),
                lt(schema.systemMetrics.timestamp, cutoff480),
              ),
            )
            .run()

          // Plugin-native points are append-only; keep entity state as current rows.
          const pluginMetricCutoff = new Date(now - policy.raw1mHours * 60 * 60 * 1000)
          db.delete(schema.pluginMetricPoints)
            .where(lt(schema.pluginMetricPoints.timestamp, pluginMetricCutoff))
            .run()
          })

          yield* Effect.logInfo("Retention cleanup completed")
        })

      const runForever = (): Effect.Effect<void> =>
        Effect.repeat(
          runOnce(),
          Schedule.spaced("10 minutes"),
        ).pipe(Effect.asVoid)

      return { runOnce, runForever }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
