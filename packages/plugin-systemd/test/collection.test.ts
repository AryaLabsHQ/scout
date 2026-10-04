import { Cause, Effect, Exit, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { executePluginAction } from "@scout/plugin-sdk"
import {
  SYSTEMD_ACTION_IDS,
  SYSTEMD_PLUGIN_ID,
  SYSTEMD_TIMER_KIND,
  SYSTEMD_UNIT_KIND,
  SYSTEMD_USER_TIMER_KIND,
  SYSTEMD_USER_UNIT_KIND,
  type SystemdTimerState,
  type SystemdUnitState,
} from "../src/contracts.js"
import { manifest } from "../src/manifest.js"
import {
  createSystemdAgentPlugin,
  parseSystemctlListTimers,
  parseSystemctlShowBatch,
  parseSystemdTimestamp,
  type SystemdDependencies,
} from "../src/systemd.js"

type Exec = SystemdDependencies["exec"]

const ok = (stdout: string) => Effect.succeed({ stdout, stderr: "", exitCode: 0 })

const makeDeps = (exec: Exec): SystemdDependencies => ({
  exec,
  readFile: () => Effect.succeed("[Unit]\n"),
  copyFile: () => Effect.void,
  writeFile: () => Effect.void,
  unlink: () => Effect.void,
  makeTempPath: () => "/tmp/scout-systemd.test",
  followJournal: () => Stream.empty,
})

// Captured from `systemctl show --timestamp=us+utc` on Agni (systemd 259).
const SYSTEM_SHOW = [
  "Id=restic-backup.timer",
  "ActiveState=active",
  "UnitFileState=enabled",
  "Unit=restic-backup.service",
  "NextElapseUSecRealtime=Mon 2026-10-05 03:23:58.736488 UTC",
  "LastTriggerUSec=Sun 2026-10-04 03:34:24.354113 UTC",
  "Result=success",
  "",
  "Id=restic-backup.service",
  "ActiveState=inactive",
  "UnitFileState=static",
  "MainPID=0",
  "MemoryCurrent=[not set]",
  "CPUUsageNSec=[not set]",
  "ActiveEnterTimestamp=",
  "Result=exit-code",
  "NRestarts=0",
  "ExecMainExitTimestamp=Sun 2026-10-04 03:37:00.109000 UTC",
  "ExecMainStatus=3",
  "",
  "Id=dbus.service",
  "ActiveState=active",
  "UnitFileState=static",
  "MainPID=812",
  "MemoryCurrent=4194304",
  "CPUUsageNSec=1000000",
  "ActiveEnterTimestamp=Sat 2026-09-26 11:24:01.240172 UTC",
  "Result=success",
  "NRestarts=2",
  "ExecMainExitTimestamp=",
  "ExecMainStatus=0",
].join("\n")

const USER_SHOW = [
  "Id=dbus.service",
  "ActiveState=active",
  "UnitFileState=static",
  "MainPID=2201",
  "MemoryCurrent=1048576",
  "CPUUsageNSec=2000",
  "Result=success",
  "NRestarts=0",
].join("\n")

/** A fake systemctl for both managers; `--user` selects the user manager's answers. */
const fakeSystemctl = (
  calls: string[],
  opts: { userManager?: boolean; timestampFlag?: boolean; show?: "ok" | "fail"; userShow?: "fail" } = {},
): Exec =>
  (command, args) => {
    calls.push(`${command} ${args.join(" ")}`)
    const user = args[0] === "--user"
    const rest = user ? args.slice(1) : args
    if (user && opts.userManager === false) {
      return Effect.succeed({ stdout: "", stderr: "Failed to connect to bus: No medium found", exitCode: 1 })
    }
    if (rest[0] === "list-units" && rest.includes("--type=service")) {
      return ok(
        JSON.stringify(
          user
            ? [{ unit: "dbus.service", load: "loaded", active: "active", sub: "running", description: "D-Bus User Message Bus" }]
            : [
                { unit: "dbus.service", load: "loaded", active: "active", sub: "running", description: "D-Bus System Message Bus" },
                { unit: "restic-backup.service", load: "loaded", active: "inactive", sub: "dead", description: "Restic backup" },
              ],
        ),
      )
    }
    if (rest[0] === "list-units" && rest.includes("--type=timer")) {
      return ok(
        JSON.stringify(
          user ? [] : [{ unit: "restic-backup.timer", load: "loaded", active: "active", sub: "waiting", description: "Daily Restic Backup" }],
        ),
      )
    }
    if (rest[0] === "list-timers") {
      return ok(
        JSON.stringify(
          user
            ? []
            : [{ next: 1791170638736488, left: 1, last: 1791084864354113, passed: 1, unit: "restic-backup.timer", activates: "restic-backup.service" }],
        ),
      )
    }
    if (rest[0] === "show") {
      if (opts.show === "fail" || (user && opts.userShow === "fail")) {
        return Effect.succeed({ stdout: "", stderr: "Connection timed out", exitCode: 1 })
      }
      if (opts.timestampFlag === false) {
        if (rest.includes("--timestamp=us+utc")) {
          return Effect.succeed({ stdout: "", stderr: "Unknown timestamp format", exitCode: 1 })
        }
        // An older systemctl prints timestamps in the host's local time.
        return ok((user ? USER_SHOW : SYSTEM_SHOW).replace(/(\d{2}:\d{2}:\d{2})\.\d+ UTC/g, "$1 CEST"))
      }
      return ok(user ? USER_SHOW : SYSTEM_SHOW)
    }
    return Effect.fail(new Error(`unexpected systemctl call: ${args.join(" ")}`))
  }

const collect = (exec: Exec) =>
  Effect.runPromise(createSystemdAgentPlugin(makeDeps(exec)).collect!({ nodeId: "agni", now: 42 }))

describe("systemd parsers", () => {
  it("reads systemd timestamps as epoch milliseconds", () => {
    expect(parseSystemdTimestamp("Sun 2026-10-04 03:34:24.354113 UTC")).toBe(Date.UTC(2026, 9, 4, 3, 34, 24, 354))
    expect(parseSystemdTimestamp("Sun 2026-10-04 03:34:24 UTC")).toBe(Date.UTC(2026, 9, 4, 3, 34, 24))
    expect(parseSystemdTimestamp("@1791084864")).toBe(1791084864000)
    expect(parseSystemdTimestamp("")).toBeNull()
    expect(parseSystemdTimestamp("n/a")).toBeNull()
    expect(parseSystemdTimestamp(undefined)).toBeNull()
    // A local-time rendering is ambiguous, so it is not guessed at.
    expect(parseSystemdTimestamp("Sun 2026-10-04 05:34:24 CEST")).toBeNull()
  })

  it("splits batched show output by unit id", () => {
    const units = parseSystemctlShowBatch(SYSTEM_SHOW)
    expect([...units.keys()]).toEqual(["restic-backup.timer", "restic-backup.service", "dbus.service"])
    expect(units.get("restic-backup.service")?.["ExecMainStatus"]).toBe("3")
  })

  it("parses list-timers json, treating null and 0 as never", () => {
    expect(
      parseSystemctlListTimers(
        JSON.stringify([
          { next: 5000, left: 1, last: 2000, passed: 1, unit: "a.timer", activates: "a.service" },
          { next: null, left: null, last: 0, passed: 0, unit: "b.timer", activates: "b.service" },
          { next: 1, unit: "" },
        ]),
      ),
    ).toEqual([
      { unit: "a.timer", activates: "a.service", nextUs: 5000, lastUs: 2000 },
      { unit: "b.timer", activates: "b.service", nextUs: null, lastUs: null },
    ])
    expect(parseSystemctlListTimers("not json")).toEqual([])
  })
})

describe("systemd collection", () => {
  it("collects system and user services as distinct kinds, plus timers", async () => {
    const calls: string[] = []
    const result = await collect(fakeSystemctl(calls))
    const ids = result.entities!.map((entity) => `${entity.ref.kind}/${entity.ref.id}`)
    expect(ids).toEqual(
      expect.arrayContaining([
        `${SYSTEMD_UNIT_KIND}/dbus.service`,
        `${SYSTEMD_UNIT_KIND}/restic-backup.service`,
        `${SYSTEMD_USER_UNIT_KIND}/dbus.service`,
        `${SYSTEMD_TIMER_KIND}/restic-backup.timer`,
      ]),
    )
    expect(ids).toHaveLength(4)
    // Every entity carries the collection timestamp; the hub keys "latest" on it.
    expect(new Set(result.entities!.map((entity) => entity.ts))).toEqual(new Set([42]))
    // One batched show per manager, never one per unit.
    expect(calls.filter((call) => call.includes(" show "))).toHaveLength(2)
  })

  it("reports unit results, restarts, and timestamps", async () => {
    const result = await collect(fakeSystemctl([]))
    const state = (kind: string, id: string) =>
      result.entities!.find((entity) => entity.ref.kind === kind && entity.ref.id === id)?.state
    expect(state(SYSTEMD_UNIT_KIND, "dbus.service")).toEqual({
      scope: "system",
      description: "D-Bus System Message Bus",
      loadState: "loaded",
      activeState: "active",
      subState: "running",
      unitFileState: "static",
      result: "success",
      execMainStatus: null,
      execMainExitAt: null,
      activeEnterAt: Date.UTC(2026, 8, 26, 11, 24, 1, 240),
      restarts: 2,
      pid: 812,
      memoryBytes: 4194304,
      cpuUsageNs: 1000000,
    } satisfies SystemdUnitState)
    expect(state(SYSTEMD_UNIT_KIND, "restic-backup.service")).toMatchObject({
      result: "exit-code",
      execMainStatus: 3,
      execMainExitAt: Date.UTC(2026, 9, 4, 3, 37, 0, 109),
      pid: null,
      memoryBytes: null,
    })
    expect(state(SYSTEMD_USER_UNIT_KIND, "dbus.service")).toMatchObject({ scope: "user", pid: 2201 })
  })

  it("joins a timer with the last run of the unit it activates", async () => {
    const result = await collect(fakeSystemctl([]))
    const timer = result.entities!.find((entity) => entity.ref.kind === SYSTEMD_TIMER_KIND)!
    expect(timer.state).toEqual({
      scope: "system",
      description: "Daily Restic Backup",
      activeState: "active",
      subState: "waiting",
      unitFileState: "enabled",
      activates: "restic-backup.service",
      nextRunAt: 1791170638736,
      lastTriggerAt: 1791084864354,
      activatesState: "inactive",
      lastResult: "exit-code",
      lastExitStatus: 3,
      lastExitAt: Date.UTC(2026, 9, 4, 3, 37, 0, 109),
    } satisfies SystemdTimerState)
    // A failed last run marks the timer failed even though it is still scheduled.
    expect(timer.status).toBe("failed")
  })

  it("keeps unit totals and resource metrics scoped correctly", async () => {
    const result = await collect(fakeSystemctl([]))
    const metric = (metricId: string) => result.metrics!.filter((point) => point.metricId === metricId)
    expect(metric("units.total")[0]?.value).toBe(2)
    expect(metric("unit.memory.bytes").map((point) => [point.entity?.kind, point.entity?.id, point.value])).toEqual([
      [SYSTEMD_UNIT_KIND, "dbus.service", 4194304],
      [SYSTEMD_USER_UNIT_KIND, "dbus.service", 1048576],
    ])
  })

  it("treats a missing user manager as no user units", async () => {
    const result = await collect(fakeSystemctl([], { userManager: false }))
    expect(result.entities!.some((entity) => entity.ref.kind === SYSTEMD_USER_UNIT_KIND)).toBe(false)
    expect(result.entities!.some((entity) => entity.ref.kind === SYSTEMD_USER_TIMER_KIND)).toBe(false)
    expect(result.entities!.some((entity) => entity.ref.kind === SYSTEMD_TIMER_KIND)).toBe(true)
  })

  it("retries show without --timestamp on an older systemctl", async () => {
    const calls: string[] = []
    const result = await collect(fakeSystemctl(calls, { timestampFlag: false }))
    expect(calls.filter((call) => call.startsWith("systemctl show "))).toHaveLength(2)
    const dbus = result.entities!.find((entity) => entity.ref.kind === SYSTEMD_UNIT_KIND && entity.ref.id === "dbus.service")
    expect(dbus?.state).toMatchObject({ restarts: 2, pid: 812, activeEnterAt: null })
    // Local-time timestamps read as unknown, but the exit status survives.
    const restic = result.entities!.find((entity) => entity.ref.id === "restic-backup.service")
    expect(restic?.state).toMatchObject({ result: "exit-code", execMainStatus: 3, execMainExitAt: null })
    const timer = result.entities!.find((entity) => entity.ref.kind === SYSTEMD_TIMER_KIND)
    expect(timer?.state).toMatchObject({ lastResult: "exit-code", lastExitStatus: 3, lastExitAt: null })
  })

  it("fails the collection instead of publishing units without details", async () => {
    const exit = await Effect.runPromiseExit(
      createSystemdAgentPlugin(makeDeps(fakeSystemctl([], { show: "fail" }))).collect!({ nodeId: "agni", now: 42 }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("keeps a manager's last good details when a later detail read fails", async () => {
    let failUserShow = false
    const healthy = fakeSystemctl([])
    const failing = fakeSystemctl([], { userShow: "fail" })
    const plugin = createSystemdAgentPlugin(makeDeps((command, args) => (failUserShow ? failing : healthy)(command, args)))

    await Effect.runPromise(plugin.collect!({ nodeId: "agni", now: 1 }))
    failUserShow = true
    // The user read fails: system data still updates, and user units keep their details.
    const result = await Effect.runPromise(plugin.collect!({ nodeId: "agni", now: 2 }))
    const userDbus = result.entities!.find((entity) => entity.ref.kind === SYSTEMD_USER_UNIT_KIND)
    expect(userDbus).toMatchObject({ ts: 2, state: { pid: 2201 } })
    expect(result.entities!.find((entity) => entity.ref.kind === SYSTEMD_UNIT_KIND && entity.ref.id === "dbus.service")).toMatchObject({
      ts: 2,
      state: { pid: 812 },
    })
  })

  it("fails the collection when a manager's first detail read fails", async () => {
    const exit = await Effect.runPromiseExit(
      createSystemdAgentPlugin(makeDeps(fakeSystemctl([], { userShow: "fail" }))).collect!({ nodeId: "agni", now: 42 }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("fails the collection when the system manager cannot list units", async () => {
    const exit = await Effect.runPromiseExit(
      createSystemdAgentPlugin(
        makeDeps(() => Effect.succeed({ stdout: "", stderr: "System has not been booted with systemd", exitCode: 1 })),
      ).collect!({ nodeId: "agni", now: 42 }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("user-scope unit actions", () => {
  const run = (exec: Exec, actionId: string, kind: string, id: string) =>
    Effect.runPromiseExit(
      executePluginAction(
        { manifest, agent: createSystemdAgentPlugin(makeDeps(exec)) },
        { nodeId: "agni", permissions: new Set(["node:systemd", "node:spawn-process", "node:read-files"]) },
        {
          pluginId: SYSTEMD_PLUGIN_ID,
          actionId,
          target: { nodeId: "agni", entity: { pluginId: SYSTEMD_PLUGIN_ID, kind, nodeId: "agni", id } },
          input: {},
        },
      ),
    )

  it("restarts a user unit through systemctl --user", async () => {
    const calls: string[] = []
    const exit = await run(
      (command, args) => {
        calls.push(`${command} ${args.join(" ")}`)
        return ok("")
      },
      SYSTEMD_ACTION_IDS.restartUnit,
      SYSTEMD_USER_UNIT_KIND,
      "t3code.service",
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(calls).toEqual(["systemctl --no-ask-password --user restart t3code.service"])
  })

  it("reads a user unit file from the user manager", async () => {
    const calls: string[] = []
    const exit = await run(
      (command, args) => {
        calls.push(`${command} ${args.join(" ")}`)
        return ok("FragmentPath=/home/ubuntu/.config/systemd/user/t3code.service\n")
      },
      SYSTEMD_ACTION_IDS.readUnitFile,
      SYSTEMD_USER_UNIT_KIND,
      "t3code.service",
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(calls).toEqual(["systemctl --user show -p FragmentPath t3code.service"])
  })

  it("rejects unit actions on a timer", async () => {
    const calls: string[] = []
    const exit = await run(
      (command, args) => {
        calls.push(`${command} ${args.join(" ")}`)
        return ok("")
      },
      SYSTEMD_ACTION_IDS.restartUnit,
      SYSTEMD_TIMER_KIND,
      "restic-backup.timer",
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({ code: "invalid-target-kind" })
    expect(calls).toEqual([])
  })
})
