import { Effect } from "effect"
import type { CollectorPlugin, CollectorReport } from "@scout/shared"
import type { CpuMetrics, DiskMetrics, MemoryMetrics, SystemMetrics } from "@scout/shared"

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CpuFields {
  user: number
  nice: number
  system: number
  idle: number
  iowait: number
  irq: number
  softirq: number
  steal: number
}

// Module-level mutable state for delta calculations (initialized lazily)
let _prevCpuContent: string | null = null
let _prevDiskstatsContent: string | null = null
let _prevDiskstatsTimestamp: number = 0

// ---------------------------------------------------------------------------
// CPU parsing (/proc/stat)
// ---------------------------------------------------------------------------

function parseCpuLine(line: string): CpuFields | null {
  const parts = line.trim().split(/\s+/)
  if (parts.length < 8) return null
  return {
    user: Number(parts[1]),
    nice: Number(parts[2]),
    system: Number(parts[3]),
    idle: Number(parts[4]),
    iowait: Number(parts[5]),
    irq: Number(parts[6]),
    softirq: Number(parts[7]),
    steal: Number(parts[8] ?? 0),
  }
}

function calcCpuPercent(
  prev: CpuFields,
  curr: CpuFields,
): { usage: number; breakdown: CpuMetrics["breakdown"] } {
  const prevTotal =
    prev.user + prev.nice + prev.system + prev.idle + prev.iowait + prev.irq + prev.softirq + prev.steal
  const currTotal =
    curr.user + curr.nice + curr.system + curr.idle + curr.iowait + curr.irq + curr.softirq + curr.steal

  const totalDelta = currTotal - prevTotal
  if (totalDelta <= 0) {
    return { usage: 0, breakdown: { user: 0, system: 0, iowait: 0, steal: 0, idle: 100 } }
  }

  const clamp = (v: number) => Math.min(100, Math.max(0, v))
  const pct = (v: number) => clamp((v / totalDelta) * 100)

  const idleDelta = curr.idle - prev.idle
  const userDelta = curr.user + curr.nice - (prev.user + prev.nice)
  const systemDelta = curr.system + curr.irq + curr.softirq - (prev.system + prev.irq + prev.softirq)
  const iowaitDelta = curr.iowait - prev.iowait
  const stealDelta = curr.steal - prev.steal

  return {
    usage: clamp(((totalDelta - idleDelta) / totalDelta) * 100),
    breakdown: {
      user: pct(userDelta),
      system: pct(systemDelta),
      iowait: pct(iowaitDelta),
      steal: pct(stealDelta),
      idle: pct(idleDelta),
    },
  }
}

/**
 * Pure parser for /proc/stat.
 * On first call (previous = null) returns 0% usage with correct core count.
 */
export function parseProcStat(current: string, previous: string | null): CpuMetrics {
  const currentLines = current.split("\n")
  const coreCount = currentLines.filter((l) => /^cpu\d+\s/.test(l)).length

  if (!previous) {
    return {
      usage: 0,
      cores: coreCount,
      perCore: Array<number>(coreCount).fill(0),
      breakdown: { user: 0, system: 0, iowait: 0, steal: 0, idle: 100 },
    }
  }

  const prevLines = previous.split("\n")

  // Aggregate (cpu  ...)
  const currAgg = parseCpuLine(currentLines.find((l) => /^cpu\s/.test(l)) ?? "")
  const prevAgg = parseCpuLine(prevLines.find((l) => /^cpu\s/.test(l)) ?? "")

  let usage = 0
  let breakdown: CpuMetrics["breakdown"] = { user: 0, system: 0, iowait: 0, steal: 0, idle: 100 }
  if (currAgg && prevAgg) {
    const r = calcCpuPercent(prevAgg, currAgg)
    usage = r.usage
    breakdown = r.breakdown
  }

  // Per-core
  const currCoreLines = currentLines.filter((l) => /^cpu\d+\s/.test(l))
  const prevCoreLines = prevLines.filter((l) => /^cpu\d+\s/.test(l))

  const perCore = currCoreLines.map((line, i) => {
    const prev = parseCpuLine(prevCoreLines[i] ?? "")
    const curr = parseCpuLine(line)
    if (!prev || !curr) return 0
    return calcCpuPercent(prev, curr).usage
  })

  return { usage, cores: coreCount, perCore, breakdown }
}

// ---------------------------------------------------------------------------
// Memory parsing (/proc/meminfo)
// ---------------------------------------------------------------------------

/**
 * Pure parser for /proc/meminfo. All values in bytes.
 */
export function parseProcMeminfo(content: string): MemoryMetrics {
  const fields: Record<string, number> = {}
  for (const line of content.split("\n")) {
    const m = line.match(/^(\w+):\s+(\d+)/)
    if (m) fields[m[1]] = Number(m[2]) * 1024 // kB → bytes
  }

  const total = fields["MemTotal"] ?? 0
  const available = fields["MemAvailable"] ?? 0
  const buffers = fields["Buffers"] ?? 0
  const cached = fields["Cached"] ?? 0
  const swapTotal = fields["SwapTotal"] ?? 0
  const swapFree = fields["SwapFree"] ?? 0

  return {
    total,
    available,
    used: total - available,
    buffersCache: buffers + cached,
    swap: { total: swapTotal, used: swapTotal - swapFree },
  }
}

// ---------------------------------------------------------------------------
// Load average (/proc/loadavg)
// ---------------------------------------------------------------------------

/**
 * Pure parser for /proc/loadavg.
 */
export function parseProcLoadavg(content: string): [number, number, number] {
  const parts = content.trim().split(/\s+/)
  return [Number(parts[0] ?? 0), Number(parts[1] ?? 0), Number(parts[2] ?? 0)]
}

// ---------------------------------------------------------------------------
// Uptime (/proc/uptime)
// ---------------------------------------------------------------------------

/**
 * Pure parser for /proc/uptime. Returns seconds.
 */
export function parseProcUptime(content: string): number {
  return Number(content.trim().split(/\s+/)[0] ?? 0)
}

// ---------------------------------------------------------------------------
// Disk usage (df output)
// ---------------------------------------------------------------------------

const VIRTUAL_FS_TYPES = new Set([
  "tmpfs",
  "devtmpfs",
  "sysfs",
  "proc",
  "devpts",
  "cgroup",
  "cgroup2",
  "pstore",
  "bpf",
  "tracefs",
  "debugfs",
  "securityfs",
  "fusectl",
  "hugetlbfs",
  "mqueue",
  "configfs",
  "efivarfs",
  "overlay",
  "squashfs",
  "ramfs",
  "nsfs",
  "autofs",
])

/**
 * Pure parser for `df -B1 --output=target,source,fstype,size,used` output.
 * Returns DiskMetrics[] with readBytesPerSec/writeBytesPerSec as 0.
 */
export function parseDiskUsage(dfOutput: string): DiskMetrics[] {
  const lines = dfOutput
    .split("\n")
    .slice(1)
    .filter((l) => l.trim().length > 0)
  const results: DiskMetrics[] = []
  const seenMounts = new Set<string>()

  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5) continue

    const [mount, device, fstype, size, used] = parts as [string, string, string, string, string]

    if (VIRTUAL_FS_TYPES.has(fstype)) continue
    if (device.startsWith("/dev/loop")) continue
    if (seenMounts.has(mount)) continue
    seenMounts.add(mount)

    const total = Number(size)
    const usedBytes = Number(used)
    if (total <= 0) continue

    results.push({
      mount,
      device,
      total,
      used: usedBytes,
      readBytesPerSec: 0,
      writeBytesPerSec: 0,
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// Disk I/O (/proc/diskstats)
// ---------------------------------------------------------------------------

/**
 * Pure parser for /proc/diskstats. Returns per-device bytes/sec.
 * intervalMs: elapsed milliseconds between current and previous reading.
 */
export function parseProcDiskstats(
  current: string,
  previous: string | null,
  intervalMs: number,
): Map<string, { read: number; write: number }> {
  const result = new Map<string, { read: number; write: number }>()
  if (!previous || intervalMs <= 0) return result

  interface DsEntry {
    readSectors: number
    writeSectors: number
  }

  const parse = (content: string): Map<string, DsEntry> => {
    const m = new Map<string, DsEntry>()
    for (const line of content.split("\n")) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 10) continue
      const dev = parts[2]
      if (!dev || dev.startsWith("loop") || dev.startsWith("ram")) continue
      m.set(dev, {
        readSectors: Number(parts[5] ?? 0),
        writeSectors: Number(parts[9] ?? 0),
      })
    }
    return m
  }

  const currMap = parse(current)
  const prevMap = parse(previous)
  const intervalSec = intervalMs / 1000

  for (const [dev, curr] of currMap) {
    const prev = prevMap.get(dev)
    if (!prev) continue
    result.set(dev, {
      read: Math.max(0, ((curr.readSectors - prev.readSectors) * 512) / intervalSec),
      write: Math.max(0, ((curr.writeSectors - prev.writeSectors) * 512) / intervalSec),
    })
  }

  return result
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

const readFile = (path: string): Effect.Effect<string> =>
  Effect.tryPromise({
    try: () => Bun.file(path).text(),
    catch: (e) => new Error(`Failed to read ${path}: ${String(e)}`),
  }).pipe(Effect.orDie)

const spawnText = (cmd: string[]): Effect.Effect<string> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
      const text = await new Response(proc.stdout).text()
      await proc.exited
      return text
    },
    catch: (e) => new Error(`Failed to spawn ${cmd.join(" ")}: ${String(e)}`),
  }).pipe(Effect.orDie)

// ---------------------------------------------------------------------------
// CollectorPlugin
// ---------------------------------------------------------------------------

export const systemCollector: CollectorPlugin = {
  name: "system",
  capability: "system",
  detect: Effect.succeed(true),
  collect: Effect.gen(function* () {
    const now = Date.now()

    const [cpuContent, meminfoContent, loadavgContent, uptimeContent, dfOutput, diskstatsContent] =
      yield* Effect.all([
        readFile("/proc/stat"),
        readFile("/proc/meminfo"),
        readFile("/proc/loadavg"),
        readFile("/proc/uptime"),
        spawnText(["df", "-B1", "--output=target,source,fstype,size,used"]),
        readFile("/proc/diskstats"),
      ])

    const cpu = parseProcStat(cpuContent, _prevCpuContent)
    const memory = parseProcMeminfo(meminfoContent)
    const loadAvg = parseProcLoadavg(loadavgContent)
    const uptime = parseProcUptime(uptimeContent)
    const disks = parseDiskUsage(dfOutput)

    // Merge disk I/O rates
    if (_prevDiskstatsContent && _prevDiskstatsTimestamp > 0) {
      const intervalMs = now - _prevDiskstatsTimestamp
      const ioRates = parseProcDiskstats(diskstatsContent, _prevDiskstatsContent, intervalMs)
      for (const disk of disks) {
        const devBasename = disk.device.split("/").pop() ?? disk.device
        const rate = ioRates.get(devBasename)
        if (rate) {
          disk.readBytesPerSec = rate.read
          disk.writeBytesPerSec = rate.write
        }
      }
    }

    // Store for next delta
    _prevCpuContent = cpuContent
    _prevDiskstatsContent = diskstatsContent
    _prevDiskstatsTimestamp = now

    const systemMetrics: SystemMetrics = { cpu, memory, disks, loadAvg, uptime }
    return { capability: "system" as const, data: systemMetrics } satisfies CollectorReport
  }),
}

export type { SystemMetrics }
