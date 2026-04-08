import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import {
  decodeActionRequest,
  decodeEntitySnapshot,
  decodePluginManifest,
  decodePluginUiScreen,
  PluginExecutionError,
} from "../src/index.js"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

describe("@scout/plugin-sdk schemas", () => {
  it("decodes a valid plugin manifest", async () => {
    const manifest = await run(
      decodePluginManifest({
        apiVersion: "v0alpha1",
        id: "systemd",
        displayName: "systemd",
        version: "0.1.0",
        description: "Manage and observe systemd units",
        permissions: ["node:systemd", "node:stream-logs"],
        capabilities: [
          {
            id: "units",
            displayName: "Units",
          },
        ],
        entityKinds: [
          {
            id: "unit",
            displayName: "Unit",
            pluralDisplayName: "Units",
          },
        ],
        metrics: [
          {
            id: "unit.cpuUsageNs",
            displayName: "CPU Usage",
            kind: "gauge",
            entityKinds: ["unit"],
            unit: "ns",
          },
        ],
        actions: [
          {
            id: "restart",
            displayName: "Restart Unit",
            targetKinds: ["unit"],
            permissions: ["node:systemd"],
            requiresConfirmation: true,
          },
        ],
        streams: [
          {
            id: "journal",
            displayName: "Journal",
            kind: "logs",
            targetKinds: ["unit"],
            permissions: ["node:stream-logs"],
          },
        ],
        alerts: [
          {
            id: "unit.failed",
            displayName: "Unit Failed",
            severity: "critical",
            entityKinds: ["unit"],
          },
        ],
      }),
    )

    expect(manifest.id).toBe("systemd")
    expect(manifest.permissions).toContain("node:systemd")
    expect(manifest.actions[0]?.id).toBe("restart")
  })

  it("rejects invalid plugin permissions in manifests", async () => {
    await expect(
      run(
        decodePluginManifest({
          apiVersion: "v0alpha1",
          id: "broken",
          displayName: "broken",
          version: "0.1.0",
          description: "Invalid permission example",
          permissions: ["node:root"],
          capabilities: [],
          entityKinds: [],
          metrics: [],
          actions: [],
          streams: [],
          alerts: [],
        }),
      ),
    ).rejects.toThrow()
  })

  it("decodes representative runtime payloads", async () => {
    const entity = await run(
      decodeEntitySnapshot({
        ref: {
          pluginId: "docker",
          kind: "container",
          nodeId: "node-1",
          id: "abc123",
        },
        ts: 1_712_345_678_901,
        displayName: "nginx",
        status: "running",
        labels: {
          app: "edge",
        },
      }),
    )

    const actionRequest = await run(
      decodeActionRequest({
        pluginId: "docker",
        actionId: "restart",
        target: {
          nodeId: "node-1",
          entity: entity.ref,
        },
        input: {
          force: true,
        },
      }),
    )

    expect(actionRequest.target.entity?.kind).toBe("container")
    expect(entity.labels?.app).toBe("edge")
  })

  it("decodes plugin ui screens", async () => {
    const screen = await run(
      decodePluginUiScreen({
        id: "docker.overview",
        pluginId: "docker",
        kind: "overview",
        title: "Docker",
        spec: {
          root: "page",
          elements: {
            page: {
              type: "Page",
              props: {
                title: "Docker",
              },
              children: ["restart-button"],
            },
            "restart-button": {
              type: "Button",
              props: {
                label: "Restart",
              },
              on: {
                press: {
                  action: "plugin.runAction",
                  params: {
                    pluginId: "docker",
                    actionId: "restart",
                  },
                },
              },
            },
          },
        },
      }),
    )

    expect(screen.spec.root).toBe("page")
    expect(screen.kind).toBe("overview")
    expect(screen.spec.elements["restart-button"]?.on?.press).toBeDefined()
  })

  it("creates typed plugin execution errors", () => {
    const error = new PluginExecutionError({
      code: "permission-denied",
      message: "Plugin lacks node:docker-socket",
      pluginId: "docker",
      actionId: "inspect",
    })

    expect(error.code).toBe("permission-denied")
    expect(error.pluginId).toBe("docker")
  })
})
