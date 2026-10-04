import { Cause, Effect, Layer } from "effect"
import * as Context from "effect/Context"
import type {
  AgentCapabilities,
  CollectorPlugin,
  CollectorReport,
  SystemMetricsSample,
} from "@scout/shared"
import type {
  SystemMetrics,
  NetworkInterfaceMetrics,
  TemperatureMetrics,
  GpuMetrics,
  SmartMetrics,
} from "@scout/shared"
import { AgentConfig } from "../config.js"
import { systemCollector } from "../collectors/system.js"
import { networkCollector } from "../collectors/network.js"
import { processCollector } from "../collectors/process.js"
import { temperatureCollector } from "../collectors/temperature.js"
import { gpuCollector } from "../collectors/gpu.js"
import { smartCollector } from "../collectors/smart.js"

// All collector plugins in canonical order
type CoreCollectorCapability = keyof AgentCapabilities
type CoreCollectorPlugin = CollectorPlugin & { capability: CoreCollectorCapability }

const ALL_COLLECTORS: CoreCollectorPlugin[] = [
  systemCollector as CoreCollectorPlugin,
  networkCollector as CoreCollectorPlugin,
  processCollector as CoreCollectorPlugin,
  temperatureCollector as CoreCollectorPlugin,
  gpuCollector as CoreCollectorPlugin,
  smartCollector as CoreCollectorPlugin,
]

// Auto-discovers available collectors and manages their lifecycle.
export class CollectorRegistry extends Context.Service<CollectorRegistry, {
  /**
   * Probe all registered collectors and return which capabilities are available.
   */
  readonly discover: () => Effect.Effect<AgentCapabilities>
  /**
   * Run all active core collectors and assemble a flat core metrics sample.
   */
  readonly collectAll: (capabilities?: AgentCapabilities) => Effect.Effect<SystemMetricsSample>
}>()(
  "@scout/CollectorRegistry",
  {
    make: Effect.gen(function* () {
      const config = yield* AgentConfig.load
      // ── discover ─────────────────────────────────────────────────────────────

      const discover = (): Effect.Effect<AgentCapabilities> =>
        Effect.gen(function* () {
          // Run detect() on all collectors in parallel
          const results = yield* Effect.all(
            ALL_COLLECTORS.map((c) =>
              c.detect.pipe(
                Effect.catchCause(() => Effect.succeed(false)),
                Effect.map((detected) => ({ capability: c.capability, detected }))
              )
            ),
            { concurrency: "unbounded" }
          )
          const caps: AgentCapabilities = {
            system: false,
            network: false,
            process: false,
            temperature: false,
            gpu: false,
            smart: false,
          }

          const mutable: { -readonly [K in keyof AgentCapabilities]: boolean } = {
            ...caps,
          }

          for (const { capability, detected } of results) {
            mutable[capability] = detected
          }

          // Apply config overrides
          for (const cap of config.collectorsDisable) {
            if (cap in mutable) {
              mutable[cap as keyof AgentCapabilities] = false
            }
          }
          for (const cap of config.collectorsEnable) {
            if (cap in mutable) {
              mutable[cap as keyof AgentCapabilities] = true
            }
          }

          return mutable as AgentCapabilities
        })

      // ── collectAll ───────────────────────────────────────────────────────────

      const collectAll = (
        capabilities?: AgentCapabilities,
      ): Effect.Effect<SystemMetricsSample> =>
        Effect.gen(function* () {
          const caps = capabilities ?? (yield* discover())
          const active = ALL_COLLECTORS.filter((c) => caps[c.capability])

          // Run all active collectors in parallel; catch failures per-collector
          const results = yield* Effect.all(
            active.map((c) =>
              c.collect.pipe(
                Effect.map((r) => r as CollectorReport | null),
                Effect.catchCause((cause) =>
                  Effect.logWarning(
                    `CollectorRegistry: collector "${c.name}" failed, excluding from report`,
                    { error: Cause.pretty(cause) }
                  ).pipe(Effect.as(null as CollectorReport | null))
                )
              )
            ),
            { concurrency: "unbounded" }
          )

          // Map results back to active collectors by capability
          const byCapability = new Map<CoreCollectorCapability, CollectorReport>()
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
          }) as SystemMetrics

          const networkData = (networkReport?.data ?? []) as NetworkInterfaceMetrics[]

          const temperatures = byCapability.get("temperature")?.data as TemperatureMetrics[] | undefined
          const gpu = byCapability.get("gpu")?.data as GpuMetrics[] | undefined
          const smart = byCapability.get("smart")?.data as SmartMetrics[] | undefined
          const disk = systemData.disks[0] ?? null
          const networkRxBytesPerSec = networkData.reduce(
            (total, network) => total + network.rxBytesPerSec,
            0,
          )
          const networkTxBytesPerSec = networkData.reduce(
            (total, network) => total + network.txBytesPerSec,
            0,
          )
          const networkRxBytesPerSecByInterface = Object.fromEntries(
            networkData.map((network) => [network.name, network.rxBytesPerSec]),
          )
          const networkTxBytesPerSecByInterface = Object.fromEntries(
            networkData.map((network) => [network.name, network.txBytesPerSec]),
          )
          const primaryGpu = gpu?.[0] ?? null
          const temperaturesCelsius = Object.fromEntries(
            (temperatures ?? []).map((temperature) => [temperature.label, temperature.celsius]),
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
            networkRxBytesPerSecByInterface,
            networkTxBytesPerSecByInterface,
            gpuPercent: primaryGpu?.usage ?? null,
            gpuMemoryPercent:
              primaryGpu !== null && primaryGpu.memTotal > 0
                ? (primaryGpu.memUsed / primaryGpu.memTotal) * 100
                : null,
            gpuTemperatureCelsius: primaryGpu?.temperature ?? null,
            temperaturesCelsius,
            smartHealthFailing:
              smart?.some((device) => device.health === "FAILED") ?? false,
            loadAvg1m: systemData.loadAvg[0],
            loadAvg5m: systemData.loadAvg[1],
            loadAvg15m: systemData.loadAvg[2],
            uptimeSeconds: systemData.uptime,
          }
        })

      return { discover, collectAll }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
