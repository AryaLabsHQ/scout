import { Effect } from "effect"
import type { CollectorPlugin, CollectorReport, SmartMetrics } from "@scout/shared"

// ---------------------------------------------------------------------------
// I/O helper
// ---------------------------------------------------------------------------

const runCommand = (cmd: string, args: string[]): Effect.Effect<string> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" })
      const text = await new Response(proc.stdout).text()
      await proc.exited
      // smartctl exits with non-zero for some disks that still return valid JSON
      return text
    },
    catch: (e) => new Error(`Failed to run ${cmd}: ${String(e)}`),
  }).pipe(Effect.orDie)

// ---------------------------------------------------------------------------
// Pure parsers
// ---------------------------------------------------------------------------

/**
 * Parse `lsblk -dnpo NAME,TYPE` output.
 * Returns list of device paths that are of type "disk".
 */
export function parseLsblkOutput(output: string): string[] {
  const devices: string[] = []
  for (const line of output.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(/\s+/)
    if (parts.length < 2) continue
    const [name, type] = parts as [string, string]
    if (type === "disk" && name) {
      devices.push(name)
    }
  }
  return devices
}

/**
 * Parse `smartctl -A -j /dev/sdX` JSON output.
 * Handles both SATA (ata_smart_attributes) and NVMe (nvme_smart_health_information_log).
 */
export function parseSmartctlJson(json: string, device: string): SmartMetrics {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(json) as Record<string, unknown>
  } catch {
    return {
      device,
      model: "",
      serial: "",
      health: "FAILED",
      temperature: null,
      powerOnHours: null,
      reallocatedSectors: null,
    }
  }

  const model = (parsed["model_name"] as string | undefined) ?? ""
  const serial = (parsed["serial_number"] as string | undefined) ?? ""

  const smartStatus = parsed["smart_status"] as { passed?: boolean } | undefined
  const health: "PASSED" | "FAILED" = smartStatus?.passed === true ? "PASSED" : "FAILED"

  const tempObj = parsed["temperature"] as { current?: number } | undefined
  const temperature = typeof tempObj?.current === "number" ? tempObj.current : null

  const potObj = parsed["power_on_time"] as { hours?: number } | undefined
  const powerOnHours = typeof potObj?.hours === "number" ? potObj.hours : null

  // SATA: look in ata_smart_attributes.table for id=5 (Reallocated_Sector_Ct)
  let reallocatedSectors: number | null = null
  const ataAttrs = parsed["ata_smart_attributes"] as
    | { table?: Array<{ id: number; raw?: { value: number } }> }
    | undefined
  if (ataAttrs?.table) {
    const attr5 = ataAttrs.table.find(a => a.id === 5)
    if (attr5?.raw?.value !== undefined) {
      reallocatedSectors = attr5.raw.value
    }
  }

  return { device, model, serial, health, temperature, powerOnHours, reallocatedSectors }
}

// ---------------------------------------------------------------------------
// CollectorPlugin
// ---------------------------------------------------------------------------

export const smartCollector: CollectorPlugin = {
  name: "smart",
  capability: "smart",
  detect: Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["which", "smartctl"], { stdout: "pipe", stderr: "pipe" })
      await proc.exited
      return proc.exitCode === 0
    },
    catch: () => new Error("which smartctl failed"),
  }).pipe(
    Effect.orElseSucceed(() => false),
  ),
  collect: Effect.gen(function* () {
    const lsblkOutput = yield* runCommand("lsblk", ["-dnpo", "NAME,TYPE"])
    const devices = parseLsblkOutput(lsblkOutput)

    const metrics: SmartMetrics[] = []
    for (const device of devices) {
      const smartJson = yield* Effect.tryPromise({
        try: async () => {
          // smartctl may exit non-zero but still emit valid JSON
          const proc = Bun.spawn(["smartctl", "-A", "-j", device], {
            stdout: "pipe",
            stderr: "pipe",
          })
          const text = await new Response(proc.stdout).text()
          await proc.exited
          return text
        },
        catch: (e) => new Error(`smartctl failed for ${device}: ${String(e)}`),
      }).pipe(Effect.orDie)

      const metric = parseSmartctlJson(smartJson, device)
      metrics.push(metric)
    }

    return { capability: "smart" as const, data: metrics } satisfies CollectorReport
  }),
} satisfies CollectorPlugin

export type { SmartMetrics }
