import { describe, expect, it } from "vitest"
import { parseProcNetDev } from "../../src/collectors/network.js"

// ---------------------------------------------------------------------------
// Sample /proc/net/dev content
// ---------------------------------------------------------------------------

const NET_DEV_1 = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1000000    5000    0    0    0     0          0         0  1000000    5000    0    0    0     0       0          0
  eth0: 50000000  400000    0    0    0     0          0         0 30000000  300000    0    0    0     0       0          0
  eth1: 10000000   80000    0    0    0     0          0         0  5000000   40000    0    0    0     0       0          0
`

const NET_DEV_2 = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1010000    5010    0    0    0     0          0         0  1010000    5010    0    0    0     0       0          0
  eth0: 55000000  405000    0    0    0     0          0         0 33000000  303000    0    0    0     0       0          0
  eth1: 10500000   80500    0    0    0     0          0         0  5200000   40200    0    0    0     0       0          0
`

describe("parseProcNetDev", () => {
  it("returns zero rates on first call (no previous)", () => {
    const result = parseProcNetDev(NET_DEV_1, null, 0)
    expect(result).toHaveLength(3)
    for (const iface of result) {
      expect(iface.rxBytesPerSec).toBe(0)
      expect(iface.txBytesPerSec).toBe(0)
      expect(iface.rxPacketsPerSec).toBe(0)
      expect(iface.txPacketsPerSec).toBe(0)
    }
  })

  it("reports all interfaces from first reading", () => {
    const result = parseProcNetDev(NET_DEV_1, null, 0)
    const names = result.map((i) => i.name)
    expect(names).toContain("lo")
    expect(names).toContain("eth0")
    expect(names).toContain("eth1")
  })

  it("calculates correct per-second rates for all interfaces", () => {
    // 10 second interval
    const result = parseProcNetDev(NET_DEV_2, NET_DEV_1, 10)

    const eth0 = result.find((i) => i.name === "eth0")
    expect(eth0).toBeDefined()
    // rx: (55000000 - 50000000) / 10 = 500000 B/s
    expect(eth0!.rxBytesPerSec).toBeCloseTo(500000, 0)
    // tx: (33000000 - 30000000) / 10 = 300000 B/s
    expect(eth0!.txBytesPerSec).toBeCloseTo(300000, 0)
    // rx packets: (405000 - 400000) / 10 = 500 pkt/s
    expect(eth0!.rxPacketsPerSec).toBeCloseTo(500, 0)
    // tx packets: (303000 - 300000) / 10 = 300 pkt/s
    expect(eth0!.txPacketsPerSec).toBeCloseTo(300, 0)
  })

  it("calculates rates for multiple interfaces independently", () => {
    const result = parseProcNetDev(NET_DEV_2, NET_DEV_1, 10)

    const eth1 = result.find((i) => i.name === "eth1")
    expect(eth1).toBeDefined()
    // rx: (10500000 - 10000000) / 10 = 50000 B/s
    expect(eth1!.rxBytesPerSec).toBeCloseTo(50000, 0)
    // tx: (5200000 - 5000000) / 10 = 20000 B/s
    expect(eth1!.txBytesPerSec).toBeCloseTo(20000, 0)
  })

  it("calculates loopback rates", () => {
    const result = parseProcNetDev(NET_DEV_2, NET_DEV_1, 10)
    const lo = result.find((i) => i.name === "lo")
    expect(lo).toBeDefined()
    // rx: (1010000 - 1000000) / 10 = 1000 B/s
    expect(lo!.rxBytesPerSec).toBeCloseTo(1000, 0)
  })

  it("does not produce negative rates", () => {
    const result = parseProcNetDev(NET_DEV_2, NET_DEV_1, 10)
    for (const iface of result) {
      expect(iface.rxBytesPerSec).toBeGreaterThanOrEqual(0)
      expect(iface.txBytesPerSec).toBeGreaterThanOrEqual(0)
    }
  })

  it("handles new interface not in previous reading", () => {
    const net2WithExtra =
      NET_DEV_2 +
      `tailscale0: 2000000   10000    0    0    0     0          0         0  1000000    5000    0    0    0     0       0          0\n`
    const result = parseProcNetDev(net2WithExtra, NET_DEV_1, 10)

    const tailscale = result.find((i) => i.name === "tailscale0")
    expect(tailscale).toBeDefined()
    // No previous data → rates are 0
    expect(tailscale!.rxBytesPerSec).toBe(0)
    expect(tailscale!.txBytesPerSec).toBe(0)
  })
})
