import { Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import { and, eq, gte, desc } from "drizzle-orm"
import type { AgentReport } from "@scout/shared"
import { decodeAgentReport } from "@scout/shared"
import { Database } from "./database.js"
import * as schema from "../../drizzle/schema.js"
import { SchemaValidationError } from "../lib/errors.js"

// Receives AgentReport payloads from connected agents, validates them,
// persists them to the database, and fans out to MetricsBroadcast.

export class MetricsIngestion extends ServiceMap.Service<MetricsIngestion, {
  /**
   * Ingest a validated AgentReport. Persists to DB and broadcasts to
   * subscribers. Returns the stored record timestamp (ms).
   */
  readonly ingest: (report: AgentReport) => Effect.Effect<number>
  /**
   * Ingest raw unknown data — parses with AgentReportSchema first.
   * Returns a SchemaValidationError if the payload is malformed.
   */
  readonly ingestRaw: (raw: unknown) => Effect.Effect<number, SchemaValidationError>
  /**
   * Query system_metrics for a given system over the last N hours.
   * Optional type filter (defaults to "1m").
   */
  readonly querySystemMetrics: (
    systemId: string,
    hours: number,
    type?: typeof schema.systemMetrics.$inferSelect["type"],
  ) => Effect.Effect<Array<typeof schema.systemMetrics.$inferSelect>>
  /**
   * Get the most recent "1m" record for a system and parse it back to AgentReport.
   */
  readonly queryLatest: (systemId: string) => Effect.Effect<AgentReport | null>
}>()(
  "@scout/MetricsIngestion",
  {
    make: Effect.gen(function* () {
      const db = yield* Database

      const ingest = (report: AgentReport): Effect.Effect<number> =>
        Effect.sync(() => {
          const now = new Date(report.timestamp)

          // Upsert the system row
          db.insert(schema.systems)
            .values({
              id: report.systemId,
              hostname: report.systemId,
              status: "online",
              lastSeen: now,
              createdAt: now,
            })
            .onConflictDoUpdate({
              target: schema.systems.id,
              set: {
                status: "online",
                lastSeen: now,
              },
            })
            .run()

          // Insert the metric record
          db.insert(schema.systemMetrics)
            .values({
              systemId: report.systemId,
              timestamp: now,
              type: "1m",
              data: report as unknown as Record<string, unknown>,
            })
            .run()

          return report.timestamp
        })

      const ingestRaw = (raw: unknown): Effect.Effect<number, SchemaValidationError> =>
        decodeAgentReport(raw).pipe(
          Effect.mapError(
            (e) =>
              new SchemaValidationError({
                message: "Invalid AgentReport payload",
                errors: e,
              }),
          ),
          Effect.flatMap(ingest),
        )

      const querySystemMetrics = (
        systemId: string,
        hours: number,
        type: typeof schema.systemMetrics.$inferSelect["type"] = "1m",
      ): Effect.Effect<Array<typeof schema.systemMetrics.$inferSelect>> =>
        Effect.sync(() => {
          const since = new Date(Date.now() - hours * 60 * 60 * 1000)
          return db
            .select()
            .from(schema.systemMetrics)
            .where(
              and(
                eq(schema.systemMetrics.systemId, systemId),
                eq(schema.systemMetrics.type, type),
                gte(schema.systemMetrics.timestamp, since),
              ),
            )
            .orderBy(schema.systemMetrics.timestamp)
            .all()
        })

      const queryLatest = (systemId: string): Effect.Effect<AgentReport | null> =>
        Effect.sync(() => {
          const row = db
            .select()
            .from(schema.systemMetrics)
            .where(
              and(
                eq(schema.systemMetrics.systemId, systemId),
                eq(schema.systemMetrics.type, "1m"),
              ),
            )
            .orderBy(desc(schema.systemMetrics.timestamp))
            .limit(1)
            .all()

          if (row.length === 0) return null
          return row[0].data as unknown as AgentReport
        })

      return { ingest, ingestRaw, querySystemMetrics, queryLatest }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
