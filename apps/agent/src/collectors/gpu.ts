import { Effect } from "effect"
import type { CollectorPlugin, CollectorReport, GpuMetrics } from "@scout/shared"

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

/**
 * Parse `nvidia-smi --query-gpu=name,index,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits`
 * Each line: name, index, usage%, memUsedMB, memTotalMB, tempC, powerW
 */
export function parseNvidiaSmiOutput(csv: string): GpuMetrics[] {
  const results: GpuMetrics[] = []
  for (const line of csv.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const parts = trimmed.split(",").map(p => p.trim())
    if (parts.length < 7) continue

    const [name, indexStr, usageStr, memUsedStr, memTotalStr, tempStr, powerStr] = parts as [
      string, string, string, string, string, string, string
    ]

    const index = Number(indexStr)
    const usage = Number(usageStr)
    const memUsedMB = Number(memUsedStr)
    const memTotalMB = Number(memTotalStr)
    const temperature = Number(tempStr)
    const powerWatts = Number(powerStr)

    // Skip malformed lines
    if (
      !name ||
      isNaN(index) || isNaN(usage) ||
      isNaN(memUsedMB) || isNaN(memTotalMB) ||
      isNaN(temperature) || isNaN(powerWatts)
    ) {
      continue
    }

    results.push({
      name,
      index,
      usage,
      memUsed: memUsedMB * 1024 * 1024,
      memTotal: memTotalMB * 1024 * 1024,
      temperature,
      powerWatts,
    })
  }
  return results
}

// ---------------------------------------------------------------------------
// CollectorPlugin
// ---------------------------------------------------------------------------

export const gpuCollector: CollectorPlugin = {
  name: "gpu",
  capability: "gpu",
  detect: Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["which", "nvidia-smi"], { stdout: "pipe", stderr: "pipe" })
      await proc.exited
      return proc.exitCode === 0
    },
    catch: () => new Error("which nvidia-smi failed"),
  }).pipe(
    Effect.orElseSucceed(() => false),
  ),
  collect: Effect.gen(function* () {
    const output = yield* runCommand("nvidia-smi", [
      "--query-gpu=name,index,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
      "--format=csv,noheader,nounits",
    ])
    const data = parseNvidiaSmiOutput(output)
    return { capability: "gpu" as const, data } satisfies CollectorReport
  }),
} satisfies CollectorPlugin

export type { GpuMetrics }
