import { describe, expect, it } from "vitest"
import {
  parseProcStat,
  parseProcMeminfo,
  parseProcLoadavg,
  parseProcUptime,
  parseDiskUsage,
  parseProcDiskstats,
} from "../../src/collectors/system.js"

// ---------------------------------------------------------------------------
// CPU
// ---------------------------------------------------------------------------

const PROC_STAT_1 = `cpu  100 10 50 800 20 5 3 2 0 0
cpu0 50 5 25 400 10 3 1 1 0 0
cpu1 50 5 25 400 10 2 2 1 0 0
intr 12345
ctxt 67890
btime 1700000000
`

// Second reading: all fields incremented
// Δtotal = 100, Δidle = 80, Δuser = 10, Δnice = 0, Δsystem = 5, Δiowait = 5, Δsteal = 0
const PROC_STAT_2 = `cpu  110 10 55 880 25 5 3 2 0 0
cpu0 55 5 28 440 13 3 1 1 0 0
cpu1 55 5 27 440 12 2 2 1 0 0
intr 12345
ctxt 67890
btime 1700000000
`

describe("parseProcStat", () => {
  it("returns 0% usage on first call (no previous)", () => {
    const result = parseProcStat(PROC_STAT_1, null)
    expect(result.usage).toBe(0)
    expect(result.cores).toBe(2)
    expect(result.perCore).toHaveLength(2)
    expect(result.perCore[0]).toBe(0)
    expect(result.breakdown.idle).toBe(100)
  })

  it("calculates aggregate CPU usage between two readings", () => {
    const result = parseProcStat(PROC_STAT_2, PROC_STAT_1)
    // cpu1→2: total delta = (110+10+55+880+25+5+3+2) - (100+10+50+800+20+5+3+2) = 1090 - 990 = 100
    // idle delta = 880 - 800 = 80
    // usage = (100 - 80) / 100 * 100 = 20%
    expect(result.usage).toBeCloseTo(20, 1)
    expect(result.cores).toBe(2)
  })

  it("calculates per-core usage", () => {
    const result = parseProcStat(PROC_STAT_2, PROC_STAT_1)
    expect(result.perCore).toHaveLength(2)
    // core0: total delta = (55+5+28+440+13+3+1+1) - (50+5+25+400+10+3+1+1) = 546-495=51, idle=440-400=40, usage=(51-40)/51=~21.6%
    expect(result.perCore[0]).toBeGreaterThan(0)
    expect(result.perCore[1]).toBeGreaterThan(0)
  })

  it("breakdown values sum to approximately 100", () => {
    const result = parseProcStat(PROC_STAT_2, PROC_STAT_1)
    const { user, system, iowait, steal, idle } = result.breakdown
    const sum = user + system + iowait + steal + idle
    expect(sum).toBeCloseTo(100, 0)
  })

  it("handles zero delta gracefully", () => {
    const result = parseProcStat(PROC_STAT_1, PROC_STAT_1)
    expect(result.usage).toBe(0)
    expect(result.breakdown.idle).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

const PROC_MEMINFO = `MemTotal:       16384000 kB
MemFree:         1234567 kB
MemAvailable:   12345678 kB
Buffers:          234567 kB
Cached:          3456789 kB
SwapCached:           0 kB
SwapTotal:       8192000 kB
SwapFree:        7654321 kB
Shmem:            123456 kB
SReclaimable:    1234567 kB
`

describe("parseProcMeminfo", () => {
  it("converts kB to bytes correctly", () => {
    const result = parseProcMeminfo(PROC_MEMINFO)
    expect(result.total).toBe(16384000 * 1024)
    expect(result.available).toBe(12345678 * 1024)
  })

  it("calculates used = total - available", () => {
    const result = parseProcMeminfo(PROC_MEMINFO)
    expect(result.used).toBe(result.total - result.available)
  })

  it("calculates buffersCache = buffers + cached", () => {
    const result = parseProcMeminfo(PROC_MEMINFO)
    expect(result.buffersCache).toBe((234567 + 3456789) * 1024)
  })

  it("calculates swap used = swapTotal - swapFree", () => {
    const result = parseProcMeminfo(PROC_MEMINFO)
    expect(result.swap.total).toBe(8192000 * 1024)
    expect(result.swap.used).toBe((8192000 - 7654321) * 1024)
  })

  it("handles missing swap entries gracefully", () => {
    const result = parseProcMeminfo("MemTotal: 1024000 kB\nMemFree: 512000 kB\nMemAvailable: 512000 kB\n")
    expect(result.swap.total).toBe(0)
    expect(result.swap.used).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Load average
// ---------------------------------------------------------------------------

describe("parseProcLoadavg", () => {
  it("parses 1m, 5m, 15m load averages", () => {
    const result = parseProcLoadavg("0.25 0.15 0.10 1/234 5678\n")
    expect(result).toEqual([0.25, 0.15, 0.10])
  })

  it("handles high load", () => {
    const result = parseProcLoadavg("12.50 8.32 5.11 3/456 1234\n")
    expect(result[0]).toBeCloseTo(12.50)
    expect(result[1]).toBeCloseTo(8.32)
    expect(result[2]).toBeCloseTo(5.11)
  })
})

// ---------------------------------------------------------------------------
// Uptime
// ---------------------------------------------------------------------------

describe("parseProcUptime", () => {
  it("parses uptime seconds", () => {
    expect(parseProcUptime("12345.67 23456.78\n")).toBeCloseTo(12345.67)
  })

  it("parses large uptime", () => {
    expect(parseProcUptime("1234567.89 2345678.90\n")).toBeCloseTo(1234567.89)
  })
})

// ---------------------------------------------------------------------------
// Disk usage
// ---------------------------------------------------------------------------

// The df --output=target,source,fstype,size,used format
const DF_VALID = `Mounted on      Source          Type        Size         Used
/               /dev/sda1       ext4        100000000000 50000000000
/home           /dev/sda2       ext4        200000000000 100000000000
/dev/shm        tmpfs           tmpfs       8000000000   100000000
/snap/core      /dev/loop0      squashfs    500000000    500000000
/data           /dev/nvme0n1p3  ext4        500000000000 250000000000
`

describe("parseDiskUsage", () => {
  it("parses real disk entries", () => {
    const results = parseDiskUsage(DF_VALID)
    const mounts = results.map(d => d.mount)
    expect(mounts).toContain("/")
    expect(mounts).toContain("/home")
    expect(mounts).toContain("/data")
  })

  it("excludes tmpfs and virtual filesystems", () => {
    const results = parseDiskUsage(DF_VALID)
    const mounts = results.map(d => d.mount)
    expect(mounts).not.toContain("/dev/shm")
  })

  it("excludes loop devices", () => {
    const results = parseDiskUsage(DF_VALID)
    const devices = results.map(d => d.device)
    expect(devices.every(d => !d.startsWith("/dev/loop"))).toBe(true)
  })

  it("maps bytes correctly", () => {
    const results = parseDiskUsage(DF_VALID)
    const root = results.find(d => d.mount === "/")
    expect(root?.total).toBe(100000000000)
    expect(root?.used).toBe(50000000000)
  })

  it("sets I/O rates to 0 (filled later by diskstats)", () => {
    const results = parseDiskUsage(DF_VALID)
    for (const d of results) {
      expect(d.readBytesPerSec).toBe(0)
      expect(d.writeBytesPerSec).toBe(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Disk I/O
// ---------------------------------------------------------------------------

const DISKSTATS_1 = `   8       0 sda 12345 6789 100000 0 54321 12345 200000 0 0 0 0 0 0 0 0 0 0
   8       1 sda1 12345 6789 50000 0 54321 12345 100000 0 0 0 0 0 0 0 0 0 0
   7       0 loop0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
 253       0 dm-0 12345 0 80000 0 54321 0 160000 0 0 0 0 0 0 0 0 0 0
`

const DISKSTATS_2 = `   8       0 sda 12400 6789 110000 0 54400 12345 220000 0 0 0 0 0 0 0 0 0 0
   8       1 sda1 12400 6789 60000 0 54400 12345 110000 0 0 0 0 0 0 0 0 0 0
   7       0 loop0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
 253       0 dm-0 12400 0 90000 0 54400 0 170000 0 0 0 0 0 0 0 0 0 0
`

describe("parseProcDiskstats", () => {
  it("returns empty map on first call (no previous)", () => {
    const result = parseProcDiskstats(DISKSTATS_1, null, 1000)
    expect(result.size).toBe(0)
  })

  it("calculates bytes/sec for each device", () => {
    // 1000ms interval
    // sda: readSectors: 110000 - 100000 = 10000, * 512 = 5120000 bytes in 1s = 5120000 B/s
    // sda: writeSectors: 220000 - 200000 = 20000, * 512 = 10240000 bytes in 1s = 10240000 B/s
    const result = parseProcDiskstats(DISKSTATS_2, DISKSTATS_1, 1000)

    const sda = result.get("sda")
    expect(sda).toBeDefined()
    expect(sda!.read).toBeCloseTo(5120000, -2)
    expect(sda!.write).toBeCloseTo(10240000, -2)
  })

  it("excludes loop devices", () => {
    const result = parseProcDiskstats(DISKSTATS_2, DISKSTATS_1, 1000)
    expect(result.has("loop0")).toBe(false)
  })

  it("handles devices with no previous entry", () => {
    const newDev = DISKSTATS_2 + "   8       2 sdb 100 0 200 0 100 0 200 0 0 0 0 0 0 0 0 0 0\n"
    const result = parseProcDiskstats(newDev, DISKSTATS_1, 1000)
    // sdb not in prev, should not appear
    expect(result.has("sdb")).toBe(false)
  })

  it("does not produce negative rates on counter wrap-around avoidance", () => {
    const result = parseProcDiskstats(DISKSTATS_2, DISKSTATS_1, 1000)
    for (const { read, write } of result.values()) {
      expect(read).toBeGreaterThanOrEqual(0)
      expect(write).toBeGreaterThanOrEqual(0)
    }
  })
})
