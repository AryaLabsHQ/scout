import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, ConfigProvider } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import type { AgentReport, Alert } from "@scout/shared"
import { AlertEngine } from "../../src/services/alert-engine.js"
import { Database } from "../../src/services/database.js"
import { MetricsBroadcast } from "../../src/services/metrics-broadcast.js"

// ---------------------------------------------------------------------------
// Test layer — in-memory SQLite, custom rules
// ---------------------------------------------------------------------------

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
 * Build a fresh AlertEngine layer backed by an isolated in-memory SQLite.
 * Pass `rules` to seed custom rules (sentinel prevents default seeding).
 */
function makeTestLayer(rules?: RuleSpec[]) {
  const configLayer = ConfigProvider.layer(
    ConfigProvider.fromUnknown({ SCOUT_DB_PATH: ":memory:" }),
  )

  const dbLayer = Database.layer.pipe(
    Layer.provide(configLayer),
    // After the DB is initialised, create the tables and optionally seed rules
    Layer.tap((ctx) =>
      Effect.sync(() => {
        const db = ServiceMap.get(ctx, Database)
        db.$client.exec(DDL)

        if (rules !== undefined) {
          const now = Date.now()
          // Insert a sentinel so AlertEngine's "is table empty?" check skips default seeding
          db.$client.exec(
            `INSERT OR IGNORE INTO alert_rules (id, metric, operator, threshold, consecutive_count, severity, enabled, created_at)
             VALUES ('__sentinel__', 'cpu.usage', '>', 999, 99, 'warning', 0, ${now})`,
          )
          for (const rule of rules) {
            db.$client.exec(
              `INSERT OR REPLACE INTO alert_rules (id, metric, operator, threshold, consecutive_count, severity, enabled, created_at)
               VALUES ('${rule.id}', '${rule.metric}', '${rule.operator}', ${rule.threshold}, ${rule.consecutiveCount}, '${rule.severity}', ${rule.enabled ? 1 : 0}, ${now})`,
            )
          }
        }
        // If rules is undefined → let AlertEngine seed defaults; tables are already created
      }),
    ),
  )

  const broadcastLayer = MetricsBroadcast.layer
  const alertLayer = AlertEngine.layer.pipe(
    Layer.provide(Layer.merge(dbLayer, broadcastLayer)),
  )

  return alertLayer
}

/** Run an effect with a fresh test AlertEngine. */
function withEngine<A, E>(
  eff: Effect.Effect<A, E, AlertEngine>,
  rules?: RuleSpec[],
) {
  return eff.pipe(Effect.provide(makeTestLayer(rules)))
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_REPORT: AgentReport = {
  systemId: "sys-1",
  timestamp: Date.now(),
  system: {
    cpu: { usage: 10, cores: 4, perCore: [10, 10, 10, 10], breakdown: { user: 5, system: 5, iowait: 0, steal: 0, idle: 90 } },
    memory: { used: 1024, total: 8192, available: 7168, buffersCache: 512, swap: { used: 0, total: 2048 } },
    disks: [{ mount: "/", device: "/dev/sda1", used: 10, total: 100, readBytesPerSec: 0, writeBytesPerSec: 0 }],
    loadAvg: [0.1, 0.2, 0.3],
    uptime: 3600,
  },
  network: [],
}

const r = (overrides: Partial<AgentReport> & { system?: Partial<AgentReport["system"]> }): AgentReport => ({
  ...BASE_REPORT,
  ...overrides,
  system: { ...BASE_REPORT.system, ...overrides.system },
})

function withCpu(cpu: number): AgentReport {
  return r({ system: { cpu: { ...BASE_REPORT.system.cpu, usage: cpu } } })
}

function withMemory(usedPct: number): AgentReport {
  const total = 8192
  return r({ system: { memory: { ...BASE_REPORT.system.memory, used: (usedPct / 100) * total, total } } })
}

function withDisk(usedPct: number): AgentReport {
  return r({ system: { disks: [{ mount: "/", device: "/dev/sda1", used: usedPct, total: 100, readBytesPerSec: 0, writeBytesPerSec: 0 }] } })
}

function withGpu(temp: number): AgentReport {
  return { ...BASE_REPORT, gpu: [{ name: "GPU0", index: 0, usage: 50, memUsed: 1024, memTotal: 4096, temperature: temp, powerWatts: 150 }] }
}

function withSmartFailed(): AgentReport {
  return { ...BASE_REPORT, smart: [{ device: "/dev/sda", model: "WD", serial: "123", health: "FAILED", temperature: 50, powerOnHours: 1000, reallocatedSectors: 5 }] }
}

function withSmartPassed(): AgentReport {
  return { ...BASE_REPORT, smart: [{ device: "/dev/sda", model: "WD", serial: "123", health: "PASSED", temperature: 40, powerOnHours: 1000, reallocatedSectors: 0 }] }
}

function withPodRestarts(count: number): AgentReport {
  return {
    ...BASE_REPORT,
    k8s: {
      pods: [{ name: "pod-1", namespace: "default", nodeName: "node-1", phase: "Running" as const, restarts: count, containers: [], cpuMillicores: null, memBytes: null, age: 3600 }],
      deployments: [], services: [], ingresses: [], jobs: [], nodes: [],
    },
  }
}

// ---------------------------------------------------------------------------
// Rule presets
// ---------------------------------------------------------------------------

const CPU_RULE: RuleSpec  = { id: "r-cpu",   metric: "cpu.usage",       operator: ">", threshold: 85, consecutiveCount: 3, severity: "warning",  enabled: true }
const DISK_RULE: RuleSpec = { id: "r-disk",  metric: "disk.percent",    operator: ">", threshold: 90, consecutiveCount: 1, severity: "critical", enabled: true }
const MEM_RULE: RuleSpec  = { id: "r-mem",   metric: "memory.percent",  operator: ">", threshold: 90, consecutiveCount: 3, severity: "critical", enabled: true }
const GPU_RULE: RuleSpec  = { id: "r-gpu",   metric: "gpu.temperature", operator: ">", threshold: 85, consecutiveCount: 3, severity: "warning",  enabled: true }
const SMART_RULE: RuleSpec = { id: "r-smart",metric: "smart.health",    operator: "=", threshold: 1,  consecutiveCount: 1, severity: "critical", enabled: true }
const POD_RULE: RuleSpec  = { id: "r-pod",   metric: "pod.restarts",    operator: ">", threshold: 2,  consecutiveCount: 1, severity: "warning",  enabled: true }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AlertEngine", () => {
  // ── 1. 3-strike trigger ──────────────────────────────────────────────────

  it.effect("3-strike: cpu>85 triggers alert on 3rd consecutive violation", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        const r1 = yield* engine.evaluate("sys-1", withCpu(90))
        expect(r1).toHaveLength(0) // 1st strike

        const r2 = yield* engine.evaluate("sys-1", withCpu(90))
        expect(r2).toHaveLength(0) // 2nd strike

        const r3 = yield* engine.evaluate("sys-1", withCpu(90))
        expect(r3).toHaveLength(1) // 3rd strike → trigger
        expect(r3[0]!.metric).toBe("cpu.usage")
        expect(r3[0]!.severity).toBe("warning")
        expect(r3[0]!.state).toBe("active")
      }),
      [CPU_RULE],
    ),
  )

  // ── 2. Recovery resets count ─────────────────────────────────────────────

  it.effect("recovery resets count: 2 violations then 1 normal → 3 more trigger", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        yield* engine.evaluate("sys-1", withCpu(90))
        yield* engine.evaluate("sys-1", withCpu(90))
        yield* engine.evaluate("sys-1", withCpu(10)) // recovery resets count

        const r1 = yield* engine.evaluate("sys-1", withCpu(90))
        expect(r1).toHaveLength(0)
        const r2 = yield* engine.evaluate("sys-1", withCpu(90))
        expect(r2).toHaveLength(0)
        const r3 = yield* engine.evaluate("sys-1", withCpu(90))
        expect(r3).toHaveLength(1)
      }),
      [CPU_RULE],
    ),
  )

  // ── 3. Auto-resolve ───────────────────────────────────────────────────────

  it.effect("auto-resolve: trigger then 3 normal reports → alert resolved", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        yield* engine.evaluate("sys-1", withCpu(90))
        yield* engine.evaluate("sys-1", withCpu(90))
        const triggered = yield* engine.evaluate("sys-1", withCpu(90))
        expect(triggered).toHaveLength(1)

        yield* engine.evaluate("sys-1", withCpu(10))
        yield* engine.evaluate("sys-1", withCpu(10))
        yield* engine.evaluate("sys-1", withCpu(10))

        const active = yield* engine.getActive
        expect(active.filter((a: Alert) => a.metric === "cpu.usage")).toHaveLength(0)
      }),
      [CPU_RULE],
    ),
  )

  // ── 4. Different rules: disk (1) vs cpu (3) ───────────────────────────────

  it.effect("disk rule (consecutive=1) fires immediately; cpu needs 3", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        const report = { ...withDisk(95), system: { ...withDisk(95).system, cpu: { ...BASE_REPORT.system.cpu, usage: 90 } } }
        const r1 = yield* engine.evaluate("sys-1", report)

        expect(r1.map((a: Alert) => a.metric)).toContain("disk.percent")
        expect(r1.map((a: Alert) => a.metric)).not.toContain("cpu.usage")
      }),
      [CPU_RULE, DISK_RULE],
    ),
  )

  // ── 5. Acknowledge ────────────────────────────────────────────────────────

  it.effect("acknowledge: triggered alert → state becomes acknowledged", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        yield* engine.evaluate("sys-1", withCpu(90))
        yield* engine.evaluate("sys-1", withCpu(90))
        const triggered = yield* engine.evaluate("sys-1", withCpu(90))
        const alertId = triggered[0]!.id

        yield* engine.acknowledge(alertId)

        const active = yield* engine.getActive
        const alert = active.find((a: Alert) => a.id === alertId)
        expect(alert?.state).toBe("acknowledged")
      }),
      [CPU_RULE],
    ),
  )

  // ── 6. Manual resolve ─────────────────────────────────────────────────────

  it.effect("manual resolve: triggered alert → state becomes resolved", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        yield* engine.evaluate("sys-1", withCpu(90))
        yield* engine.evaluate("sys-1", withCpu(90))
        const triggered = yield* engine.evaluate("sys-1", withCpu(90))
        const alertId = triggered[0]!.id

        yield* engine.resolve(alertId)

        const active = yield* engine.getActive
        expect(active.find((a: Alert) => a.id === alertId)).toBeUndefined()

        const recent = yield* engine.getRecent(1)
        const resolved = recent.find((a: Alert) => a.id === alertId)
        expect(resolved?.state).toBe("resolved")
      }),
      [CPU_RULE],
    ),
  )

  // ── 7. GPU temperature ────────────────────────────────────────────────────

  it.effect("gpu.temperature: 90°C triggers after 3 consecutive reports", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        yield* engine.evaluate("sys-1", withGpu(90))
        yield* engine.evaluate("sys-1", withGpu(90))
        const r3 = yield* engine.evaluate("sys-1", withGpu(90))

        expect(r3).toHaveLength(1)
        expect(r3[0]!.metric).toBe("gpu.temperature")
      }),
      [GPU_RULE],
    ),
  )

  // ── 8. SMART failure ──────────────────────────────────────────────────────

  it.effect("smart.health: FAILED triggers immediately (consecutiveCount=1)", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        const r1 = yield* engine.evaluate("sys-1", withSmartFailed())
        expect(r1).toHaveLength(1)
        expect(r1[0]!.metric).toBe("smart.health")
        expect(r1[0]!.severity).toBe("critical")
      }),
      [SMART_RULE],
    ),
  )

  // ── 9. No k8s data → pod.restarts rule skipped ───────────────────────────

  it.effect("no k8s data: pod.restarts rule is skipped (returns null metric)", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        const r1 = yield* engine.evaluate("sys-1", BASE_REPORT)
        expect(r1).toHaveLength(0)
      }),
      [POD_RULE],
    ),
  )

  // ── 10. Pod restarts fires when data present ──────────────────────────────

  it.effect("pod.restarts: >2 with k8s data triggers immediately", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        const r1 = yield* engine.evaluate("sys-1", withPodRestarts(5))
        expect(r1).toHaveLength(1)
        expect(r1[0]!.metric).toBe("pod.restarts")
      }),
      [POD_RULE],
    ),
  )

  // ── 11. No duplicate active alerts ───────────────────────────────────────

  it.effect("no duplicate: 2nd trigger streak does not create 2nd alert while 1st is active", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        yield* engine.evaluate("sys-1", withCpu(90))
        yield* engine.evaluate("sys-1", withCpu(90))
        const first = yield* engine.evaluate("sys-1", withCpu(90))
        expect(first).toHaveLength(1)

        // Another 3 violations — existing active alert blocks new one
        yield* engine.evaluate("sys-1", withCpu(90))
        yield* engine.evaluate("sys-1", withCpu(90))
        const second = yield* engine.evaluate("sys-1", withCpu(90))
        expect(second).toHaveLength(0)
      }),
      [CPU_RULE],
    ),
  )

  // ── 12. Memory percent calculation ───────────────────────────────────────

  it.effect("memory.percent: 95% used triggers after 3 violations", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        yield* engine.evaluate("sys-1", withMemory(95))
        yield* engine.evaluate("sys-1", withMemory(95))
        const r3 = yield* engine.evaluate("sys-1", withMemory(95))
        expect(r3).toHaveLength(1)
        expect(r3[0]!.metric).toBe("memory.percent")
      }),
      [MEM_RULE],
    ),
  )

  // ── 13. SMART passed → no alert ──────────────────────────────────────────

  it.effect("smart.health: PASSED does not trigger", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine

        const r1 = yield* engine.evaluate("sys-1", withSmartPassed())
        expect(r1).toHaveLength(0)
      }),
      [SMART_RULE],
    ),
  )

  // ── 14. Default rules are seeded when table is empty ─────────────────────

  it.effect("default rules are seeded when no rules provided", () =>
    withEngine(
      Effect.gen(function* () {
        const engine = yield* AlertEngine
        // After init, trigger with cpu=90 3 times — default CPU rule should fire
        yield* engine.evaluate("sys-1", withCpu(90))
        yield* engine.evaluate("sys-1", withCpu(90))
        const r3 = yield* engine.evaluate("sys-1", withCpu(90))
        expect(r3).toHaveLength(1)
        expect(r3[0]!.metric).toBe("cpu.usage")
      }),
      // No rules param → trigger default seeding
    ),
  )
})
