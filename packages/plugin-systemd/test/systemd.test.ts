import { Cause, Effect, Exit, Stream } from "effect"
import { describe, expect, it } from "vitest"
import {
  decodePluginUiScreen,
  executePluginAction,
  openPluginStream,
} from "@scout/plugin-sdk"
import {
  SYSTEMD_ACTION_IDS,
  SYSTEMD_PLUGIN_ID,
  SYSTEMD_STREAM_IDS,
  SYSTEMD_UNIT_KIND,
} from "../src/contracts.js"
import { manifest } from "../src/manifest.js"
import {
  createSystemdAgentPlugin,
  parseSystemctlListUnits,
  parseSystemctlShow,
  type SystemdDependencies,
} from "../src/systemd.js"
import { web } from "../src/web.js"

const makeDeps = (
  overrides: Partial<SystemdDependencies> = {},
): SystemdDependencies => ({
  exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
  readFile: () => Effect.succeed(""),
  copyFile: () => Effect.void,
  writeFile: () => Effect.void,
  unlink: () => Effect.void,
  makeTempPath: () => "/tmp/scout-systemd.test",
  followJournal: () =>
    Stream.fromIterable([
      { lines: ["line one", "line two"], ts: 123 },
    ]),
  ...overrides,
})

describe("systemd plugin", () => {
  it("parses list-units json output", () => {
    expect(
      parseSystemctlListUnits(
        JSON.stringify([
          {
            unit: "nginx.service",
            description: "NGINX",
            load: "loaded",
            active: "active",
            sub: "running",
          },
        ]),
      ),
    ).toEqual([
      {
        unit: "nginx.service",
        description: "NGINX",
        loadState: "loaded",
        activeState: "active",
        subState: "running",
        pid: null,
        memoryBytes: null,
        cpuUsageNs: null,
      },
    ])
  })

  it("parses systemctl show output", () => {
    expect(
      parseSystemctlShow("MainPID=55\nMemoryCurrent=4096\nCPUUsageNSec=9000\n"),
    ).toEqual({
      pid: 55,
      memoryBytes: 4096,
      cpuUsageNs: 9000,
    })
  })

  it("detects systemd availability", async () => {
    const plugin = createSystemdAgentPlugin(
      makeDeps({
        exec: (command) =>
          Effect.succeed({
            stdout: command === "which" ? "/usr/bin/systemctl\n" : "",
            stderr: "",
            exitCode: 0,
          }),
      }),
    )

    await expect(
      Effect.runPromise(plugin.detect({ nodeId: "n1", now: 1 })),
    ).resolves.toMatchObject({
      pluginId: SYSTEMD_PLUGIN_ID,
      status: "available",
    })
  })

  it("collects unit entities and metrics", async () => {
    const plugin = createSystemdAgentPlugin(
      makeDeps({
        exec: (command, args) => {
          if (command !== "systemctl") {
            return Effect.fail(new Error(`unexpected command: ${command}`))
          }
          if (args[0] === "list-units" && args.includes("--type=timer")) {
            return Effect.succeed({ stdout: "[]", stderr: "", exitCode: 0 })
          }
          if (args[0] === "list-units") {
            return Effect.succeed({
              stdout: JSON.stringify([
                {
                  unit: "nginx.service",
                  description: "NGINX",
                  load: "loaded",
                  active: "active",
                  sub: "running",
                },
                {
                  unit: "broken.service",
                  description: "Broken Unit",
                  load: "loaded",
                  active: "failed",
                  sub: "failed",
                },
              ]),
              stderr: "",
              exitCode: 0,
            })
          }
          if (args[0] === "show") {
            return Effect.succeed({
              stdout:
                "Id=nginx.service\nMainPID=101\nMemoryCurrent=8192\nCPUUsageNSec=500\n\n" +
                "Id=broken.service\nMainPID=0\nMemoryCurrent=[not set]\nCPUUsageNSec=[not set]\n",
              stderr: "",
              exitCode: 0,
            })
          }
          // No timers, and no user manager on this node.
          if (args[0] === "list-timers") return Effect.succeed({ stdout: "[]", stderr: "", exitCode: 0 })
          if (args[0] === "--user") {
            return Effect.succeed({ stdout: "", stderr: "Failed to connect to bus", exitCode: 1 })
          }
          return Effect.fail(new Error(`unexpected args: ${args.join(" ")}`))
        },
      }),
    )

    const result = await Effect.runPromise(
      plugin.collect!({ nodeId: "node-1", now: 42 }),
    )

    expect(result.entities).toHaveLength(2)
    expect(result.entities?.[0]).toMatchObject({
      ref: {
        pluginId: SYSTEMD_PLUGIN_ID,
        kind: SYSTEMD_UNIT_KIND,
        nodeId: "node-1",
        id: "nginx.service",
      },
      status: "active",
    })
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricId: "units.total", value: 2 }),
        expect.objectContaining({ metricId: "units.failed", value: 1 }),
        expect.objectContaining({ metricId: "unit.memory.bytes", value: 8192 }),
      ]),
    )
  })

  it("executes unit actions through the generic runtime", async () => {
    const calls: string[] = []
    const packageUnderTest = {
      manifest,
      agent: createSystemdAgentPlugin(
        makeDeps({
          exec: (command, args) => {
            calls.push(`${command} ${args.join(" ")}`)
            return Effect.succeed({ stdout: "", stderr: "", exitCode: 0 })
          },
        }),
      ),
    }

    const result = await Effect.runPromise(
      executePluginAction(
        packageUnderTest,
        {
          nodeId: "node-1",
          permissions: new Set(["node:systemd", "node:spawn-process"]),
        },
        {
          pluginId: SYSTEMD_PLUGIN_ID,
          actionId: SYSTEMD_ACTION_IDS.restartUnit,
          target: {
            nodeId: "node-1",
            entity: {
              pluginId: SYSTEMD_PLUGIN_ID,
              kind: SYSTEMD_UNIT_KIND,
              nodeId: "node-1",
              id: "nginx.service",
            },
          },
          input: {},
        },
      ),
    )

    expect(result).toMatchObject({ success: true, output: {} })
    expect(calls).toContain("systemctl --no-ask-password restart nginx.service")
  })

  it("reports a polkit refusal as permission-denied instead of escalating", async () => {
    const calls: string[] = []
    const packageUnderTest = {
      manifest,
      agent: createSystemdAgentPlugin(
        makeDeps({
          exec: (command, args) => {
            calls.push(`${command} ${args.join(" ")}`)
            return Effect.succeed({
              stdout: "",
              stderr: "Failed to stop nginx.service: Interactive authentication required.\n",
              exitCode: 1,
            })
          },
        }),
      ),
    }

    const exit = await Effect.runPromiseExit(
      executePluginAction(
        packageUnderTest,
        {
          nodeId: "node-1",
          permissions: new Set(["node:systemd", "node:spawn-process"]),
        },
        {
          pluginId: SYSTEMD_PLUGIN_ID,
          actionId: SYSTEMD_ACTION_IDS.stopUnit,
          target: {
            nodeId: "node-1",
            entity: {
              pluginId: SYSTEMD_PLUGIN_ID,
              kind: SYSTEMD_UNIT_KIND,
              nodeId: "node-1",
              id: "nginx.service",
            },
          },
          input: {},
        },
      ),
    )

    expect(calls).toEqual(["systemctl --no-ask-password stop nginx.service"])
    expect(Exit.isFailure(exit)).toBe(true)
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
      code: "permission-denied",
      actionId: SYSTEMD_ACTION_IDS.stopUnit,
    })
    expect(calls.some((call) => call.startsWith("sudo"))).toBe(false)
  })

  it("writes a unit file and reloads systemd", async () => {
    const calls: string[] = []
    const packageUnderTest = {
      manifest,
      agent: createSystemdAgentPlugin(
        makeDeps({
          exec: (command, args) => {
            calls.push(`${command} ${args.join(" ")}`)
            if (command === "systemctl" && args[0] === "show") {
              return Effect.succeed({
                stdout: "FragmentPath=/etc/systemd/system/nginx.service\n",
                stderr: "",
                exitCode: 0,
              })
            }
            return Effect.succeed({ stdout: "", stderr: "", exitCode: 0 })
          },
        }),
      ),
    }

    await expect(
      Effect.runPromise(
        executePluginAction(
          packageUnderTest,
          {
            nodeId: "node-1",
            permissions: new Set([
              "node:systemd",
              "node:spawn-process",
              "node:read-files",
              "node:write-files",
            ]),
          },
          {
            pluginId: SYSTEMD_PLUGIN_ID,
            actionId: SYSTEMD_ACTION_IDS.writeUnitFile,
            target: {
              nodeId: "node-1",
              entity: {
                pluginId: SYSTEMD_PLUGIN_ID,
                kind: SYSTEMD_UNIT_KIND,
                nodeId: "node-1",
                id: "nginx.service",
              },
            },
            input: { content: "[Unit]\nDescription=NGINX\n" },
          },
        ),
      ),
    ).resolves.toMatchObject({ success: true, output: {} })

    expect(calls).toEqual(
      expect.arrayContaining([
        "systemctl show -p FragmentPath nginx.service",
        "systemd-analyze verify /tmp/scout-systemd.test",
        "systemctl --no-ask-password daemon-reload",
      ]),
    )
  })

  it("opens the systemd log stream through the generic runtime", async () => {
    const packageUnderTest = {
      manifest,
      agent: createSystemdAgentPlugin(makeDeps()),
    }

    const stream = await Effect.runPromise(
      openPluginStream(
        packageUnderTest,
        {
          nodeId: "node-1",
          permissions: new Set([
            "node:systemd",
            "node:stream-logs",
            "node:spawn-process",
          ]),
        },
        {
          pluginId: SYSTEMD_PLUGIN_ID,
          streamId: SYSTEMD_STREAM_IDS.unitLogs,
          target: {
            nodeId: "node-1",
            entity: {
              pluginId: SYSTEMD_PLUGIN_ID,
              kind: SYSTEMD_UNIT_KIND,
              nodeId: "node-1",
              id: "nginx.service",
            },
          },
          input: {},
        },
      ),
    )

    const chunks = await Effect.runPromise(Stream.runCollect(stream))
    expect([...chunks]).toEqual([
      { lines: ["line one", "line two"], ts: 123 },
    ])
  })

  it("exports valid json-render screens for the web runtime", async () => {
    const screens = await Promise.all(
      web.screens.map((screen) => Effect.runPromise(decodePluginUiScreen(screen))),
    )

    expect(screens).toHaveLength(2)
    expect(screens.map((screen) => screen.id)).toEqual([
      "systemd.overview",
      "systemd.unit-detail",
    ])
    expect(screens[0]?.kind).toBe("overview")
    expect(screens[1]).toMatchObject({
      kind: "entity-detail",
      entityKind: SYSTEMD_UNIT_KIND,
    })
    expect(screens[1]?.spec.elements.readUnitFileButton).toMatchObject({
      type: "ActionButton",
      on: {
        press: {
          action: "plugin.runAction",
          params: {
            actionId: SYSTEMD_ACTION_IDS.readUnitFile,
          },
        },
      },
    })
  })
})
