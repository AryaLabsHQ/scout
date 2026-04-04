import { describe, expect, it } from "vitest"
import { mergeContainerMetrics, parseContainerList, parseContainerStats } from "../../src/collectors/docker.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONTAINER_LIST_JSON = JSON.stringify([
  {
    Id: "abc123def456",
    Names: ["/my-nginx"],
    Image: "nginx:latest",
    State: "running",
    Status: "Up 3 hours",
    Created: 1700000000,
  },
  {
    Id: "fed654cba321",
    Names: ["/my-postgres"],
    Image: "postgres:15",
    State: "exited",
    Status: "Exited (0) 2 hours ago",
    Created: 1700003600,
  },
  {
    Id: "aaa111bbb222",
    Names: ["/redis"],
    Image: "redis:7-alpine",
    State: "running",
    Status: "Up 10 minutes",
    Created: 1700010000,
  },
])

const CONTAINER_STATS_JSON = JSON.stringify({
  cpu_stats: {
    cpu_usage: { total_usage: 1234567890 },
    system_cpu_usage: 9876543210,
    online_cpus: 4,
  },
  precpu_stats: {
    cpu_usage: { total_usage: 1234000000 },
    system_cpu_usage: 9876000000,
  },
  memory_stats: {
    usage: 67108864,
    limit: 8589934592,
  },
  networks: {
    eth0: { rx_bytes: 12345, tx_bytes: 67890 },
    eth1: { rx_bytes: 1000, tx_bytes: 2000 },
  },
  blkio_stats: {
    io_service_bytes_recursive: [
      { op: "read", value: 1234 },
      { op: "write", value: 5678 },
      { op: "sync", value: 100 },
    ],
  },
})

const STATS_NO_NETWORKS = JSON.stringify({
  cpu_stats: {
    cpu_usage: { total_usage: 500000000 },
    system_cpu_usage: 5000000000,
    online_cpus: 2,
  },
  precpu_stats: {
    cpu_usage: { total_usage: 400000000 },
    system_cpu_usage: 4000000000,
  },
  memory_stats: { usage: 10000000, limit: 1000000000 },
  // No networks field
  blkio_stats: { io_service_bytes_recursive: [] },
})

const STATS_EMPTY_BLKIO = JSON.stringify({
  cpu_stats: {
    cpu_usage: { total_usage: 100 },
    system_cpu_usage: 1000,
    online_cpus: 1,
  },
  precpu_stats: {
    cpu_usage: { total_usage: 50 },
    system_cpu_usage: 500,
  },
  memory_stats: { usage: 0, limit: 0 },
  networks: {},
  blkio_stats: { io_service_bytes_recursive: [] },
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseContainerList", () => {
  it("parses container names, states, and images", () => {
    const result = parseContainerList(CONTAINER_LIST_JSON)
    expect(result).toHaveLength(3)

    const nginx = result.find(c => c.id === "abc123def456")
    expect(nginx).toBeDefined()
    expect(nginx!.name).toBe("my-nginx") // leading slash stripped
    expect(nginx!.image).toBe("nginx:latest")
    expect(nginx!.state).toBe("running")
    expect(nginx!.status).toBe("Up 3 hours")
  })

  it("strips leading slash from container names", () => {
    const result = parseContainerList(CONTAINER_LIST_JSON)
    for (const c of result) {
      expect(c.name).not.toMatch(/^\//)
    }
  })

  it("returns correct state for exited container", () => {
    const result = parseContainerList(CONTAINER_LIST_JSON)
    const postgres = result.find(c => c.id === "fed654cba321")
    expect(postgres!.state).toBe("exited")
  })

  it("returns empty array for empty list", () => {
    expect(parseContainerList("[]")).toEqual([])
  })

  it("returns empty array for invalid JSON", () => {
    expect(parseContainerList("not json")).toEqual([])
    expect(parseContainerList("{}")).toEqual([])
  })
})

describe("parseContainerStats", () => {
  it("calculates CPU% from delta values", () => {
    const result = parseContainerStats(CONTAINER_STATS_JSON)
    // containerDelta = 1234567890 - 1234000000 = 567890
    // systemDelta = 9876543210 - 9876000000 = 543210
    // cpuPercent = (567890 / 543210) * 4 * 100 ≈ 418.2%
    expect(result.cpuPercent).toBeGreaterThan(0)
    expect(result.cpuPercent).toBeCloseTo((567890 / 543210) * 4 * 100, 0)
  })

  it("parses memory usage and limit", () => {
    const result = parseContainerStats(CONTAINER_STATS_JSON)
    expect(result.memUsed).toBe(67108864)
    expect(result.memLimit).toBe(8589934592)
  })

  it("sums all network interfaces for rx/tx", () => {
    const result = parseContainerStats(CONTAINER_STATS_JSON)
    expect(result.netRx).toBe(12345 + 1000)
    expect(result.netTx).toBe(67890 + 2000)
  })

  it("parses block I/O read and write", () => {
    const result = parseContainerStats(CONTAINER_STATS_JSON)
    expect(result.blockRead).toBe(1234)
    expect(result.blockWrite).toBe(5678)
  })

  it("returns 0 for netRx/netTx when networks field is absent", () => {
    const result = parseContainerStats(STATS_NO_NETWORKS)
    expect(result.netRx).toBe(0)
    expect(result.netTx).toBe(0)
  })

  it("returns 0 for block I/O when blkio is empty", () => {
    const result = parseContainerStats(STATS_EMPTY_BLKIO)
    expect(result.blockRead).toBe(0)
    expect(result.blockWrite).toBe(0)
  })

  it("returns zeros for invalid JSON", () => {
    const result = parseContainerStats("not json")
    expect(result.cpuPercent).toBe(0)
    expect(result.memUsed).toBe(0)
    expect(result.netRx).toBe(0)
    expect(result.blockRead).toBe(0)
  })

  it("returns 0 cpuPercent when system delta is 0", () => {
    const zeroSysDelta = JSON.stringify({
      cpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 1000,
        online_cpus: 1,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 50 },
        system_cpu_usage: 1000, // same as cpu_stats → delta = 0
      },
      memory_stats: { usage: 0, limit: 0 },
      blkio_stats: { io_service_bytes_recursive: [] },
    })
    const result = parseContainerStats(zeroSysDelta)
    expect(result.cpuPercent).toBe(0)
  })
})

describe("mergeContainerMetrics", () => {
  it("produces valid DockerContainerMetrics with correct state", () => {
    const container = {
      id: "abc123",
      name: "my-nginx",
      image: "nginx:latest",
      state: "running",
      status: "Up 3 hours",
      created: Math.floor(Date.now() / 1000) - 3600,
    }
    const stats = {
      cpuPercent: 5.2,
      memUsed: 10000000,
      memLimit: 1000000000,
      netRx: 1234,
      netTx: 5678,
      blockRead: 100,
      blockWrite: 200,
    }
    const result = mergeContainerMetrics(container, stats)
    expect(result.id).toBe("abc123")
    expect(result.name).toBe("my-nginx")
    expect(result.state).toBe("running")
    expect(result.cpuPercent).toBeCloseTo(5.2)
    expect(result.memUsed).toBe(10000000)
    expect(result.netRx).toBe(1234)
    expect(result.uptime).toBeGreaterThan(3500)
    expect(result.uptime).toBeLessThan(3700)
  })

  it("normalizes unknown state to exited", () => {
    const container = {
      id: "xyz",
      name: "c",
      image: "i",
      state: "totally-unknown",
      status: "???",
      created: Math.floor(Date.now() / 1000) - 10,
    }
    const stats = {
      cpuPercent: 0,
      memUsed: 0,
      memLimit: 0,
      netRx: 0,
      netTx: 0,
      blockRead: 0,
      blockWrite: 0,
    }
    const result = mergeContainerMetrics(container, stats)
    expect(result.state).toBe("exited")
  })
})
