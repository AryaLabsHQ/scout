import { Effect } from "effect"
import type { CollectorPlugin, CollectorReport, NetworkInterfaceMetrics } from "@scout/shared"

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _prevNetDevContent: string | null = null
let _prevNetDevTimestamp: number = 0

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface NetDevEntry {
  name: string
  rxBytes: number
  txBytes: number
  rxPackets: number
  txPackets: number
}

function parseNetDevLine(line: string): NetDevEntry | null {
  // Format: "  eth0: 12345 678 0 0 0 0 0 0 98765 432 0 0 0 0 0 0"
  const colonIdx = line.indexOf(":")
  if (colonIdx === -1) return null

  const name = line.slice(0, colonIdx).trim()
  const fields = line.slice(colonIdx + 1).trim().split(/\s+/)

  if (fields.length < 10) return null

  return {
    name,
    rxBytes: Number(fields[0] ?? 0),
    rxPackets: Number(fields[1] ?? 0),
    txBytes: Number(fields[8] ?? 0),
    txPackets: Number(fields[9] ?? 0),
  }
}

function parseNetDevContent(content: string): Map<string, NetDevEntry> {
  const map = new Map<string, NetDevEntry>()
  // Skip first 2 header lines
  const lines = content.split("\n").slice(2)
  for (const line of lines) {
    if (!line.trim()) continue
    const entry = parseNetDevLine(line)
    if (entry) map.set(entry.name, entry)
  }
  return map
}

/**
 * Pure parser for /proc/net/dev.
 * Returns per-interface rates. On first call (previous = null), rates are 0.
 * intervalSec: elapsed seconds between the two readings.
 */
export function parseProcNetDev(
  current: string,
  previous: string | null,
  intervalSec: number,
): NetworkInterfaceMetrics[] {
  const currMap = parseNetDevContent(current)

  if (!previous || intervalSec <= 0) {
    return Array.from(currMap.values()).map(e => ({
      name: e.name,
      rxBytesPerSec: 0,
      txBytesPerSec: 0,
      rxPacketsPerSec: 0,
      txPacketsPerSec: 0,
    }))
  }

  const prevMap = parseNetDevContent(previous)
  const results: NetworkInterfaceMetrics[] = []

  for (const [name, curr] of currMap) {
    const prev = prevMap.get(name)
    if (!prev) {
      results.push({ name, rxBytesPerSec: 0, txBytesPerSec: 0, rxPacketsPerSec: 0, txPacketsPerSec: 0 })
      continue
    }

    results.push({
      name,
      rxBytesPerSec: Math.max(0, (curr.rxBytes - prev.rxBytes) / intervalSec),
      txBytesPerSec: Math.max(0, (curr.txBytes - prev.txBytes) / intervalSec),
      rxPacketsPerSec: Math.max(0, (curr.rxPackets - prev.rxPackets) / intervalSec),
      txPacketsPerSec: Math.max(0, (curr.txPackets - prev.txPackets) / intervalSec),
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// I/O helper
// ---------------------------------------------------------------------------

const readFile = (path: string): Effect.Effect<string> =>
  Effect.tryPromise({
    try: () => Bun.file(path).text(),
    catch: (e) => new Error(`Failed to read ${path}: ${String(e)}`),
  }).pipe(Effect.orDie)

// ---------------------------------------------------------------------------
// CollectorPlugin
// ---------------------------------------------------------------------------

export const networkCollector: CollectorPlugin = {
  name: "network",
  capability: "network",
  detect: Effect.succeed(true),
  collect: Effect.gen(function* () {
    const now = Date.now()
    const content = yield* readFile("/proc/net/dev")

    const intervalSec = _prevNetDevTimestamp > 0
      ? (now - _prevNetDevTimestamp) / 1000
      : 0

    const interfaces = parseProcNetDev(content, _prevNetDevContent, intervalSec)

    _prevNetDevContent = content
    _prevNetDevTimestamp = now

    return {
      capability: "network" as const,
      data: interfaces,
    } satisfies CollectorReport
  }),
}

export type { NetworkInterfaceMetrics }
