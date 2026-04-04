export interface AgentReport {
  systemId: string
  timestamp: number
  system: SystemMetrics // always present
  network: NetworkInterfaceMetrics[] // always present, per-interface
  processes?: ProcessMetrics[]
  temperatures?: TemperatureMetrics[]
  gpu?: GpuMetrics[]
  smart?: SmartMetrics[]
  systemd?: SystemdServiceMetrics[]
  docker?: DockerContainerMetrics[]
  k8s?: K8sWorkloadMetrics
}

export interface SystemMetrics {
  cpu: CpuMetrics
  memory: MemoryMetrics
  disks: DiskMetrics[]
  loadAvg: [number, number, number] // 1m, 5m, 15m
  uptime: number // seconds
}

export interface CpuMetrics {
  usage: number // 0-100 aggregate
  cores: number
  perCore: number[] // 0-100 per core
  breakdown: CpuBreakdown
}

export interface CpuBreakdown {
  user: number
  system: number
  iowait: number
  steal: number
  idle: number
}

export interface MemoryMetrics {
  used: number // bytes
  total: number
  available: number
  buffersCache: number
  swap: { used: number; total: number }
}

export interface DiskMetrics {
  mount: string
  device: string
  used: number // bytes
  total: number
  readBytesPerSec: number
  writeBytesPerSec: number
}

export interface NetworkInterfaceMetrics {
  name: string // e.g. "eth0", "tailscale0"
  rxBytesPerSec: number
  txBytesPerSec: number
  rxPacketsPerSec: number
  txPacketsPerSec: number
}

export interface GpuMetrics {
  name: string
  index: number
  usage: number // 0-100
  memUsed: number // bytes
  memTotal: number
  temperature: number // celsius
  powerWatts: number
}

export interface SmartMetrics {
  device: string
  model: string
  serial: string
  health: "PASSED" | "FAILED"
  temperature: number | null
  powerOnHours: number | null
  reallocatedSectors: number | null
}

export interface TemperatureMetrics {
  label: string
  source: string // e.g. "thermal_zone0", "hwmon0"
  celsius: number
}

export interface ProcessMetrics {
  pid: number
  name: string
  cpuPercent: number
  memPercent: number
  memBytes: number
  user: string
}

// Forward references — resolved in k8s.ts, docker.ts, systemd.ts
import type { K8sWorkloadMetrics } from "./k8s.js"
import type { DockerContainerMetrics } from "./docker.js"
import type { SystemdServiceMetrics } from "./systemd.js"

export type { K8sWorkloadMetrics, DockerContainerMetrics, SystemdServiceMetrics }
