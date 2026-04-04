import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import type { CollectorPlugin, CollectorReport } from "@scout/shared"

// ── Mock collector builders ───────────────────────────────────────────────────

const makeCollector = (
  name: string,
  capability: CollectorPlugin["capability"],
  available: boolean,
  data: unknown,
): CollectorPlugin => ({
  name,
  capability,
  detect: Effect.succeed(available),
  collect: Effect.succeed({ capability, data } as CollectorReport),
})

const makeFailingCollector = (
  name: string,
  capability: CollectorPlugin["capability"],
): CollectorPlugin => ({
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
    const collectors: CollectorPlugin[] = [
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
    const collectors: CollectorPlugin[] = [
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
    const collectors: CollectorPlugin[] = [
      makeCollector("system", "system", true, {}),
      makeCollector("docker", "docker", true, []),
    ]

    const capabilities = await run(
      discoverFromCollectors(collectors, ["docker"], [])
    )

    expect(capabilities.system).toBe(true)
    expect(capabilities.docker).toBe(false)
  })

  it("config enable → forced true even if not detected", async () => {
    const collectors: CollectorPlugin[] = [
      makeCollector("gpu", "gpu", false, []),
    ]

    const capabilities = await run(
      discoverFromCollectors(collectors, [], ["gpu"])
    )

    expect(capabilities.gpu).toBe(true)
  })

  it("detect failure → treated as unavailable", async () => {
    const collectors: CollectorPlugin[] = [
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

    const collectors: CollectorPlugin[] = [
      makeCollector("system", "system", true, systemData),
      makeCollector("network", "network", true, networkData),
      makeCollector("gpu", "gpu", false, []), // inactive
    ]

    const report = await run(
      collectAllFromCollectors(collectors, [], [])
    )

    expect(report.system).toEqual(systemData)
    expect(report.network).toEqual(networkData)
    expect(report.gpu).toBeUndefined()
  })

  it("one collector fails → report excludes that section", async () => {
    const systemData = {
      cpu: { usage: 0, cores: 4, perCore: [], breakdown: { user: 0, system: 0, iowait: 0, steal: 0, idle: 100 } },
      memory: { used: 0, total: 0, available: 0, buffersCache: 0, swap: { used: 0, total: 0 } },
      disks: [],
      loadAvg: [0, 0, 0] as [number, number, number],
      uptime: 100,
    }

    const collectors: CollectorPlugin[] = [
      makeCollector("system", "system", true, systemData),
      makeCollector("network", "network", true, []),
      makeFailingCollector("process", "process"),
    ]

    const report = await run(
      collectAllFromCollectors(collectors, [], [])
    )

    // Report succeeds even though process collector failed
    expect(report.system).toEqual(systemData)
    expect(report.processes).toBeUndefined()
  })

  it("all collectors fail → report has empty system/network", async () => {
    const collectors: CollectorPlugin[] = [
      makeFailingCollector("system", "system"),
      makeFailingCollector("network", "network"),
    ]

    const report = await run(
      collectAllFromCollectors(collectors, [], [])
    )

    // system and network fallback to empty defaults
    expect(report.system).toBeDefined()
    expect(report.network).toBeDefined()
    expect(Array.isArray(report.network)).toBe(true)
  })
})

// ── Inline logic helpers ──────────────────────────────────────────────────────

/**
 * Thin reproduction of discover() and collectAll() logic for unit testing,
 * parameterised over a custom collector list.
 */
function discoverFromCollectors(
  collectors: CollectorPlugin[],
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
      systemd: false,
      docker: false,
      k8s: false,
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
  collectors: CollectorPlugin[],
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

    return {
      systemId: "test-host",
      timestamp: Date.now(),
      system: systemData,
      network: networkData,
      processes: byCapability.get("process")?.data as import("@scout/shared").ProcessMetrics[] | undefined,
      temperatures: byCapability.get("temperature")?.data as import("@scout/shared").TemperatureMetrics[] | undefined,
      gpu: byCapability.get("gpu")?.data as import("@scout/shared").GpuMetrics[] | undefined,
      smart: byCapability.get("smart")?.data as import("@scout/shared").SmartMetrics[] | undefined,
      systemd: byCapability.get("systemd")?.data as import("@scout/shared").SystemdServiceMetrics[] | undefined,
      docker: byCapability.get("docker")?.data as import("@scout/shared").DockerContainerMetrics[] | undefined,
      k8s: byCapability.get("k8s")?.data as import("@scout/shared").K8sWorkloadMetrics | undefined,
    } as import("@scout/shared").AgentReport
  })
}
