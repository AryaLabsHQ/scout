import { Effect } from "effect"
import fs from "node:fs"
import type { CollectorPlugin, CollectorReport, DockerContainerMetrics } from "@scout/shared"

// ---------------------------------------------------------------------------
// Docker API types (internal)
// ---------------------------------------------------------------------------

interface DockerContainerListEntry {
  Id: string
  Names: string[]
  Image: string
  State: string
  Status: string
  Created: number
}

interface DockerStatsResponse {
  cpu_stats: {
    cpu_usage: { total_usage: number }
    system_cpu_usage: number
    online_cpus?: number
  }
  precpu_stats: {
    cpu_usage: { total_usage: number }
    system_cpu_usage: number
  }
  memory_stats: {
    usage?: number
    limit?: number
  }
  networks?: Record<string, { rx_bytes: number; tx_bytes: number }>
  blkio_stats?: {
    io_service_bytes_recursive?: Array<{ op: string; value: number }>
  }
}

// ---------------------------------------------------------------------------
// I/O helper — Docker Unix socket fetch
// ---------------------------------------------------------------------------

const dockerFetch = (path: string): Effect.Effect<string> =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(`http://localhost${path}`, {
        unix: "/var/run/docker.sock",
      } as RequestInit)
      return res.text()
    },
    catch: (e) => new Error(`Docker API ${path} failed: ${String(e)}`),
  }).pipe(Effect.orDie)

// ---------------------------------------------------------------------------
// Pure parsers
// ---------------------------------------------------------------------------

/**
 * Parse Docker `GET /containers/json?all=true` response.
 */
export function parseContainerList(json: string): Array<{
  id: string
  name: string
  image: string
  state: string
  status: string
  created: number
}> {
  let parsed: DockerContainerListEntry[]
  try {
    parsed = JSON.parse(json) as DockerContainerListEntry[]
    if (!Array.isArray(parsed)) return []
  } catch {
    return []
  }

  return parsed.map(c => ({
    id: c.Id,
    name: (c.Names[0] ?? "").replace(/^\//, ""),
    image: c.Image,
    state: c.State,
    status: c.Status,
    created: c.Created,
  }))
}

/**
 * Parse Docker `GET /containers/{id}/stats?stream=false` response.
 * Returns CPU%, memory, network, and block I/O.
 */
export function parseContainerStats(json: string): {
  cpuPercent: number
  memUsed: number
  memLimit: number
  netRx: number
  netTx: number
  blockRead: number
  blockWrite: number
} {
  let parsed: DockerStatsResponse
  try {
    parsed = JSON.parse(json) as DockerStatsResponse
  } catch {
    return { cpuPercent: 0, memUsed: 0, memLimit: 0, netRx: 0, netTx: 0, blockRead: 0, blockWrite: 0 }
  }

  // CPU%: (containerDelta / systemDelta) * numCPUs * 100
  const cpuDelta =
    (parsed.cpu_stats?.cpu_usage?.total_usage ?? 0) -
    (parsed.precpu_stats?.cpu_usage?.total_usage ?? 0)
  const systemDelta =
    (parsed.cpu_stats?.system_cpu_usage ?? 0) -
    (parsed.precpu_stats?.system_cpu_usage ?? 0)
  const numCPUs = parsed.cpu_stats?.online_cpus ?? 1
  const cpuPercent =
    systemDelta > 0 ? (cpuDelta / systemDelta) * numCPUs * 100 : 0

  const memUsed = parsed.memory_stats?.usage ?? 0
  const memLimit = parsed.memory_stats?.limit ?? 0

  // Sum all network interfaces
  let netRx = 0
  let netTx = 0
  if (parsed.networks) {
    for (const iface of Object.values(parsed.networks)) {
      netRx += iface.rx_bytes ?? 0
      netTx += iface.tx_bytes ?? 0
    }
  }

  // Block I/O
  let blockRead = 0
  let blockWrite = 0
  const blkio = parsed.blkio_stats?.io_service_bytes_recursive ?? []
  for (const entry of blkio) {
    if (entry.op?.toLowerCase() === "read") blockRead += entry.value ?? 0
    else if (entry.op?.toLowerCase() === "write") blockWrite += entry.value ?? 0
  }

  return { cpuPercent, memUsed, memLimit, netRx, netTx, blockRead, blockWrite }
}

/**
 * Merge a container list entry with its stats into DockerContainerMetrics.
 */
export function mergeContainerMetrics(
  container: {
    id: string
    name: string
    image: string
    state: string
    status: string
    created: number
  },
  stats: {
    cpuPercent: number
    memUsed: number
    memLimit: number
    netRx: number
    netTx: number
    blockRead: number
    blockWrite: number
  },
): DockerContainerMetrics {
  const nowSec = Math.floor(Date.now() / 1000)
  return {
    id: container.id,
    name: container.name,
    image: container.image,
    status: container.status,
    state: normalizeState(container.state),
    cpuPercent: stats.cpuPercent,
    memUsed: stats.memUsed,
    memLimit: stats.memLimit,
    netRx: stats.netRx,
    netTx: stats.netTx,
    blockRead: stats.blockRead,
    blockWrite: stats.blockWrite,
    uptime: Math.max(0, nowSec - container.created),
  }
}

function normalizeState(s: string): DockerContainerMetrics["state"] {
  switch (s) {
    case "running": return "running"
    case "exited": return "exited"
    case "paused": return "paused"
    case "restarting": return "restarting"
    case "dead": return "dead"
    case "created": return "created"
    default: return "exited"
  }
}

// ---------------------------------------------------------------------------
// CollectorPlugin
// ---------------------------------------------------------------------------

export const dockerCollector: CollectorPlugin = {
  name: "docker",
  capability: "docker",
  detect: Effect.sync(() => fs.existsSync("/var/run/docker.sock")),
  collect: Effect.gen(function* () {
    const listJson = yield* dockerFetch("/containers/json?all=true")
    const containers = parseContainerList(listJson)

    const metrics: DockerContainerMetrics[] = []

    for (const container of containers) {
      let stats = {
        cpuPercent: 0,
        memUsed: 0,
        memLimit: 0,
        netRx: 0,
        netTx: 0,
        blockRead: 0,
        blockWrite: 0,
      }

      if (container.state === "running") {
        const statsJson = yield* dockerFetch(
          `/containers/${container.id}/stats?stream=false`,
        ).pipe(Effect.orElseSucceed(() => "{}"))
        stats = parseContainerStats(statsJson)
      }

      metrics.push(mergeContainerMetrics(container, stats))
    }

    return { capability: "docker" as const, data: metrics } satisfies CollectorReport
  }),
} satisfies CollectorPlugin

export type { DockerContainerMetrics }
