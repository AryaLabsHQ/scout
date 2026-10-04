import { Effect, Layer, Ref } from "effect"
import * as Context from "effect/Context"
import { eq, or, gte, desc, and } from "drizzle-orm"
import type { Alert, AlertRule } from "@scout/shared"
import { Database } from "./database.js"
import { MetricsBroadcast } from "./metrics-broadcast.js"
import type { AlertMetricSample } from "./alert-metrics.js"
import * as schema from "../../drizzle/schema.js"

// ── Default seed rules ────────────────────────────────────────────────────────

const DEFAULT_RULES: Omit<typeof schema.alertRules.$inferInsert, "createdAt">[] = [
  {
    id: "default-cpu-usage",
    metric: "cpu.usage",
    operator: ">",
    threshold: 85,
    consecutiveCount: 3,
    severity: "warning",
    enabled: true,
  },
  {
    id: "default-memory-percent",
    metric: "memory.percent",
    operator: ">",
    threshold: 90,
    consecutiveCount: 3,
    severity: "critical",
    enabled: true,
  },
  {
    id: "default-disk-percent",
    metric: "disk.percent",
    operator: ">",
    threshold: 90,
    consecutiveCount: 1,
    severity: "critical",
    enabled: true,
  },
  {
    id: "default-gpu-temperature",
    metric: "gpu.temperature",
    operator: ">",
    threshold: 85,
    consecutiveCount: 3,
    severity: "warning",
    enabled: true,
  },
  {
    id: "default-smart-health",
    metric: "smart.health",
    operator: "=",
    threshold: 1,
    consecutiveCount: 1,
    severity: "critical",
    enabled: true,
  },
]

// ── Operator comparison ───────────────────────────────────────────────────────

function compare(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case ">":
      return value > threshold
    case "<":
      return value < threshold
    case "=":
      return value === threshold
    case "!=":
      return value !== threshold
    default:
      return false
  }
}

// ── Row → Alert mapping ───────────────────────────────────────────────────────

function rowToAlert(row: typeof schema.alerts.$inferSelect): Alert {
  return {
    id: row.id,
    ruleId: row.ruleId,
    systemId: row.systemId,
    state: row.state,
    severity: row.severity,
    metric: row.metric,
    value: row.value,
    triggeredAt: row.triggeredAt.getTime(),
    acknowledgedAt: row.acknowledgedAt?.getTime() ?? null,
    resolvedAt: row.resolvedAt?.getTime() ?? null,
  }
}

function rowToRule(row: typeof schema.alertRules.$inferSelect): AlertRule {
  return {
    id: row.id,
    metric: row.metric,
    operator: row.operator,
    threshold: row.threshold,
    consecutiveCount: row.consecutiveCount,
    severity: row.severity,
    enabled: row.enabled,
    createdAt: row.createdAt.getTime(),
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export class AlertEngine extends Context.Service<
  AlertEngine,
  {
    readonly _tag: "@scout/AlertEngine"
    /**
     * Evaluate all enabled rules against normalized metric samples.
     * Returns the list of newly triggered alerts.
     */
    readonly evaluate: (systemId: string, samples: ReadonlyArray<AlertMetricSample>) => Effect.Effect<Alert[]>
    /** All active + acknowledged alerts. */
    readonly getActive: Effect.Effect<Alert[]>
    /** Alerts from the last N hours (resolved included). */
    readonly getRecent: (hours: number) => Effect.Effect<Alert[]>
    /** Acknowledge an alert by ID. */
    readonly acknowledge: (alertId: string) => Effect.Effect<void>
    /** Resolve an alert by ID. */
    readonly resolve: (alertId: string) => Effect.Effect<void>
  }
>()("@scout/AlertEngine", {
  make: Effect.gen(function* () {
    const db = yield* Database
    const broadcast = yield* MetricsBroadcast

    // violationCounts[`${ruleId}:${systemId}`] = consecutive violation count
    const violationCounts = yield* Ref.make(new Map<string, number>())
    // recoveryCounts[`${ruleId}:${systemId}`]  = consecutive recovery count
    const recoveryCounts = yield* Ref.make(new Map<string, number>())

    // ── Seed default rules ─────────────────────────────────────────────────
    yield* Effect.sync(() => {
      const existing = db.select().from(schema.alertRules).limit(1).all()
      if (existing.length === 0) {
        const now = new Date()
        for (const rule of DEFAULT_RULES) {
          db.insert(schema.alertRules)
            .values({ ...rule, createdAt: now })
            .onConflictDoNothing()
            .run()
        }
      }
    })

    // ── evaluate ───────────────────────────────────────────────────────────
    const evaluate = (systemId: string, samples: ReadonlyArray<AlertMetricSample>): Effect.Effect<Alert[]> =>
      Effect.gen(function* () {
        // Load enabled rules
        const ruleRows = yield* Effect.sync(() =>
          db.select().from(schema.alertRules).where(eq(schema.alertRules.enabled, true)).all(),
        )
        const rules = ruleRows.map(rowToRule)
        const metricValues = new Map(samples.map((sample) => [sample.metric, sample.value]))

        const triggered: Alert[] = []

        for (const rule of rules) {
          const key = `${rule.id}:${systemId}`
          const value = metricValues.get(rule.metric) ?? null

          // Skip if metric is not available in the normalized sample set.
          if (value === null) continue

          const violated = compare(value, rule.operator, rule.threshold)

          if (violated) {
            // Increment violation count, reset recovery count
            yield* Ref.update(violationCounts, (m) => {
              const next = new Map(m)
              next.set(key, (next.get(key) ?? 0) + 1)
              return next
            })
            yield* Ref.update(recoveryCounts, (m) => {
              const next = new Map(m)
              next.set(key, 0)
              return next
            })

            const vCount = yield* Ref.get(violationCounts).pipe(Effect.map((m) => m.get(key) ?? 0))

            if (vCount >= rule.consecutiveCount) {
              // Check if there's already an active alert for this rule+system
              const existing = yield* Effect.sync(() =>
                db
                  .select()
                  .from(schema.alerts)
                  .where(
                    and(
                      eq(schema.alerts.ruleId, rule.id),
                      eq(schema.alerts.systemId, systemId),
                      or(eq(schema.alerts.state, "active"), eq(schema.alerts.state, "acknowledged")),
                    ),
                  )
                  .limit(1)
                  .all(),
              )

              if (existing.length === 0) {
                // Insert new alert
                const alertId = crypto.randomUUID()
                const now = new Date()
                yield* Effect.sync(() => {
                  db.insert(schema.alerts)
                    .values({
                      id: alertId,
                      ruleId: rule.id,
                      systemId,
                      state: "active",
                      severity: rule.severity,
                      metric: rule.metric,
                      value,
                      triggeredAt: now,
                    })
                    .run()
                })

                const alert: Alert = {
                  id: alertId,
                  ruleId: rule.id,
                  systemId,
                  state: "active",
                  severity: rule.severity,
                  metric: rule.metric,
                  value,
                  triggeredAt: now.getTime(),
                  acknowledgedAt: null,
                  resolvedAt: null,
                }

                // Publish immediately — bypasses coalescing
                yield* broadcast.publishAlert(alert)
                triggered.push(alert)
              }

              // Reset violation count so re-trigger requires another N-strike streak
              yield* Ref.update(violationCounts, (m) => {
                const next = new Map(m)
                next.set(key, 0)
                return next
              })
            }
          } else {
            // Not violated — increment recovery count, reset violation count
            yield* Ref.update(recoveryCounts, (m) => {
              const next = new Map(m)
              next.set(key, (next.get(key) ?? 0) + 1)
              return next
            })
            yield* Ref.update(violationCounts, (m) => {
              const next = new Map(m)
              next.set(key, 0)
              return next
            })

            const rCount = yield* Ref.get(recoveryCounts).pipe(Effect.map((m) => m.get(key) ?? 0))

            if (rCount >= rule.consecutiveCount) {
              // Auto-resolve any active alert for this rule+system
              const activeRows = yield* Effect.sync(() =>
                db
                  .select()
                  .from(schema.alerts)
                  .where(
                    and(
                      eq(schema.alerts.ruleId, rule.id),
                      eq(schema.alerts.systemId, systemId),
                      or(eq(schema.alerts.state, "active"), eq(schema.alerts.state, "acknowledged")),
                    ),
                  )
                  .all(),
              )

              if (activeRows.length > 0) {
                const now = new Date()
                yield* Effect.sync(() => {
                  for (const row of activeRows) {
                    db.update(schema.alerts)
                      .set({ state: "resolved", resolvedAt: now })
                      .where(eq(schema.alerts.id, row.id))
                      .run()
                  }
                })

                // Publish resolved event for each alert
                for (const row of activeRows) {
                  const resolvedAlert: Alert = {
                    ...rowToAlert(row),
                    state: "resolved",
                    resolvedAt: now.getTime(),
                  }
                  yield* broadcast.publishAlertResolved(resolvedAlert)
                  yield* Effect.logInfo("Alert resolved").pipe(
                    Effect.annotateLogs({
                      alertId: row.id,
                      metric: row.metric,
                      systemId,
                    }),
                  )
                }
              }

              // Reset recovery count
              yield* Ref.update(recoveryCounts, (m) => {
                const next = new Map(m)
                next.set(key, 0)
                return next
              })
            }
          }
        }

        return triggered
      })

    // ── getActive ──────────────────────────────────────────────────────────
    const getActive: Effect.Effect<Alert[]> = Effect.sync(() => {
      const rows = db
        .select()
        .from(schema.alerts)
        .where(or(eq(schema.alerts.state, "active"), eq(schema.alerts.state, "acknowledged")))
        .orderBy(desc(schema.alerts.triggeredAt))
        .all()
      return rows.map(rowToAlert)
    })

    // ── getRecent ──────────────────────────────────────────────────────────
    const getRecent = (hours: number): Effect.Effect<Alert[]> =>
      Effect.sync(() => {
        const since = new Date(Date.now() - hours * 60 * 60 * 1000)
        const rows = db
          .select()
          .from(schema.alerts)
          .where(
            or(
              eq(schema.alerts.state, "active"),
              eq(schema.alerts.state, "acknowledged"),
              gte(schema.alerts.triggeredAt, since),
            ),
          )
          .orderBy(desc(schema.alerts.triggeredAt))
          .all()
        return rows.map(rowToAlert)
      })

    // ── acknowledge ────────────────────────────────────────────────────────
    const acknowledge = (alertId: string): Effect.Effect<void> =>
      Effect.sync(() => {
        db.update(schema.alerts)
          .set({ state: "acknowledged", acknowledgedAt: new Date() })
          .where(eq(schema.alerts.id, alertId))
          .run()
      })

    // ── resolve ────────────────────────────────────────────────────────────
    const resolve = (alertId: string): Effect.Effect<void> =>
      Effect.sync(() => {
        db.update(schema.alerts)
          .set({ state: "resolved", resolvedAt: new Date() })
          .where(eq(schema.alerts.id, alertId))
          .run()
      })

    return {
      _tag: "@scout/AlertEngine" as const,
      evaluate,
      getActive,
      getRecent,
      acknowledge,
      resolve,
    }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
