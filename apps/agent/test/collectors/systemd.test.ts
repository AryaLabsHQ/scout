import { describe, expect, it } from "vitest"
import { parseSystemctlListUnits, parseSystemctlShow } from "../../src/collectors/systemd.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SYSTEMCTL_LIST_UNITS_JSON = JSON.stringify([
  {
    unit: "nginx.service",
    load: "loaded",
    active: "active",
    sub: "running",
    description: "A high performance web server",
  },
  {
    unit: "postgresql.service",
    load: "loaded",
    active: "active",
    sub: "running",
    description: "PostgreSQL Database Server",
  },
  {
    unit: "ssh.service",
    load: "loaded",
    active: "inactive",
    sub: "dead",
    description: "OpenBSD Secure Shell server",
  },
  {
    unit: "failed.service",
    load: "loaded",
    active: "failed",
    sub: "failed",
    description: "A service that failed to start",
  },
  {
    unit: "missing.service",
    load: "not-found",
    active: "inactive",
    sub: "dead",
    description: "Not Found",
  },
])

const SYSTEMCTL_SHOW_ACTIVE = `MainPID=1234
MemoryCurrent=67108864
CPUUsageNSec=1234567890
`

const SYSTEMCTL_SHOW_NO_PID = `MainPID=0
MemoryCurrent=0
CPUUsageNSec=0
`

const SYSTEMCTL_SHOW_MEM_NOT_SET = `MainPID=5678
MemoryCurrent=[not set]
CPUUsageNSec=[not set]
`

const SYSTEMCTL_SHOW_HIGH_MEM = `MainPID=9999
MemoryCurrent=1073741824
CPUUsageNSec=9876543210
`

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseSystemctlListUnits", () => {
  it("parses all services from JSON output", () => {
    const result = parseSystemctlListUnits(SYSTEMCTL_LIST_UNITS_JSON)
    expect(result).toHaveLength(5)
  })

  it("maps unit, description, loadState, activeState, subState correctly", () => {
    const result = parseSystemctlListUnits(SYSTEMCTL_LIST_UNITS_JSON)
    const nginx = result.find(s => s.unit === "nginx.service")
    expect(nginx).toBeDefined()
    expect(nginx!.description).toBe("A high performance web server")
    expect(nginx!.loadState).toBe("loaded")
    expect(nginx!.activeState).toBe("active")
    expect(nginx!.subState).toBe("running")
  })

  it("sets pid, memoryBytes, cpuUsageNs to null (populated by show)", () => {
    const result = parseSystemctlListUnits(SYSTEMCTL_LIST_UNITS_JSON)
    for (const svc of result) {
      expect(svc.pid).toBeNull()
      expect(svc.memoryBytes).toBeNull()
      expect(svc.cpuUsageNs).toBeNull()
    }
  })

  it("maps inactive state correctly", () => {
    const result = parseSystemctlListUnits(SYSTEMCTL_LIST_UNITS_JSON)
    const ssh = result.find(s => s.unit === "ssh.service")
    expect(ssh!.activeState).toBe("inactive")
    expect(ssh!.subState).toBe("dead")
  })

  it("maps failed state correctly", () => {
    const result = parseSystemctlListUnits(SYSTEMCTL_LIST_UNITS_JSON)
    const failed = result.find(s => s.unit === "failed.service")
    expect(failed!.activeState).toBe("failed")
  })

  it("maps not-found load state correctly", () => {
    const result = parseSystemctlListUnits(SYSTEMCTL_LIST_UNITS_JSON)
    const missing = result.find(s => s.unit === "missing.service")
    expect(missing!.loadState).toBe("not-found")
  })

  it("returns empty array for invalid JSON", () => {
    expect(parseSystemctlListUnits("not json")).toEqual([])
    expect(parseSystemctlListUnits("{}")).toEqual([])
    expect(parseSystemctlListUnits("")).toEqual([])
  })
})

describe("parseSystemctlShow", () => {
  it("parses active service with PID and resources", () => {
    const result = parseSystemctlShow(SYSTEMCTL_SHOW_ACTIVE)
    expect(result.pid).toBe(1234)
    expect(result.memoryBytes).toBe(67108864)
    expect(result.cpuUsageNs).toBe(1234567890)
  })

  it("returns null pid when MainPID is 0", () => {
    const result = parseSystemctlShow(SYSTEMCTL_SHOW_NO_PID)
    expect(result.pid).toBeNull()
    // MemoryCurrent=0 is a valid number (0 bytes), but we treat 0 cpu as null
    expect(result.memoryBytes).toBe(0)
    expect(result.cpuUsageNs).toBeNull()
  })

  it("returns null for [not set] values", () => {
    const result = parseSystemctlShow(SYSTEMCTL_SHOW_MEM_NOT_SET)
    expect(result.pid).toBe(5678)
    expect(result.memoryBytes).toBeNull()
    expect(result.cpuUsageNs).toBeNull()
  })

  it("parses large memory and CPU values", () => {
    const result = parseSystemctlShow(SYSTEMCTL_SHOW_HIGH_MEM)
    expect(result.pid).toBe(9999)
    expect(result.memoryBytes).toBe(1073741824)
    expect(result.cpuUsageNs).toBe(9876543210)
  })

  it("returns all nulls for empty output", () => {
    const result = parseSystemctlShow("")
    expect(result.pid).toBeNull()
    expect(result.memoryBytes).toBeNull()
    expect(result.cpuUsageNs).toBeNull()
  })
})
