import { Effect } from "effect"
import type { CollectorPlugin, CollectorReport, ProcessMetrics } from "@scout/shared"

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Pure parser for `ps aux` output.
 * Columns: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
 */
export function parsePsOutput(output: string): ProcessMetrics[] {
  const lines = output.split("\n")
  // Skip header (first line)
  const dataLines = lines.slice(1).filter(l => l.trim().length > 0)

  const results: ProcessMetrics[] = []

  for (const line of dataLines) {
    // ps aux columns are space-separated; COMMAND (last col) may contain spaces
    const parts = line.trim().split(/\s+/)
    if (parts.length < 11) continue

    const user = parts[0] ?? ""
    const pid = Number(parts[1] ?? 0)
    const cpuPercent = Number(parts[2] ?? 0)
    const memPercent = Number(parts[3] ?? 0)
    // VSZ is in kB, RSS is in kB
    const memBytes = Number(parts[5] ?? 0) * 1024 // RSS kB → bytes
    const name = parts[10] ?? ""

    if (isNaN(pid) || pid <= 0) continue

    results.push({ pid, name, cpuPercent, memPercent, memBytes, user })
  }

  return results
}

// ---------------------------------------------------------------------------
// I/O helper
// ---------------------------------------------------------------------------

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

export const processCollector: CollectorPlugin = {
  name: "process",
  capability: "process",
  detect: Effect.succeed(true),
  collect: Effect.gen(function* () {
    // Run both sorts concurrently and merge (top 20 by CPU + top 20 by memory)
    const [byCpu, byMem] = yield* Effect.all([
      spawnText(["ps", "aux", "--sort=-pcpu"]).pipe(
        Effect.map(out => parsePsOutput(out).slice(0, 20)),
      ),
      spawnText(["ps", "aux", "--sort=-rss"]).pipe(
        Effect.map(out => parsePsOutput(out).slice(0, 20)),
      ),
    ])

    // Merge by PID, deduplicate
    const seen = new Set<number>()
    const merged: ProcessMetrics[] = []

    for (const p of [...byCpu, ...byMem]) {
      if (!seen.has(p.pid)) {
        seen.add(p.pid)
        merged.push(p)
      }
    }

    return {
      capability: "process" as const,
      data: merged,
    } satisfies CollectorReport
  }),
}

export type { ProcessMetrics }
