import { Cause, Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import type { AgentCapabilities, CollectorPlugin, AgentReport, CollectorReport } from "@scout/shared"
import type {
  SystemMetrics,
  NetworkInterfaceMetrics,
  ProcessMetrics,
  TemperatureMetrics,
  GpuMetrics,
  SmartMetrics,
  SystemdServiceMetrics,
  DockerContainerMetrics,
  K8sWorkloadMetrics,
} from "@scout/shared"
import { AgentConfig } from "../config.js"
import { systemCollector } from "../collectors/system.js"
import { networkCollector } from "../collectors/network.js"
import { processCollector } from "../collectors/process.js"
import { temperatureCollector } from "../collectors/temperature.js"
import { gpuCollector } from "../collectors/gpu.js"
import { smartCollector } from "../collectors/smart.js"
import { systemdCollector } from "../collectors/systemd.js"
import { dockerCollector } from "../collectors/docker.js"
import { k8sCollector } from "../collectors/k8s.js"

// All collector plugins in canonical order
const ALL_COLLECTORS: CollectorPlugin[] = [
  systemCollector,
  networkCollector,
  processCollector,
  temperatureCollector,
  gpuCollector,
  smartCollector,
  systemdCollector,
  dockerCollector,
  k8sCollector,
]

// Auto-discovers available collectors and manages their lifecycle.
export class CollectorRegistry extends ServiceMap.Service<CollectorRegistry, {
  /**
   * Probe all registered collectors and return which capabilities are available.
   */
  readonly discover: () => Effect.Effect<AgentCapabilities>
  /**
   * Return only collectors that passed their detect check.
   */
  readonly getActive: () => Effect.Effect<CollectorPlugin[]>
  /**
   * Run all active collectors and assemble a full AgentReport.
   */
  readonly collectAll: () => Effect.Effect<AgentReport>
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

          // Build base capabilities from detect results
          const caps: AgentCapabilities = {
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

      // ── getActive ────────────────────────────────────────────────────────────

      const getActive = (): Effect.Effect<CollectorPlugin[]> =>
        Effect.gen(function* () {
          const caps = yield* discover()
          return ALL_COLLECTORS.filter((c) => caps[c.capability])
        })

      // ── collectAll ───────────────────────────────────────────────────────────

      const collectAll = (): Effect.Effect<AgentReport> =>
        Effect.gen(function* () {
          const active = yield* getActive()

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
          const byCapability = new Map<keyof AgentCapabilities, CollectorReport>()
          for (let i = 0; i < active.length; i++) {
            const r = results[i]
            if (r !== null && r !== undefined) {
              byCapability.set(active[i]!.capability, r)
            }
          }

          const systemReport = byCapability.get("system")
          const networkReport = byCapability.get("network")

          // system and network are required fields in AgentReport
          const systemData = (systemReport?.data ?? {
            cpu: { usage: 0, cores: 0, perCore: [], breakdown: { user: 0, system: 0, iowait: 0, steal: 0, idle: 100 } },
            memory: { used: 0, total: 0, available: 0, buffersCache: 0, swap: { used: 0, total: 0 } },
            disks: [],
            loadAvg: [0, 0, 0] as [number, number, number],
            uptime: 0,
          }) as SystemMetrics

          const networkData = (networkReport?.data ?? []) as NetworkInterfaceMetrics[]

          const report: AgentReport = {
            systemId: config.hostname,
            timestamp: Date.now(),
            system: systemData,
            network: networkData,
            processes: byCapability.get("process")?.data as ProcessMetrics[] | undefined,
            temperatures: byCapability.get("temperature")?.data as TemperatureMetrics[] | undefined,
            gpu: byCapability.get("gpu")?.data as GpuMetrics[] | undefined,
            smart: byCapability.get("smart")?.data as SmartMetrics[] | undefined,
            systemd: byCapability.get("systemd")?.data as SystemdServiceMetrics[] | undefined,
            docker: byCapability.get("docker")?.data as DockerContainerMetrics[] | undefined,
            k8s: byCapability.get("k8s")?.data as K8sWorkloadMetrics | undefined,
          }

          return report
        })

      return { discover, getActive, collectAll }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
