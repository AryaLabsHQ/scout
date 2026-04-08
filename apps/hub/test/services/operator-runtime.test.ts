import { describe, expect, it } from "@effect/vitest"
import {
  formatMetricsSnapshot,
  formatPluginInventory,
  type PluginInventoryManifest,
  requiresOperatorApproval,
} from "../../src/services/operator-runtime.js"

describe("OperatorRuntime helpers", () => {
  it("formatMetricsSnapshot summarizes host metrics compactly", () => {
    const text = formatMetricsSnapshot([
      {
        systemId: "node-a",
        sample: {
          cpuPercent: 37.5,
          memoryPercent: 62.4,
          memoryUsedBytes: 8 * 1024 * 1024 * 1024,
          memoryTotalBytes: 16 * 1024 * 1024 * 1024,
          loadAvg1m: 1.42,
          diskPercent: 71.3,
          diskUsedBytes: 120 * 1024 * 1024 * 1024,
          diskTotalBytes: 200 * 1024 * 1024 * 1024,
          networkRxBytesPerSec: 2 * 1024 * 1024,
          networkTxBytesPerSec: 512 * 1024,
          gpuPercent: null,
          uptimeSeconds: 9 * 3600,
        },
      },
    ])

    expect(text).toContain("node-a")
    expect(text).toContain("cpu=37.5%")
    expect(text).toContain("mem=62.4%")
    expect(text).toContain("load1=1.42")
    expect(text).toContain("uptime=9h")
  })

  it("formatPluginInventory includes actions, streams, and recent activity counts", () => {
    const text = formatPluginInventory([
      {
        systemId: "node-a",
        pluginId: "docker",
        displayName: "Docker",
        actions: [
          {
            id: "restart-container",
            displayName: "Restart container",
            targetKinds: ["container"],
            permissions: ["node:spawn-process"],
            requiresConfirmation: true,
          },
        ],
        streams: [
          {
            id: "container-logs",
            displayName: "Container logs",
            kind: "logs",
            targetKinds: ["container"],
            permissions: ["node:stream-logs"],
          },
        ],
        entityCount: 12,
        recentMetricCount: 48,
        recentEventCount: 5,
      },
    ])

    expect(text).toContain("docker (Docker)")
    expect(text).toContain("actions=restart-container")
    expect(text).toContain("streams=container-logs")
    expect(text).toContain("recentMetrics=48")
    expect(text).toContain("recentEvents=5")
  })

  it("requiresOperatorApproval blocks mutating bash and plugin actions by default", () => {
    const manifests: ReadonlyMap<string, PluginInventoryManifest> = new Map([
      [
        "docker",
        {
          id: "docker",
          displayName: "Docker",
          actions: [
            {
              id: "inspect-container",
              displayName: "Inspect container",
              targetKinds: ["container"] as const,
              permissions: ["node:read-files"] as const,
              requiresConfirmation: false,
            },
            {
              id: "restart-container",
              displayName: "Restart container",
              targetKinds: ["container"] as const,
              permissions: ["node:spawn-process"] as const,
              requiresConfirmation: true,
            },
          ],
          streams: [] as const,
          metrics: [] as const,
          entityKinds: [] as const,
        },
      ],
    ])
    const pluginOperatorTools = new Map([
      ["docker.safe-restart", { requiresConfirmation: true }],
      ["docker.inspect", { requiresConfirmation: false }],
    ])

    expect(
      requiresOperatorApproval("bash.run", {
        nodeId: "node-a",
        isMutation: true,
        label: "Restart nginx",
      }, manifests, pluginOperatorTools),
    ).toEqual({ required: true, reason: "Restart nginx" })

    expect(
      requiresOperatorApproval("plugin.runAction", {
        nodeId: "node-a",
        pluginId: "docker",
        actionId: "inspect-container",
      }, manifests, pluginOperatorTools).required,
    ).toBe(false)

    expect(
      requiresOperatorApproval("plugin.runAction", {
        nodeId: "node-a",
        pluginId: "docker",
        actionId: "restart-container",
      }, manifests, pluginOperatorTools).required,
    ).toBe(true)

    expect(
      requiresOperatorApproval("plugin.runAction", {
        nodeId: "node-a",
        pluginId: "docker",
        actionId: "missing-action",
      }, manifests, pluginOperatorTools).required,
    ).toBe(false)

    expect(
      requiresOperatorApproval("docker.safe-restart", {}, manifests, pluginOperatorTools).required,
    ).toBe(true)

    expect(
      requiresOperatorApproval("docker.inspect", {}, manifests, pluginOperatorTools).required,
    ).toBe(false)
  })
})
