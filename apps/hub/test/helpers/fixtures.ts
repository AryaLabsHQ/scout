import type { AgentReport } from "@scout/shared"

export function makeAgentReport(overrides?: Partial<AgentReport>): AgentReport {
  return {
    systemId: "test-system-01",
    timestamp: Date.now(),
    system: {
      cpu: {
        usage: 42.5,
        cores: 4,
        perCore: [40, 45, 41, 44],
        breakdown: { user: 30, system: 10, iowait: 2, steal: 0, idle: 58 },
      },
      memory: {
        used: 4_000_000_000,
        total: 8_000_000_000,
        available: 4_000_000_000,
        buffersCache: 500_000_000,
        swap: { used: 0, total: 2_000_000_000 },
      },
      disks: [
        {
          mount: "/",
          device: "/dev/sda1",
          used: 50_000_000_000,
          total: 100_000_000_000,
          readBytesPerSec: 1024,
          writeBytesPerSec: 2048,
        },
      ],
      loadAvg: [1.0, 1.5, 2.0],
      uptime: 86400,
    },
    network: [
      {
        name: "eth0",
        rxBytesPerSec: 1000,
        txBytesPerSec: 500,
        rxPacketsPerSec: 10,
        txPacketsPerSec: 5,
      },
    ],
    ...overrides,
  }
}
