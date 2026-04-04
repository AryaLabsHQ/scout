import { Effect } from "effect"
import type { CollectorPlugin, CollectorReport, SystemdServiceMetrics } from "@scout/shared"

// ---------------------------------------------------------------------------
// I/O helper
// ---------------------------------------------------------------------------

const runCommand = (cmd: string, args: string[]): Effect.Effect<string> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" })
      const text = await new Response(proc.stdout).text()
      await proc.exited
      if (proc.exitCode !== 0) throw new Error(`${cmd} exited with ${proc.exitCode}`)
      return text
    },
    catch: (e) => new Error(`Failed to run ${cmd}: ${String(e)}`),
  }).pipe(Effect.orDie)

// ---------------------------------------------------------------------------
// Pure parsers
// ---------------------------------------------------------------------------

interface SystemctlUnit {
  unit?: string
  load?: string
  active?: string
  sub?: string
  description?: string
}

/**
 * Parse `systemctl list-units --type=service --all --output=json` output.
 */
export function parseSystemctlListUnits(json: string): SystemdServiceMetrics[] {
  let parsed: SystemctlUnit[]
  try {
    parsed = JSON.parse(json) as SystemctlUnit[]
    if (!Array.isArray(parsed)) return []
  } catch {
    return []
  }

  return parsed.map(entry => ({
    unit: entry.unit ?? "",
    description: entry.description ?? "",
    loadState: normalizeLoadState(entry.load),
    activeState: normalizeActiveState(entry.active),
    subState: entry.sub ?? "",
    pid: null,
    memoryBytes: null,
    cpuUsageNs: null,
  }))
}

function normalizeLoadState(s: string | undefined): SystemdServiceMetrics["loadState"] {
  switch (s) {
    case "loaded": return "loaded"
    case "not-found": return "not-found"
    case "masked": return "masked"
    default: return "error"
  }
}

function normalizeActiveState(s: string | undefined): SystemdServiceMetrics["activeState"] {
  switch (s) {
    case "active": return "active"
    case "inactive": return "inactive"
    case "failed": return "failed"
    case "activating": return "activating"
    case "deactivating": return "deactivating"
    default: return "inactive"
  }
}

/**
 * Parse `systemctl show SERVICE --property=MainPID,MemoryCurrent,CPUUsageNSec` output.
 * Returns pid (null if 0), memoryBytes (null if not set / [not set]), cpuUsageNs (null if 0 or not set).
 */
export function parseSystemctlShow(output: string): {
  pid: number | null
  memoryBytes: number | null
  cpuUsageNs: number | null
} {
  const fields: Record<string, string> = {}
  for (const line of output.split("\n")) {
    const eqIdx = line.indexOf("=")
    if (eqIdx === -1) continue
    const key = line.slice(0, eqIdx).trim()
    const value = line.slice(eqIdx + 1).trim()
    fields[key] = value
  }

  const rawPid = fields["MainPID"]
  const pid = rawPid && rawPid !== "0" ? Number(rawPid) : null

  const rawMem = fields["MemoryCurrent"]
  // "[not set]" or absent → null
  let memoryBytes: number | null = null
  if (rawMem && rawMem !== "[not set]") {
    const n = Number(rawMem)
    if (!isNaN(n) && n >= 0) memoryBytes = n
  }

  const rawCpu = fields["CPUUsageNSec"]
  let cpuUsageNs: number | null = null
  if (rawCpu && rawCpu !== "[not set]") {
    const n = Number(rawCpu)
    if (!isNaN(n) && n > 0) cpuUsageNs = n
  }

  return { pid, memoryBytes, cpuUsageNs }
}

// ---------------------------------------------------------------------------
// CollectorPlugin
// ---------------------------------------------------------------------------

const MAX_ACTIVE_SERVICES = 50

export const systemdCollector: CollectorPlugin = {
  name: "systemd",
  capability: "systemd",
  detect: Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["which", "systemctl"], { stdout: "pipe", stderr: "pipe" })
      await proc.exited
      return proc.exitCode === 0
    },
    catch: () => new Error("which systemctl failed"),
  }).pipe(
    Effect.orElseSucceed(() => false),
  ),
  collect: Effect.gen(function* () {
    const listOutput = yield* runCommand("systemctl", [
      "list-units",
      "--type=service",
      "--all",
      "--output=json",
    ])

    const services = parseSystemctlListUnits(listOutput)

    // Fetch resource usage for active services (capped)
    const activeServices = services
      .filter(s => s.activeState === "active")
      .slice(0, MAX_ACTIVE_SERVICES)

    for (const svc of activeServices) {
      const showOutput = yield* Effect.tryPromise({
        try: async () => {
          const proc = Bun.spawn(
            ["systemctl", "show", svc.unit, "--property=MainPID,MemoryCurrent,CPUUsageNSec"],
            { stdout: "pipe", stderr: "pipe" },
          )
          const text = await new Response(proc.stdout).text()
          await proc.exited
          return text
        },
        catch: (e) => new Error(`systemctl show failed for ${svc.unit}: ${String(e)}`),
      }).pipe(
        Effect.orElseSucceed(() => ""),
      )

      const resources = parseSystemctlShow(showOutput)
      svc.pid = resources.pid
      svc.memoryBytes = resources.memoryBytes
      svc.cpuUsageNs = resources.cpuUsageNs
    }

    return { capability: "systemd" as const, data: services } satisfies CollectorReport
  }),
} satisfies CollectorPlugin

export type { SystemdServiceMetrics }
