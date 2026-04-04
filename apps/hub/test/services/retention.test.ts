import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { Database } from "../../src/services/database.js"
import { Retention } from "../../src/services/retention.js"
import { TestDatabaseLayer } from "../helpers/test-database.js"
import { makeAgentReport } from "../helpers/fixtures.js"
import * as schema from "../../drizzle/schema.js"
import { eq, and } from "drizzle-orm"

const RetentionTestLayer = Retention.layer.pipe(
  Layer.provide(TestDatabaseLayer),
)

const run = <A>(effect: Effect.Effect<A, unknown, Retention | Database>) =>
  Effect.runPromise(effect.pipe(Effect.provide(RetentionTestLayer)))

/** Insert N metrics rows directly into the DB with a given type and timestamp */
function insertMetricRows(
  db: typeof schema.systemMetrics.$inferInsert extends infer _T ? ReturnType<typeof import("drizzle-orm/bun-sqlite").drizzle<typeof import("../../drizzle/schema.js")>> : never,
  systemId: string,
  count: number,
  type: typeof schema.systemMetrics.$inferSelect["type"],
  baseTimestamp: number,
): void {
  // First ensure the system row exists
  db.insert(schema.systems)
    .values({
      id: systemId,
      hostname: systemId,
      status: "online",
      lastSeen: new Date(baseTimestamp),
      createdAt: new Date(baseTimestamp),
    })
    .onConflictDoUpdate({
      target: schema.systems.id,
      set: { status: "online", lastSeen: new Date(baseTimestamp) },
    })
    .run()

  for (let i = 0; i < count; i++) {
    const ts = baseTimestamp + i * 60_000
    const report = makeAgentReport({ systemId, timestamp: ts })
    db.insert(schema.systemMetrics)
      .values({
        systemId,
        timestamp: new Date(ts),
        type,
        data: report as unknown as Record<string, unknown>,
      })
      .run()
  }
}

describe("Retention service", () => {
  it("runOnce aggregates 1m records into a 10m rollup", async () => {
    const systemId = "sys-ret-agg-01"

    await run(
      Effect.gen(function* () {
        const db = yield* Database
        const svc = yield* Retention

        // Insert 10 "1m" records with known cpu.usage values
        const baseTs = Date.now() - 5 * 60_000 // 5 min ago
        for (let i = 0; i < 10; i++) {
          const ts = baseTs + i * 30_000
          // First ensure system row
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

          const report = makeAgentReport({
            systemId,
            timestamp: ts,
            system: {
              cpu: {
                usage: 10 * (i + 1), // 10, 20, 30, ..., 100
                cores: 4,
                perCore: [10 * (i + 1), 10 * (i + 1), 10 * (i + 1), 10 * (i + 1)],
                breakdown: { user: 5 * (i + 1), system: 2, iowait: 1, steal: 0, idle: 50 },
              },
              memory: {
                used: 1_000_000 * (i + 1),
                total: 8_000_000_000,
                available: 8_000_000_000 - 1_000_000 * (i + 1),
                buffersCache: 500_000_000,
                swap: { used: 0, total: 2_000_000_000 },
              },
              disks: [
                {
                  mount: "/",
                  device: "/dev/sda1",
                  used: 50_000_000_000,
                  total: 100_000_000_000,
                  readBytesPerSec: 1024,
                  writeBytesPerSec: 2048,
                },
              ],
              loadAvg: [1.0, 1.5, 2.0],
              uptime: 86400,
            },
            network: [
              {
                name: "eth0",
                rxBytesPerSec: 1000 * (i + 1),
                txBytesPerSec: 500,
                rxPacketsPerSec: 10,
                txPacketsPerSec: 5,
              },
            ],
          })

          db.insert(schema.systemMetrics)
            .values({
              systemId,
              timestamp: new Date(ts),
              type: "1m",
              data: report as unknown as Record<string, unknown>,
            })
            .run()
        }

        // Run retention pass
        yield* svc.runOnce()

        // Check that a "10m" aggregated record was created
        const rollups = db
          .select()
          .from(schema.systemMetrics)
          .where(
            and(
              eq(schema.systemMetrics.systemId, systemId),
              eq(schema.systemMetrics.type, "10m"),
            ),
          )
          .all()

        expect(rollups.length).toBeGreaterThanOrEqual(1)

        // Verify averages in the aggregated record
        const averaged = rollups[0].data as ReturnType<typeof makeAgentReport>
        // cpu.usage should be average of 10, 20, ..., 100 = 55
        expect(averaged.system.cpu.usage).toBeCloseTo(55, 1)
      }),
    )
  })

  it("cleanup: deletes 1m records older than retention period after runOnce", async () => {
    const systemId = "sys-ret-cleanup-01"
    const oldTs = Date.now() - 2 * 60 * 60 * 1000 // 2 hours ago — past 1h retention

    await run(
      Effect.gen(function* () {
        const db = yield* Database
        const svc = yield* Retention

        // Insert system row
        db.insert(schema.systems)
          .values({
            id: systemId,
            hostname: systemId,
            status: "online",
            lastSeen: new Date(oldTs),
            createdAt: new Date(oldTs),
          })
          .run()

        // Insert 3 old "1m" records
        for (let i = 0; i < 3; i++) {
          const report = makeAgentReport({ systemId, timestamp: oldTs + i * 60_000 })
          db.insert(schema.systemMetrics)
            .values({
              systemId,
              timestamp: new Date(oldTs + i * 60_000),
              type: "1m",
              data: report as unknown as Record<string, unknown>,
            })
            .run()
        }

        // Verify they exist before cleanup
        const before = db
          .select()
          .from(schema.systemMetrics)
          .where(
            and(
              eq(schema.systemMetrics.systemId, systemId),
              eq(schema.systemMetrics.type, "1m"),
            ),
          )
          .all()
        expect(before).toHaveLength(3)

        // Run retention — should aggregate AND delete old 1m records
        yield* svc.runOnce()

        // Old 1m records should be deleted (they are > 1 hour old)
        const after = db
          .select()
          .from(schema.systemMetrics)
          .where(
            and(
              eq(schema.systemMetrics.systemId, systemId),
              eq(schema.systemMetrics.type, "1m"),
            ),
          )
          .all()
        expect(after).toHaveLength(0)
      }),
    )
  })

  it("runOnce does not delete recent 1m records within retention window", async () => {
    const systemId = "sys-ret-recent-01"
    const recentTs = Date.now() - 10 * 60 * 1000 // 10 min ago — within 1h retention

    await run(
      Effect.gen(function* () {
        const db = yield* Database
        const svc = yield* Retention

        db.insert(schema.systems)
          .values({
            id: systemId,
            hostname: systemId,
            status: "online",
            lastSeen: new Date(recentTs),
            createdAt: new Date(recentTs),
          })
          .run()

        const report = makeAgentReport({ systemId, timestamp: recentTs })
        db.insert(schema.systemMetrics)
          .values({
            systemId,
            timestamp: new Date(recentTs),
            type: "1m",
            data: report as unknown as Record<string, unknown>,
          })
          .run()

        yield* svc.runOnce()

        const remaining = db
          .select()
          .from(schema.systemMetrics)
          .where(
            and(
              eq(schema.systemMetrics.systemId, systemId),
              eq(schema.systemMetrics.type, "1m"),
            ),
          )
          .all()

        // Recent record should still be present
        expect(remaining).toHaveLength(1)
      }),
    )
  })

  it("averages are correct for known values", async () => {
    const systemId = "sys-ret-avg-01"

    await run(
      Effect.gen(function* () {
        const db = yield* Database
        const svc = yield* Retention

        db.insert(schema.systems)
          .values({
            id: systemId,
            hostname: systemId,
            status: "online",
            lastSeen: new Date(),
            createdAt: new Date(),
          })
          .run()

        // Insert 2 records with cpu.usage 20 and 80 → average should be 50
        const ts = Date.now() - 5 * 60_000
        for (const [i, usage] of [[0, 20] as const, [1, 80] as const]) {
          const report = makeAgentReport({
            systemId,
            timestamp: ts + i * 30_000,
            system: {
              cpu: {
                usage,
                cores: 4,
                perCore: [usage, usage, usage, usage],
                breakdown: { user: 10, system: 5, iowait: 2, steal: 0, idle: 83 },
              },
              memory: {
                used: 4_000_000_000,
                total: 8_000_000_000,
                available: 4_000_000_000,
                buffersCache: 500_000_000,
                swap: { used: 0, total: 2_000_000_000 },
              },
              disks: [
                {
                  mount: "/",
                  device: "/dev/sda1",
                  used: 50_000_000_000,
                  total: 100_000_000_000,
                  readBytesPerSec: 1024,
                  writeBytesPerSec: 2048,
                },
              ],
              loadAvg: [1.0, 1.5, 2.0],
              uptime: 86400,
            },
            network: [
              {
                name: "eth0",
                rxBytesPerSec: 1000,
                txBytesPerSec: 500,
                rxPacketsPerSec: 10,
                txPacketsPerSec: 5,
              },
            ],
          })
          db.insert(schema.systemMetrics)
            .values({
              systemId,
              timestamp: new Date(ts + i * 30_000),
              type: "1m",
              data: report as unknown as Record<string, unknown>,
            })
            .run()
        }

        yield* svc.runOnce()

        const rollups = db
          .select()
          .from(schema.systemMetrics)
          .where(
            and(
              eq(schema.systemMetrics.systemId, systemId),
              eq(schema.systemMetrics.type, "10m"),
            ),
          )
          .all()

        expect(rollups.length).toBeGreaterThanOrEqual(1)
        const avg = rollups[0].data as ReturnType<typeof makeAgentReport>
        expect(avg.system.cpu.usage).toBeCloseTo(50, 0)
      }),
    )
  })
})
