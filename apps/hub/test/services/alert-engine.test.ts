import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer } from "effect"
import * as Context from "effect/Context"
import type { Alert, SystemMetricsSample } from "@scout/shared"
import { AlertEngine, DEFAULT_ALERT_RULES } from "../../src/services/alert-engine.js"
import { alertMetricSamplesFromCoreMetrics } from "../../src/services/alert-metrics.js"
import { Database } from "../../src/services/database.js"
import { MetricsBroadcast } from "../../src/services/metrics-broadcast.js"
import { makeSystemMetricsSample } from "../helpers/fixtures.js"

const DDL = `
  CREATE TABLE IF NOT EXISTS alert_rules (
    id TEXT PRIMARY KEY,
    metric TEXT NOT NULL,
    operator TEXT NOT NULL CHECK(operator IN ('>','<','=','!=')),
    threshold REAL NOT NULL,
    consecutive_count INTEGER NOT NULL DEFAULT 3,
    severity TEXT NOT NULL CHECK(severity IN ('warning','critical')),
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL,
    system_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',
    severity TEXT NOT NULL,
    metric TEXT NOT NULL,
    value REAL NOT NULL,
    triggered_at INTEGER NOT NULL,
    acknowledged_at INTEGER,
    resolved_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS systems (
    id TEXT PRIMARY KEY,
    hostname TEXT NOT NULL,
    tailscale_ip TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    capabilities TEXT NOT NULL DEFAULT '{}',
    last_seen INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS system_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    system_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT '1m',
    data TEXT NOT NULL
  );
`

type RuleSpec = {
  id: string
  metric: string
  operator: ">" | "<" | "=" | "!="
  threshold: number
  consecutiveCount: number
  severity: "warning" | "critical"
  enabled: boolean
}

/**
 * With `rules`, the database holds exactly those rules plus every default rule
 * disabled, so only the given rules fire. `withDefaults` leaves the defaults
 * out of the fixture, so startup seeding adds them as it would on an existing hub.
 */
function makeTestLayer(rules?: RuleSpec[], { withDefaults = false } = {}) {
  const configLayer = ConfigProvider.layer(ConfigProvider.fromUnknown({ SCOUT_DB_PATH: ":memory:" }))

  const dbLayer = Database.layer.pipe(
    Layer.provide(configLayer),
    Layer.tap((ctx) =>
      Effect.sync(() => {
        const db = Context.get(ctx, Database)
        db.$client.exec(DDL)

        if (rules !== undefined) {
          const now = Date.now()
          const disabledDefaults = withDefaults
            ? []
            : DEFAULT_ALERT_RULES.map((rule) => ({
                id: rule.id,
                metric: rule.metric,
                operator: rule.operator as RuleSpec["operator"],
                threshold: rule.threshold,
                consecutiveCount: rule.consecutiveCount ?? 3,
                severity: rule.severity,
                enabled: false,
              }))
          for (const rule of [...disabledDefaults, ...rules]) {
            db.$client.exec(
              `INSERT OR REPLACE INTO alert_rules (id, metric, operator, threshold, consecutive_count, severity, enabled, created_at)
               VALUES ('${rule.id}', '${rule.metric}', '${rule.operator}', ${rule.threshold}, ${rule.consecutiveCount}, '${rule.severity}', ${rule.enabled ? 1 : 0}, ${now})`,
            )
          }
        }
      }),
    ),
  )

  return AlertEngine.layer.pipe(Layer.provide(Layer.merge(dbLayer, MetricsBroadcast.layer)))
}

function withEngine<A, E>(
  eff: Effect.Effect<A, E, AlertEngine>,
  rules?: RuleSpec[],
  opts?: { withDefaults?: boolean },
) {
  return eff.pipe(Effect.provide(makeTestLayer(rules, opts)))
}

const BASE_SAMPLE = makeSystemMetricsSample({
  timestamp: Date.now(),
  cpuPercent: 10,
  diskPercent: 10,
  gpuTemperatureCelsius: null,
  smartHealthFailing: false,
})

function withSample(overrides?: Partial<SystemMetricsSample>): SystemMetricsSample {
  return {
    ...BASE_SAMPLE,
    ...overrides,
  }
}

function evaluateSample(
  engine: {
    evaluate: (
      systemId: string,
      samples: ReadonlyArray<{ metric: string; value: number }>,
    ) => Effect.Effect<Alert[]>
  },
  sample: SystemMetricsSample,
) {
  return engine.evaluate("sys-1", alertMetricSamplesFromCoreMetrics(sample))
}

const CPU_RULE: RuleSpec = {
  id: "r-cpu",
  metric: "cpu.usage",
  operator: ">",
  threshold: 85,
  consecutiveCount: 3,
  severity: "warning",
  enabled: true,
}

const DISK_RULE: RuleSpec = {
  id: "r-disk",
  metric: "disk.percent",
  operator: ">",
  threshold: 90,
  consecutiveCount: 1,
  severity: "critical",
  enabled: true,
}

const MEM_RULE: RuleSpec = {
  id: "r-mem",
  metric: "memory.percent",
  operator: ">",
  threshold: 90,
  consecutiveCount: 3,
  severity: "critical",
  enabled: true,
}

const GPU_RULE: RuleSpec = {
  id: "r-gpu",
  metric: "gpu.temperature",
  operator: ">",
  threshold: 85,
  consecutiveCount: 3,
  severity: "warning",
  enabled: true,
}

const SMART_RULE: RuleSpec = {
  id: "r-smart",
  metric: "smart.health",
  operator: "=",
  threshold: 1,
  consecutiveCount: 1,
  severity: "critical",
  enabled: true,
}

describe("AlertEngine", () => {
  it.effect("3-strike: cpu>85 triggers alert on 3rd consecutive violation", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        const r1 = yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        expect(r1).toHaveLength(0)

        const r2 = yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        expect(r2).toHaveLength(0)

        const r3 = yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        expect(r3).toHaveLength(1)
        expect(r3[0]!.metric).toBe("cpu.usage")
        expect(r3[0]!.severity).toBe("warning")
        expect(r3[0]!.state).toBe("active")
      }),
      [CPU_RULE],
    ),
  )

  it.effect("recovery resets count: 2 violations then 1 normal → 3 more trigger", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        yield* evaluateSample(engine, withSample({ cpuPercent: 10 }))

        const r1 = yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        expect(r1).toHaveLength(0)
        const r2 = yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        expect(r2).toHaveLength(0)
        const r3 = yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        expect(r3).toHaveLength(1)
      }),
      [CPU_RULE],
    ),
  )

  it.effect("auto-resolve: trigger then 3 normal samples → alert resolved", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        const triggered = yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        expect(triggered).toHaveLength(1)

        yield* evaluateSample(engine, withSample({ cpuPercent: 10 }))
        yield* evaluateSample(engine, withSample({ cpuPercent: 10 }))
        yield* evaluateSample(engine, withSample({ cpuPercent: 10 }))

        const active = yield* engine.getActive
        expect(active.filter((alert: Alert) => alert.metric === "cpu.usage")).toHaveLength(0)
      }),
      [CPU_RULE],
    ),
  )

  it.effect("disk rule (consecutive=1) fires immediately; cpu needs 3", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine
        const sample = withSample({ cpuPercent: 90, diskPercent: 95 })
        const alerts = yield* evaluateSample(engine, sample)

        expect(alerts.map((alert: Alert) => alert.metric)).toContain("disk.percent")
        expect(alerts.map((alert: Alert) => alert.metric)).not.toContain("cpu.usage")
      }),
      [CPU_RULE, DISK_RULE],
    ),
  )

  it.effect("acknowledge: triggered alert → state becomes acknowledged", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        const triggered = yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        const alertId = triggered[0]!.id

        yield* engine.acknowledge(alertId)

        const active = yield* engine.getActive
        const alert = active.find((candidate: Alert) => candidate.id === alertId)
        expect(alert?.state).toBe("acknowledged")
      }),
      [CPU_RULE],
    ),
  )

  it.effect("manual resolve: triggered alert → state becomes resolved", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        const triggered = yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        const alertId = triggered[0]!.id

        yield* engine.resolve(alertId)

        const active = yield* engine.getActive
        expect(active.find((candidate: Alert) => candidate.id === alertId)).toBeUndefined()

        const recent = yield* engine.getRecent(1)
        const resolved = recent.find((candidate: Alert) => candidate.id === alertId)
        expect(resolved?.state).toBe("resolved")
      }),
      [CPU_RULE],
    ),
  )

  it.effect("gpu.temperature: 90°C triggers after 3 consecutive samples", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        yield* evaluateSample(engine, withSample({ gpuTemperatureCelsius: 90 }))
        yield* evaluateSample(engine, withSample({ gpuTemperatureCelsius: 90 }))
        const alerts = yield* evaluateSample(engine, withSample({ gpuTemperatureCelsius: 90 }))

        expect(alerts).toHaveLength(1)
        expect(alerts[0]!.metric).toBe("gpu.temperature")
      }),
      [GPU_RULE],
    ),
  )

  it.effect("smart.health: FAILED triggers immediately", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        const alerts = yield* evaluateSample(engine, withSample({ smartHealthFailing: true }))
        expect(alerts).toHaveLength(1)
        expect(alerts[0]!.metric).toBe("smart.health")
        expect(alerts[0]!.severity).toBe("critical")
      }),
      [SMART_RULE],
    ),
  )

  it.effect("memory.percent: 95% used triggers after 3 violations", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        yield* evaluateSample(engine, withSample({ memoryPercent: 95 }))
        yield* evaluateSample(engine, withSample({ memoryPercent: 95 }))
        const alerts = yield* evaluateSample(engine, withSample({ memoryPercent: 95 }))
        expect(alerts).toHaveLength(1)
        expect(alerts[0]!.metric).toBe("memory.percent")
      }),
      [MEM_RULE],
    ),
  )

  it.effect("smart.health: healthy sample does not trigger", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        const alerts = yield* evaluateSample(engine, withSample({ smartHealthFailing: false }))
        expect(alerts).toHaveLength(0)
      }),
      [SMART_RULE],
    ),
  )

  it.effect("no duplicate: active alert blocks duplicate trigger", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        const first = yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        expect(first).toHaveLength(1)

        yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        const second = yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        expect(second).toHaveLength(0)
      }),
      [CPU_RULE],
    ),
  )

  it.effect("default rules are seeded when no rules provided", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        const alerts = yield* evaluateSample(engine, withSample({ cpuPercent: 90 }))
        expect(alerts).toHaveLength(1)
        expect(alerts[0]!.metric).toBe("cpu.usage")
      }),
    ),
  )

  it.effect("adds missing default rules to a database that already has rules", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine
        const failed = [
          { metric: "systemd.units.failed", value: 1 },
          { metric: "systemd.user-units.failed", value: 2 },
        ]

        const first = yield* engine.evaluate("sys-1", failed)
        expect(first).toHaveLength(0)
        const second = yield* engine.evaluate("sys-1", failed)
        expect(second.map((alert) => [alert.ruleId, alert.severity, alert.value])).toEqual([
          ["default-systemd-failed-units", "critical", 1],
          ["default-systemd-failed-user-units", "warning", 2],
        ])
      }),
      [CPU_RULE],
      { withDefaults: true },
    ),
  )

  it.effect("leaves a disabled default rule disabled", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine
        const failed = [{ metric: "systemd.user-units.failed", value: 1 }]

        yield* engine.evaluate("sys-1", failed)
        yield* engine.evaluate("sys-1", failed)
        const third = yield* engine.evaluate("sys-1", failed)
        expect(third).toHaveLength(0)
      }),
      [
        {
          id: "default-systemd-failed-user-units",
          metric: "systemd.user-units.failed",
          operator: ">",
          threshold: 0,
          consecutiveCount: 2,
          severity: "warning",
          enabled: false,
        },
      ],
      { withDefaults: true },
    ),
  )
})
