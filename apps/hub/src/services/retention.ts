import { Effect, Layer, Schedule } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import { and, eq, lt } from "drizzle-orm"
import type { AgentReport } from "@scout/shared"
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

function avgArrays(arrays: number[][]): number[] {
  if (arrays.length === 0) return []
  const len = arrays[0].length
  const result: number[] = []
  for (let i = 0; i < len; i++) {
    const vals = arrays.map((a) => a[i] ?? 0)
    result.push(avgNumbers(vals))
  }
  return result
}

function averageReports(reports: AgentReport[]): AgentReport {
  const first = reports[0]
  const avgTimestamp = Math.round(avgNumbers(reports.map((r) => r.timestamp)))

  // CPU
  const cpuUsage = avgNumbers(reports.map((r) => r.system.cpu.usage))
  const cpuCores = first.system.cpu.cores
  const perCore = avgArrays(reports.map((r) => r.system.cpu.perCore))
  const breakdown = {
    user: avgNumbers(reports.map((r) => r.system.cpu.breakdown.user)),
    system: avgNumbers(reports.map((r) => r.system.cpu.breakdown.system)),
    iowait: avgNumbers(reports.map((r) => r.system.cpu.breakdown.iowait)),
    steal: avgNumbers(reports.map((r) => r.system.cpu.breakdown.steal)),
    idle: avgNumbers(reports.map((r) => r.system.cpu.breakdown.idle)),
  }

  // Memory
  const memory = {
    used: avgNumbers(reports.map((r) => r.system.memory.used)),
    total: first.system.memory.total,
    available: avgNumbers(reports.map((r) => r.system.memory.available)),
    buffersCache: avgNumbers(reports.map((r) => r.system.memory.buffersCache)),
    swap: {
      used: avgNumbers(reports.map((r) => r.system.memory.swap.used)),
      total: first.system.memory.swap.total,
    },
  }

  // Disks — average same mounts
  const mounts = [...new Set(reports.flatMap((r) => r.system.disks.map((d) => d.mount)))]
  const disks = mounts.map((mount) => {
    const ds = reports.flatMap((r) => r.system.disks.filter((d) => d.mount === mount))
    return {
      mount,
      device: ds[0].device,
      used: avgNumbers(ds.map((d) => d.used)),
      total: ds[0].total,
      readBytesPerSec: avgNumbers(ds.map((d) => d.readBytesPerSec)),
      writeBytesPerSec: avgNumbers(ds.map((d) => d.writeBytesPerSec)),
    }
  })

  // Load avg
  const loadAvg: [number, number, number] = [
    avgNumbers(reports.map((r) => r.system.loadAvg[0])),
    avgNumbers(reports.map((r) => r.system.loadAvg[1])),
    avgNumbers(reports.map((r) => r.system.loadAvg[2])),
  ]

  const uptime = avgNumbers(reports.map((r) => r.system.uptime))

  // Network — average same interface names
  const ifnames = [...new Set(reports.flatMap((r) => r.network.map((n) => n.name)))]
  const network = ifnames.map((name) => {
    const ifaces = reports.flatMap((r) => r.network.filter((n) => n.name === name))
    return {
      name,
      rxBytesPerSec: avgNumbers(ifaces.map((n) => n.rxBytesPerSec)),
      txBytesPerSec: avgNumbers(ifaces.map((n) => n.txBytesPerSec)),
      rxPacketsPerSec: avgNumbers(ifaces.map((n) => n.rxPacketsPerSec)),
      txPacketsPerSec: avgNumbers(ifaces.map((n) => n.txPacketsPerSec)),
    }
  })

  const averaged: AgentReport = {
    systemId: first.systemId,
    timestamp: avgTimestamp,
    system: {
      cpu: { usage: cpuUsage, cores: cpuCores, perCore, breakdown },
      memory,
      disks,
      loadAvg,
      uptime,
    },
    network,
  }

  // Carry over optional sections from first record
  if (first.processes) averaged.processes = first.processes
  if (first.temperatures) averaged.temperatures = first.temperatures
  if (first.gpu) averaged.gpu = first.gpu
  if (first.smart) averaged.smart = first.smart
  if (first.systemd) averaged.systemd = first.systemd
  if (first.docker) averaged.docker = first.docker
  if (first.k8s) averaged.k8s = first.k8s

  return averaged
}

export class Retention extends ServiceMap.Service<Retention, {
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
              const reports = rows.map((r) => r.data as unknown as AgentReport)

              // Only aggregate if we have records
              const averaged = averageReports(reports)

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
