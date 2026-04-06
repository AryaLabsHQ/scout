import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { Database } from "../../src/services/database.js"
import { Retention } from "../../src/services/retention.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"
import { makeSystemMetricsSample } from "../helpers/fixtures.js"
import * as schema from "../../drizzle/schema.js"
import { eq, and } from "drizzle-orm"
import type { ScoutDatabase } from "../../src/services/database.js"

// provideMerge exposes both Retention and Database in the output layer
const RetentionTestLayer = Retention.layer.pipe(Layer.provideMerge(TestDatabaseLayer))

const run = <A, E>(effect: Effect.Effect<A, E, Database | Retention>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, RetentionTestLayer))

function insertSystem(db: ScoutDatabase, systemId: string, ts: number): void {
  db.insert(schema.systems)
    .values({
      id: systemId,
      hostname: systemId,
      status: "online",
      lastSeen: new Date(ts),
      createdAt: new Date(ts),
    })
    .onConflictDoUpdate({
      target: schema.systems.id,
      set: { status: "online", lastSeen: new Date(ts) },
    })
    .run()
}

function insertMetric(
  db: ScoutDatabase,
  systemId: string,
  ts: number,
  type: typeof schema.systemMetrics.$inferSelect["type"],
  cpuUsage: number,
): void {
  const sample = makeSystemMetricsSample({
    timestamp: ts,
    cpuPercent: cpuUsage,
    cpuPerCorePercent: [cpuUsage, cpuUsage, cpuUsage, cpuUsage],
    cpuUserPercent: cpuUsage * 0.6,
    cpuSystemPercent: 5,
    cpuIowaitPercent: 1,
    cpuIdlePercent: 100 - cpuUsage,
  })
  db.insert(schema.systemMetrics)
    .values({
      systemId,
      timestamp: new Date(ts),
      type,
      data: sample as unknown as Record<string, unknown>,
    })
    .run()
}

function insertPluginMetricPoint(
  db: ScoutDatabase,
  systemId: string,
  pluginId: string,
  metricId: string,
  ts: number,
  value: number,
): void {
  db.insert(schema.pluginMetricPoints)
    .values({
      systemId,
      pluginId,
      metricId,
      timestamp: new Date(ts),
      value,
    })
    .run()
}

describe("Retention service", () => {
  it("runOnce aggregates 1m records into a 10m rollup", () =>
    run(
      Effect.gen(function* () {
        const db = yield* Database
        const svc = yield* Retention
        const systemId = "sys-ret-agg-01"
        const baseTs = Date.now() - 5 * 60_000

        insertSystem(db, systemId, baseTs)

        // Insert 10 records with cpu.usage 10, 20, ..., 100 → avg 55
        for (let i = 0; i < 10; i++) {
          insertMetric(db, systemId, baseTs + i * 30_000, "1m", 10 * (i + 1))
        }

        yield* svc.runOnce()

        const rollups = db
          .select()
          .from(schema.systemMetrics)
          .where(and(eq(schema.systemMetrics.systemId, systemId), eq(schema.systemMetrics.type, "10m")))
          .all()

        expect(rollups.length).toBeGreaterThanOrEqual(1)

        const averaged = rollups[0].data as ReturnType<typeof makeSystemMetricsSample>
        expect(averaged.cpuPercent).toBeCloseTo(55, 1)
      }),
    ))

  it("averages are correct for known values (20 and 80 → 50)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* Database
        const svc = yield* Retention
        const systemId = "sys-ret-avg-01"
        const ts = Date.now() - 5 * 60_000

        insertSystem(db, systemId, ts)
        insertMetric(db, systemId, ts, "1m", 20)
        insertMetric(db, systemId, ts + 30_000, "1m", 80)

        yield* svc.runOnce()

        const rollups = db
          .select()
          .from(schema.systemMetrics)
          .where(and(eq(schema.systemMetrics.systemId, systemId), eq(schema.systemMetrics.type, "10m")))
          .all()

        expect(rollups.length).toBeGreaterThanOrEqual(1)
        const avg = rollups[0].data as ReturnType<typeof makeSystemMetricsSample>
        expect(avg.cpuPercent).toBeCloseTo(50, 0)
      }),
    ))

  it("cleanup: deletes 1m records older than retention period after runOnce", () =>
    run(
      Effect.gen(function* () {
        const db = yield* Database
        const svc = yield* Retention
        const systemId = "sys-ret-cleanup-01"
        const oldTs = Date.now() - 2 * 60 * 60 * 1000 // 2 hours ago — past 1h retention

        insertSystem(db, systemId, oldTs)
        for (let i = 0; i < 3; i++) {
          insertMetric(db, systemId, oldTs + i * 60_000, "1m", 50)
        }

        const before = db
          .select()
          .from(schema.systemMetrics)
          .where(and(eq(schema.systemMetrics.systemId, systemId), eq(schema.systemMetrics.type, "1m")))
          .all()
        expect(before).toHaveLength(3)

        yield* svc.runOnce()

        // Old 1m records should be deleted (> 1 hour old)
        const after = db
          .select()
          .from(schema.systemMetrics)
          .where(and(eq(schema.systemMetrics.systemId, systemId), eq(schema.systemMetrics.type, "1m")))
          .all()
        expect(after).toHaveLength(0)
      }),
    ))

  it("does not delete recent 1m records within retention window", () =>
    run(
      Effect.gen(function* () {
        const db = yield* Database
        const svc = yield* Retention
        const systemId = "sys-ret-recent-01"
        const recentTs = Date.now() - 10 * 60 * 1000 // 10 min ago — within 1h retention

        insertSystem(db, systemId, recentTs)
        insertMetric(db, systemId, recentTs, "1m", 50)

        yield* svc.runOnce()

        const remaining = db
          .select()
          .from(schema.systemMetrics)
          .where(and(eq(schema.systemMetrics.systemId, systemId), eq(schema.systemMetrics.type, "1m")))
          .all()

        expect(remaining).toHaveLength(1)
      }),
    ))

  it("cleanup: deletes old plugin metric points but keeps current plugin entities", () =>
    run(
      Effect.gen(function* () {
        const db = yield* Database
        const svc = yield* Retention
        const systemId = "sys-plugin-retention-01"
        const oldTs = Date.now() - 2 * 60 * 60 * 1000

        insertSystem(db, systemId, oldTs)
        db.insert(schema.pluginEntities)
          .values({
            key: `${systemId}:systemd:systemd.unit:nginx.service`,
            systemId,
            pluginId: "systemd",
            kind: "systemd.unit",
            entityId: "nginx.service",
            observedAt: new Date(oldTs),
            status: "active",
          })
          .run()
        insertPluginMetricPoint(db, systemId, "systemd", "units.total", oldTs, 12)

        yield* svc.runOnce()

        const metricPoints = db
          .select()
          .from(schema.pluginMetricPoints)
          .where(eq(schema.pluginMetricPoints.systemId, systemId))
          .all()
        expect(metricPoints).toHaveLength(0)

        const entities = db
          .select()
          .from(schema.pluginEntities)
          .where(eq(schema.pluginEntities.systemId, systemId))
          .all()
        expect(entities).toHaveLength(1)
      }),
    ))
})
