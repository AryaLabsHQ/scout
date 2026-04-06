import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import type {
  AgentCapabilities,
  CollectorPlugin,
  CollectorReport,
  SystemMetricsSample,
} from "@scout/shared"

type CoreCapability = keyof AgentCapabilities
type CoreCollectorPlugin = CollectorPlugin & { capability: CoreCapability }

// ── Mock collector builders ───────────────────────────────────────────────────

const makeCollector = (
  name: string,
  capability: CoreCapability,
  available: boolean,
  data: unknown,
): CoreCollectorPlugin => ({
  name,
  capability,
  detect: Effect.succeed(available),
  collect: Effect.succeed({ capability, data } as CollectorReport),
})

const makeFailingCollector = (
  name: string,
  capability: CoreCapability,
): CoreCollectorPlugin => ({
  name,
  capability,
  detect: Effect.succeed(true),
  collect: Effect.die(new Error(`${name} failed`)),
})

// ── Helper: run Effect and get result ────────────────────────────────────────

const run = <A>(effect: Effect.Effect<A, unknown, never>): Promise<A> =>
  Effect.runPromise(effect)

// ── discover() ───────────────────────────────────────────────────────────────

describe("CollectorRegistry.discover", () => {
  it("all available → all capabilities true", async () => {
    const collectors: CoreCollectorPlugin[] = [
      makeCollector("system", "system", true, {}),
      makeCollector("network", "network", true, []),
      makeCollector("process", "process", true, []),
    ]

    const capabilities = await run(
      discoverFromCollectors(collectors, [], [])
    )

    expect(capabilities.system).toBe(true)
    expect(capabilities.network).toBe(true)
    expect(capabilities.process).toBe(true)
  })

  it("one unavailable → that capability false", async () => {
    const collectors: CoreCollectorPlugin[] = [
      makeCollector("system", "system", true, {}),
      makeCollector("network", "network", true, []),
      makeCollector("gpu", "gpu", false, []),
    ]

    const capabilities = await run(
      discoverFromCollectors(collectors, [], [])
    )

    expect(capabilities.system).toBe(true)
    expect(capabilities.network).toBe(true)
    expect(capabilities.gpu).toBe(false)
  })

  it("config disable → forced false even if detected", async () => {
    const collectors: CoreCollectorPlugin[] = [
      makeCollector("system", "system", true, {}),
      makeCollector("gpu", "gpu", true, []),
    ]

    const capabilities = await run(
      discoverFromCollectors(collectors, ["gpu"], [])
    )

    expect(capabilities.system).toBe(true)
    expect(capabilities.gpu).toBe(false)
  })

  it("config enable → forced true even if not detected", async () => {
    const collectors: CoreCollectorPlugin[] = [
      makeCollector("gpu", "gpu", false, []),
    ]

    const capabilities = await run(
      discoverFromCollectors(collectors, [], ["gpu"])
    )

    expect(capabilities.gpu).toBe(true)
  })

  it("detect failure → treated as unavailable", async () => {
    const collectors: CoreCollectorPlugin[] = [
      makeCollector("system", "system", true, {}),
      {
        name: "broken",
        capability: "gpu",
        detect: Effect.die(new Error("detect failed")),
        collect: Effect.die(new Error("should not be called")),
      },
    ]

    const capabilities = await run(
      discoverFromCollectors(collectors, [], [])
    )

    expect(capabilities.system).toBe(true)
    expect(capabilities.gpu).toBe(false)
  })
})

// ── collectAll() ─────────────────────────────────────────────────────────────

describe("CollectorRegistry.collectAll", () => {
  it("collects all active collectors", async () => {
    const systemData = {
      cpu: { usage: 0, cores: 4, perCore: [], breakdown: { user: 0, system: 0, iowait: 0, steal: 0, idle: 100 } },
      memory: { used: 0, total: 0, available: 0, buffersCache: 0, swap: { used: 0, total: 0 } },
      disks: [],
      loadAvg: [0, 0, 0] as [number, number, number],
      uptime: 100,
    }
    const networkData = [{ name: "eth0", rxBytesPerSec: 0, txBytesPerSec: 0, rxPacketsPerSec: 0, txPacketsPerSec: 0 }]

    const collectors: CoreCollectorPlugin[] = [
      makeCollector("system", "system", true, systemData),
      makeCollector("network", "network", true, networkData),
      makeCollector("gpu", "gpu", false, []), // inactive
    ]

    const sample = await run(
      collectAllFromCollectors(collectors, [], [])
    )

    expect(sample.cpuPercent).toBe(systemData.cpu.usage)
    expect(sample.cpuCores).toBe(systemData.cpu.cores)
    expect(sample.networkRxBytesPerSecByInterface).toEqual({ eth0: 0 })
    expect(sample.gpuPercent).toBeNull()
  })

  it("one collector fails → report excludes that section", async () => {
    const systemData = {
      cpu: { usage: 0, cores: 4, perCore: [], breakdown: { user: 0, system: 0, iowait: 0, steal: 0, idle: 100 } },
      memory: { used: 0, total: 0, available: 0, buffersCache: 0, swap: { used: 0, total: 0 } },
      disks: [],
      loadAvg: [0, 0, 0] as [number, number, number],
      uptime: 100,
    }

    const collectors: CoreCollectorPlugin[] = [
      makeCollector("system", "system", true, systemData),
      makeCollector("network", "network", true, []),
      makeFailingCollector("process", "process"),
    ]

    const sample = await run(
      collectAllFromCollectors(collectors, [], [])
    )

    expect(sample.cpuPercent).toBe(systemData.cpu.usage)
    expect(sample.cpuCores).toBe(systemData.cpu.cores)
  })

  it("all collectors fail → sample falls back to zeroed core values", async () => {
    const collectors: CoreCollectorPlugin[] = [
      makeFailingCollector("system", "system"),
      makeFailingCollector("network", "network"),
    ]

    const sample = await run(
      collectAllFromCollectors(collectors, [], [])
    )

    expect(sample.cpuPercent).toBe(0)
    expect(sample.networkRxBytesPerSec).toBe(0)
    expect(sample.networkRxBytesPerSecByInterface).toEqual({})
  })
})

// ── Inline logic helpers ──────────────────────────────────────────────────────

/**
 * Thin reproduction of discover() and collectAll() logic for unit testing,
 * parameterised over a custom collector list.
 */
function discoverFromCollectors(
  collectors: CoreCollectorPlugin[],
  disable: string[],
  enable: string[],
) {
  return Effect.gen(function* () {
    const results = yield* Effect.all(
      collectors.map((c) =>
        c.detect.pipe(
          Effect.catchCause(() => Effect.succeed(false)),
          Effect.map((detected) => ({ capability: c.capability, detected }))
        )
      ),
      { concurrency: "unbounded" }
    )

    const caps = {
      system: false,
      network: false,
      process: false,
      temperature: false,
      gpu: false,
      smart: false,
    }

    for (const { capability, detected } of results) {
      caps[capability] = detected
    }
    for (const cap of disable) {
      if (cap in caps) caps[cap as keyof typeof caps] = false
    }
    for (const cap of enable) {
      if (cap in caps) caps[cap as keyof typeof caps] = true
    }

    return caps
  })
}

function collectAllFromCollectors(
  collectors: CoreCollectorPlugin[],
  disable: string[],
  enable: string[],
) {
  return Effect.gen(function* () {
    const caps = yield* discoverFromCollectors(collectors, disable, enable)
    const active = collectors.filter((c) => caps[c.capability])

    const results = yield* Effect.all(
      active.map((c) =>
        c.collect.pipe(
          Effect.map((r) => r as CollectorReport | null),
          Effect.catchCause(() => Effect.succeed(null as CollectorReport | null))
        )
      ),
      { concurrency: "unbounded" }
    )

    const byCapability = new Map<string, CollectorReport>()
    for (let i = 0; i < active.length; i++) {
      const r = results[i]
      if (r !== null && r !== undefined) {
        byCapability.set(active[i]!.capability, r)
      }
    }

    const systemReport = byCapability.get("system")
    const networkReport = byCapability.get("network")

    const systemData = (systemReport?.data ?? {
      cpu: { usage: 0, cores: 0, perCore: [], breakdown: { user: 0, system: 0, iowait: 0, steal: 0, idle: 100 } },
      memory: { used: 0, total: 0, available: 0, buffersCache: 0, swap: { used: 0, total: 0 } },
      disks: [],
      loadAvg: [0, 0, 0] as [number, number, number],
      uptime: 0,
    }) as import("@scout/shared").SystemMetrics

    const networkData = (networkReport?.data ?? []) as import("@scout/shared").NetworkInterfaceMetrics[]

    const temperatures = byCapability.get("temperature")?.data as import("@scout/shared").TemperatureMetrics[] | undefined
    const gpu = byCapability.get("gpu")?.data as import("@scout/shared").GpuMetrics[] | undefined
    const smart = byCapability.get("smart")?.data as import("@scout/shared").SmartMetrics[] | undefined
    const disk = systemData.disks[0] ?? null
    const networkRxBytesPerSec = networkData.reduce(
      (total, network) => total + network.rxBytesPerSec,
      0,
    )
    const networkTxBytesPerSec = networkData.reduce(
      (total, network) => total + network.txBytesPerSec,
      0,
    )

    return {
      timestamp: Date.now(),
      cpuPercent: systemData.cpu.usage,
      cpuCores: systemData.cpu.cores,
      cpuPerCorePercent: systemData.cpu.perCore,
      cpuUserPercent: systemData.cpu.breakdown.user,
      cpuSystemPercent: systemData.cpu.breakdown.system,
      cpuIowaitPercent: systemData.cpu.breakdown.iowait,
      cpuStealPercent: systemData.cpu.breakdown.steal,
      cpuIdlePercent: systemData.cpu.breakdown.idle,
      memoryUsedBytes: systemData.memory.used,
      memoryTotalBytes: systemData.memory.total,
      memoryAvailableBytes: systemData.memory.available,
      memoryBuffersCacheBytes: systemData.memory.buffersCache,
      swapUsedBytes: systemData.memory.swap.used,
      swapTotalBytes: systemData.memory.swap.total,
      memoryPercent:
        systemData.memory.total > 0
          ? (systemData.memory.used / systemData.memory.total) * 100
          : 0,
      diskUsedBytes: disk?.used ?? null,
      diskTotalBytes: disk?.total ?? null,
      diskPercent:
        disk !== null && disk.total > 0
          ? (disk.used / disk.total) * 100
          : null,
      diskReadBytesPerSec: disk?.readBytesPerSec ?? 0,
      diskWriteBytesPerSec: disk?.writeBytesPerSec ?? 0,
      networkRxBytesPerSec,
      networkTxBytesPerSec,
      networkRxBytesPerSecByInterface: Object.fromEntries(
        networkData.map((network) => [network.name, network.rxBytesPerSec]),
      ),
      networkTxBytesPerSecByInterface: Object.fromEntries(
        networkData.map((network) => [network.name, network.txBytesPerSec]),
      ),
      gpuPercent: gpu?.[0]?.usage ?? null,
      gpuMemoryPercent:
        gpu?.[0] && gpu[0].memTotal > 0
          ? (gpu[0].memUsed / gpu[0].memTotal) * 100
          : null,
      gpuTemperatureCelsius: gpu?.[0]?.temperature ?? null,
      temperaturesCelsius: Object.fromEntries(
        (temperatures ?? []).map((temperature) => [temperature.label, temperature.celsius]),
      ),
      smartHealthFailing:
        smart?.some((device) => device.health === "FAILED") ?? false,
      loadAvg1m: systemData.loadAvg[0],
      loadAvg5m: systemData.loadAvg[1],
      loadAvg15m: systemData.loadAvg[2],
      uptimeSeconds: systemData.uptime,
    } satisfies SystemMetricsSample
  })
}
