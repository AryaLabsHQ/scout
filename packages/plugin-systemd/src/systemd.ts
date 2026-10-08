import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  copyFile as copyFsFile,
  readFile as readFsFile,
  rm as rmFile,
  writeFile as writeFsFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Stream } from "effect"
import {
  type ActionTarget,
  followProcessLines,
  LogChunkSchema,
  PluginExecutionError,
  type LogChunk,
  type PluginCapability,
  type PluginCollectionResult,
  type ScoutActionHandler,
  type ScoutAgentPlugin,
  type ScoutStreamHandler,
} from "@scout/plugin-sdk"
import {
  EmptyInputSchema,
  SYSTEMD_ACTION_IDS,
  SYSTEMD_FEATURES,
  SYSTEMD_METRIC_IDS,
  SYSTEMD_PLUGIN_ID,
  SYSTEMD_SERVICE_KINDS,
  SYSTEMD_STREAM_IDS,
  SYSTEMD_TIMER_KINDS,
  SYSTEMD_UNIT_KIND,
  SYSTEMD_USER_UNIT_KIND,
  type SystemdScope,
  type SystemdTimerState,
  type SystemdUnitState,
  UnitFileSchema,
  UnitFileWriteInputSchema,
  UnitLogsInputSchema,
} from "./contracts.js"
import { manifest } from "./manifest.js"

interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface SystemdDependencies {
  readonly exec: (command: string, args: ReadonlyArray<string>) => Effect.Effect<CommandResult, Error>
  readonly readFile: (path: string) => Effect.Effect<string, Error>
  readonly copyFile: (from: string, to: string) => Effect.Effect<void, Error>
  readonly writeFile: (path: string, content: string) => Effect.Effect<void, Error>
  readonly unlink: (path: string) => Effect.Effect<void>
  readonly makeTempPath: (prefix: string) => string
  readonly followJournal: (unit: string, tail: number, scope: SystemdScope) => Stream.Stream<LogChunk, Error>
}

interface SystemctlUnit {
  readonly unit?: string
  readonly load?: string
  readonly active?: string
  readonly sub?: string
  readonly description?: string
}

export interface SystemdUnitMetrics {
  readonly unit: string
  readonly description: string
  readonly loadState: "loaded" | "not-found" | "masked" | "error"
  readonly activeState: "active" | "inactive" | "failed" | "activating" | "deactivating"
  readonly subState: string
  readonly pid: number | null
  readonly memoryBytes: number | null
  readonly cpuUsageNs: number | null
}

/** One row of `systemctl list-timers --all --output=json`; times are epoch microseconds. */
export interface SystemctlTimer {
  readonly unit: string
  readonly activates: string
  readonly nextUs: number | null
  readonly lastUs: number | null
}

/** What `systemctl show` reports about a service beyond list-units. */
export interface SystemdServiceDetails {
  readonly pid: number | null
  readonly memoryBytes: number | null
  readonly cpuUsageNs: number | null
  readonly unitFileState: string | null
  readonly result: string | null
  readonly execMainStatus: number | null
  readonly execMainExitAt: number | null
  readonly activeEnterAt: number | null
  readonly restarts: number | null
}

const DEFAULT_LOG_TAIL = 200

/**
 * `systemctl show` properties read in one batched call per scope. A property a
 * unit type does not have is simply absent from that unit's block.
 */
export const SHOW_PROPERTIES = [
  "Id",
  "ActiveState",
  "MainPID",
  "MemoryCurrent",
  "CPUUsageNSec",
  "Result",
  "ExecMainStatus",
  "ExecMainExitTimestamp",
  "ActiveEnterTimestamp",
  "NRestarts",
  "UnitFileState",
  "Unit",
  "NextElapseUSecRealtime",
  "LastTriggerUSec",
] as const

export const validateUnit = (unit: string): boolean => {
  if (!unit || unit.length === 0 || unit.length > 256) return false
  if (unit.includes("/") || unit.includes("\\") || unit.includes("..")) return false
  return /^[a-zA-Z0-9_\-@:.\\]+$/.test(unit)
}

export const parseSystemctlListUnits = (json: string): ReadonlyArray<SystemdUnitMetrics> => {
  let parsed: ReadonlyArray<SystemctlUnit>
  try {
    parsed = JSON.parse(json) as ReadonlyArray<SystemctlUnit>
    if (!Array.isArray(parsed)) return []
  } catch {
    return []
  }

  return parsed.map((entry) => ({
    unit: entry.unit ?? "",
    description: entry.description ?? "",
    loadState: normalizeLoadState(entry.load),
    activeState: normalizeActiveState(entry.active),
    subState: entry.sub ?? "",
    pid: null,
    memoryBytes: null,
    cpuUsageNs: null,
  }))
}

const toFields = (block: string): Record<string, string> => {
  const fields: Record<string, string> = {}
  for (const line of block.split("\n")) {
    const separator = line.indexOf("=")
    if (separator === -1) continue
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  return fields
}

/** Present, non-negative integer properties; `[not set]`, `n/a`, and blanks are null. */
const integerField = (value: string | undefined): number | null => {
  if (value === undefined || !/^\d+$/.test(value)) return null
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : null
}

const stringField = (value: string | undefined): string | null =>
  value === undefined || value.length === 0 ? null : value

export const parseSystemctlShow = (
  output: string,
): {
  readonly pid: number | null
  readonly memoryBytes: number | null
  readonly cpuUsageNs: number | null
} => {
  const fields = toFields(output)
  const pid = integerField(fields["MainPID"])
  const cpu = integerField(fields["CPUUsageNSec"])
  return {
    pid: pid === 0 ? null : pid,
    memoryBytes: integerField(fields["MemoryCurrent"]),
    cpuUsageNs: cpu === 0 ? null : cpu,
  }
}

/**
 * A systemd timestamp property as epoch milliseconds. Reads the
 * `--timestamp=us+utc` form (`Sun 2026-10-04 03:34:24.354113 UTC`) and the
 * `--timestamp=unix` form (`@1791084864`); blank or `n/a` means never.
 */
export const parseSystemdTimestamp = (value: string | undefined): number | null => {
  if (value === undefined) return null
  const unix = /^@(\d+)$/.exec(value)
  if (unix) return Number(unix[1]) * 1000
  const utc = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))? UTC$/.exec(value)
  if (!utc) return null
  const [, year, month, day, hour, minute, second, fraction = "0"] = utc
  return (
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) +
    Math.floor(Number(fraction.padEnd(6, "0")) / 1000)
  )
}

/**
 * Split batched `systemctl show <unit>...` output into per-unit property maps
 * keyed by `Id`. systemd separates the units' blocks with a blank line.
 */
export const parseSystemctlShowBatch = (output: string): ReadonlyMap<string, Record<string, string>> => {
  const units = new Map<string, Record<string, string>>()
  for (const block of output.split(/\n\s*\n/)) {
    const fields = toFields(block)
    const id = fields["Id"]
    if (id !== undefined && id.length > 0) units.set(id, fields)
  }
  return units
}

export const serviceDetails = (fields: Record<string, string> | undefined): SystemdServiceDetails => {
  const resources = parseSystemctlShow(
    fields === undefined
      ? ""
      : `MainPID=${fields["MainPID"] ?? ""}\nMemoryCurrent=${fields["MemoryCurrent"] ?? ""}\nCPUUsageNSec=${fields["CPUUsageNSec"] ?? ""}`,
  )
  const exitTimestamp = fields?.["ExecMainExitTimestamp"]
  const execMainExitAt = parseSystemdTimestamp(exitTimestamp)
  return {
    ...resources,
    unitFileState: stringField(fields?.["UnitFileState"]),
    result: stringField(fields?.["Result"]),
    // ExecMainStatus reads 0 before the main process ever exits; it only means
    // something once there is an exit timestamp. Gate on the raw property, not
    // the parsed time: a local-time timestamp from an older systemctl reads as
    // unknown but still marks an exit.
    execMainStatus:
      exitTimestamp === undefined || exitTimestamp.length === 0 || exitTimestamp === "n/a"
        ? null
        : integerField(fields?.["ExecMainStatus"]),
    execMainExitAt,
    activeEnterAt: parseSystemdTimestamp(fields?.["ActiveEnterTimestamp"]),
    restarts: integerField(fields?.["NRestarts"]),
  }
}

interface SystemctlTimerJson {
  readonly unit?: unknown
  readonly activates?: unknown
  readonly next?: unknown
  readonly last?: unknown
}

const positiveMicros = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null

/** Parse `systemctl list-timers --all --output=json`. `next`/`last` are null or 0 when unknown. */
export const parseSystemctlListTimers = (json: string): ReadonlyArray<SystemctlTimer> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return (parsed as ReadonlyArray<SystemctlTimerJson>).flatMap((entry) =>
    typeof entry.unit === "string" && entry.unit.length > 0
      ? [
          {
            unit: entry.unit,
            activates: typeof entry.activates === "string" ? entry.activates : "",
            nextUs: positiveMicros(entry.next),
            lastUs: positiveMicros(entry.last),
          },
        ]
      : [],
  )
}

const normalizeLoadState = (value: string | undefined): SystemdUnitMetrics["loadState"] => {
  switch (value) {
    case "loaded":
      return "loaded"
    case "not-found":
      return "not-found"
    case "masked":
      return "masked"
    default:
      return "error"
  }
}

const normalizeActiveState = (value: string | undefined): SystemdUnitMetrics["activeState"] => {
  switch (value) {
    case "active":
      return "active"
    case "inactive":
      return "inactive"
    case "failed":
      return "failed"
    case "activating":
      return "activating"
    case "deactivating":
      return "deactivating"
    default:
      return "inactive"
  }
}

const failExecution = (code: string, message: string, opts?: { actionId?: string; streamId?: string }) =>
  new PluginExecutionError({
    code,
    message,
    pluginId: SYSTEMD_PLUGIN_ID,
    ...(opts?.actionId !== undefined && { actionId: opts.actionId }),
    ...(opts?.streamId !== undefined && { streamId: opts.streamId }),
  })

const entityRef = (nodeId: string, kind: string, unit: string) =>
  ({
    pluginId: SYSTEMD_PLUGIN_ID,
    kind,
    nodeId,
    id: unit,
  }) as const

/** `systemctl` arguments that select the manager for a scope. */
const scopeArgs = (scope: SystemdScope): ReadonlyArray<string> => (scope === "user" ? ["--user"] : [])

const getTargetUnit = (
  target: ActionTarget,
  opts?: { actionId?: string; streamId?: string },
): Effect.Effect<string, PluginExecutionError> => {
  const unit = target.entity?.id
  if (unit === undefined || !validateUnit(unit)) {
    return Effect.fail(failExecution("invalid-target", "Systemd actions require a valid unit target", opts))
  }
  return Effect.succeed(unit)
}

/** The target unit plus the manager that owns it, from the target entity's kind. */
const getTargetService = (
  target: ActionTarget,
  opts: { actionId?: string; streamId?: string },
): Effect.Effect<{ readonly unit: string; readonly scope: SystemdScope }, PluginExecutionError> =>
  getTargetUnit(target, opts).pipe(
    Effect.flatMap(
      (
        unit,
      ): Effect.Effect<{ readonly unit: string; readonly scope: SystemdScope }, PluginExecutionError> => {
        const kind = target.entity?.kind
        if (kind === SYSTEMD_UNIT_KIND) return Effect.succeed({ unit, scope: "system" })
        if (kind === SYSTEMD_USER_UNIT_KIND) return Effect.succeed({ unit, scope: "user" })
        return Effect.fail(
          failExecution(
            "invalid-target",
            `Systemd unit actions do not apply to ${String(kind)} entities`,
            opts,
          ),
        )
      },
    ),
  )

const makeDefaultDependencies = (): SystemdDependencies => ({
  exec: (command, args) =>
    Effect.tryPromise({
      try: async () => {
        const proc = spawn(command, [...args], {
          stdio: ["ignore", "pipe", "pipe"],
        })
        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []

        proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk))
        proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk))

        const exitCode = await new Promise<number>((resolve, reject) => {
          proc.on("error", reject)
          proc.on("close", (code) => resolve(code ?? 1))
        })

        const stdout = Buffer.concat(stdoutChunks).toString("utf8")
        const stderr = Buffer.concat(stderrChunks).toString("utf8")
        return { stdout, stderr, exitCode }
      },
      catch: (error) => new Error(`Failed to run ${command}: ${String(error)}`),
    }),
  readFile: (path) =>
    Effect.tryPromise({
      try: () => readFsFile(path, "utf8"),
      catch: (error) => new Error(`Failed to read ${path}: ${String(error)}`),
    }),
  copyFile: (from, to) =>
    Effect.tryPromise({
      try: () => copyFsFile(from, to),
      catch: (error) => new Error(`Failed to copy ${from} to ${to}: ${String(error)}`),
    }),
  writeFile: (path, content) =>
    Effect.tryPromise({
      try: () => writeFsFile(path, content, "utf8"),
      catch: (error) => new Error(`Failed to write ${path}: ${String(error)}`),
    }),
  unlink: (path) =>
    Effect.tryPromise({
      try: () => rmFile(path, { force: true }),
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => undefined)),
  makeTempPath: (prefix) => join(tmpdir(), `${prefix}-${randomUUID()}.tmp`),
  // Unprivileged agents read system unit logs through journal group
  // membership (`adm` or `systemd-journal`); the agent user always reads
  // its own user journal.
  followJournal: (unit, tail, scope) =>
    followProcessLines("journalctl", [
      ...scopeArgs(scope),
      "-f",
      "-u",
      unit,
      "-n",
      String(tail),
      "--output=short-iso",
    ]),
})

const runChecked = (
  deps: SystemdDependencies,
  command: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, PluginExecutionError> =>
  deps.exec(command, args).pipe(
    Effect.flatMap(({ stdout, stderr, exitCode }) =>
      exitCode === 0
        ? Effect.succeed(stdout)
        : Effect.fail(
            failExecution(
              "command-failed",
              `${command} ${args.join(" ")} exited with ${exitCode}: ${stderr.trim() || stdout.trim() || "unknown error"}`,
            ),
          ),
    ),
    Effect.mapError((error) =>
      error instanceof PluginExecutionError ? error : failExecution("command-error", String(error)),
    ),
  )

/**
 * Read-only systemctl queries. System-scope reads work for any user on the
 * system bus; user-scope reads (`--user`) reach the agent user's own manager.
 */
const runSystemctl = (
  deps: SystemdDependencies,
  args: ReadonlyArray<string>,
): Effect.Effect<string, PluginExecutionError> => runChecked(deps, "systemctl", args)

const AUTHORIZATION_DENIED =
  /interactive authentication required|access denied|not authorized|permission denied/i

const permissionDenied = (operation: string, actionId: string) =>
  failExecution(
    "permission-denied",
    `${operation} requires root or a polkit grant; this Scout agent runs as ` +
      `uid ${String(process.getuid?.() ?? "unknown")} and never escalates with sudo.`,
    { actionId },
  )

/**
 * State-changing systemctl calls. `--no-ask-password` makes polkit refuse
 * immediately instead of waiting for an interactive password, and a refusal
 * surfaces as a `permission-denied` execution error. User-scope calls pass
 * `--user` and go to the agent user's own manager, which needs no polkit grant.
 */
const runSystemctlMutation = (
  deps: SystemdDependencies,
  args: ReadonlyArray<string>,
  actionId: string,
): Effect.Effect<string, PluginExecutionError> =>
  deps.exec("systemctl", ["--no-ask-password", ...args]).pipe(
    Effect.mapError((error) => failExecution("command-error", String(error), { actionId })),
    Effect.flatMap(({ stdout, stderr, exitCode }) => {
      if (exitCode === 0) return Effect.succeed(stdout)
      const detail = stderr.trim() || stdout.trim() || "unknown error"
      return Effect.fail(
        AUTHORIZATION_DENIED.test(detail)
          ? permissionDenied(`systemctl ${args.join(" ")}`, actionId)
          : failExecution(
              "command-failed",
              `systemctl ${args.join(" ")} exited with ${exitCode}: ${detail}`,
              {
                actionId,
              },
            ),
      )
    }),
  )

const getUnitFilePath = (
  deps: SystemdDependencies,
  unit: string,
  scope: SystemdScope,
  actionId: string,
): Effect.Effect<string, PluginExecutionError> =>
  runSystemctl(deps, [...scopeArgs(scope), "show", "-p", "FragmentPath", unit]).pipe(
    Effect.flatMap((output) => {
      const match = output.match(/^FragmentPath=(.+)$/m)
      const path = match?.[1]?.trim() ?? ""
      return path.length > 0
        ? Effect.succeed(path)
        : Effect.fail(failExecution("not-found", "Unit file path not found", { actionId }))
    }),
  )

/** What one systemd manager (system or user) reported in one collection. */
export interface ScopeSnapshot {
  readonly scope: SystemdScope
  readonly services: ReadonlyArray<SystemdUnitMetrics>
  readonly timers: ReadonlyArray<SystemdUnitMetrics>
  readonly schedule: ReadonlyArray<SystemctlTimer>
  readonly details: ReadonlyMap<string, Record<string, string>>
  /** False when `details` is a previous read reused after this one failed. */
  readonly detailsFresh: boolean
}

const microsToMillis = (micros: number | null): number | null =>
  micros === null ? null : Math.floor(micros / 1000)

const unitEntity = (
  nodeId: string,
  ts: number,
  scope: SystemdScope,
  unit: SystemdUnitMetrics,
  details: SystemdServiceDetails,
) => {
  const state: SystemdUnitState = {
    scope,
    description: unit.description,
    loadState: unit.loadState,
    activeState: unit.activeState,
    subState: unit.subState,
    unitFileState: details.unitFileState,
    result: details.result,
    execMainStatus: details.execMainStatus,
    execMainExitAt: details.execMainExitAt,
    activeEnterAt: details.activeEnterAt,
    restarts: details.restarts,
    pid: details.pid,
    memoryBytes: details.memoryBytes,
    cpuUsageNs: details.cpuUsageNs,
  }
  return {
    ref: entityRef(nodeId, SYSTEMD_SERVICE_KINDS[scope], unit.unit),
    ts,
    displayName: unit.description.length > 0 ? unit.description : unit.unit,
    status: unit.activeState,
    labels: {
      scope,
      loadState: unit.loadState,
      subState: unit.subState,
    },
    state,
  }
}

const timerEntity = (nodeId: string, ts: number, snapshot: ScopeSnapshot, timer: SystemdUnitMetrics) => {
  const schedule = snapshot.schedule.find((entry) => entry.unit === timer.unit)
  const fields = snapshot.details.get(timer.unit)
  const activates = schedule?.activates || fields?.["Unit"] || ""
  const activatedFields = activates.length > 0 ? snapshot.details.get(activates) : undefined
  const cached = activatedFields === undefined ? null : serviceDetails(activatedFields)
  const lastTriggerAt = schedule
    ? microsToMillis(schedule.lastUs)
    : parseSystemdTimestamp(fields?.["LastTriggerUSec"])
  // Reused details can predate the timer's latest trigger; their result then
  // belongs to an earlier run, so the last run reads as unknown rather than
  // pairing the new trigger with an old outcome.
  const activated =
    !snapshot.detailsFresh &&
    cached?.execMainExitAt != null &&
    lastTriggerAt !== null &&
    cached.execMainExitAt < lastTriggerAt
      ? null
      : cached
  const state: SystemdTimerState = {
    scope: snapshot.scope,
    description: timer.description,
    activeState: timer.activeState,
    subState: timer.subState,
    unitFileState: stringField(fields?.["UnitFileState"]),
    activates,
    // list-timers folds monotonic triggers (OnBootSec, OnUnitActiveSec) into
    // `next`; NextElapseUSecRealtime only covers calendar triggers.
    nextRunAt: schedule
      ? microsToMillis(schedule.nextUs)
      : parseSystemdTimestamp(fields?.["NextElapseUSecRealtime"]),
    lastTriggerAt,
    activatesState: stringField(activatedFields?.["ActiveState"]),
    lastResult: activated?.result ?? null,
    lastExitStatus: activated?.execMainStatus ?? null,
    lastExitAt: activated?.execMainExitAt ?? null,
  }
  const lastRunFailed = state.lastResult !== null && state.lastResult !== "success"
  return {
    ref: entityRef(nodeId, SYSTEMD_TIMER_KINDS[snapshot.scope], timer.unit),
    ts,
    displayName: timer.description.length > 0 ? timer.description : timer.unit,
    status: lastRunFailed ? "failed" : timer.activeState,
    labels: {
      scope: snapshot.scope,
      activates,
    },
    state,
  }
}

export const buildCollection = (
  nodeId: string,
  ts: number,
  snapshots: ReadonlyArray<ScopeSnapshot>,
): PluginCollectionResult => {
  const services = snapshots.flatMap((snapshot) =>
    snapshot.services.map((unit) => ({
      scope: snapshot.scope,
      unit,
      details: serviceDetails(snapshot.details.get(unit.unit)),
    })),
  )
  const timers = snapshots.flatMap((snapshot) =>
    snapshot.timers.map((timer) => timerEntity(nodeId, ts, snapshot, timer)),
  )
  const entities = [
    ...services.map(({ scope, unit, details }) => unitEntity(nodeId, ts, scope, unit, details)),
    ...timers,
  ]

  // Each scope gets its own totals so a failed user unit alerts separately from a system one.
  const scopeTotals = (scope: SystemdScope, ids: { total: string; active: string; failed: string }) => {
    const scoped = services.filter((service) => service.scope === scope)
    return [
      { metricId: ids.total, value: scoped.length },
      { metricId: ids.active, value: scoped.filter(({ unit }) => unit.activeState === "active").length },
      { metricId: ids.failed, value: scoped.filter(({ unit }) => unit.activeState === "failed").length },
    ].map(({ metricId, value }) => ({ pluginId: SYSTEMD_PLUGIN_ID, metricId, ts, value, unit: "count" }))
  }

  const metrics = [
    ...scopeTotals("system", {
      total: SYSTEMD_METRIC_IDS.totalUnits,
      active: SYSTEMD_METRIC_IDS.activeUnits,
      failed: SYSTEMD_METRIC_IDS.failedUnits,
    }),
    ...scopeTotals("user", {
      total: SYSTEMD_METRIC_IDS.totalUserUnits,
      active: SYSTEMD_METRIC_IDS.activeUserUnits,
      failed: SYSTEMD_METRIC_IDS.failedUserUnits,
    }),
    ...services.flatMap(({ scope, unit, details }) => {
      const ref = entityRef(nodeId, SYSTEMD_SERVICE_KINDS[scope], unit.unit)
      return [
        ...(details.memoryBytes === null
          ? []
          : [
              {
                pluginId: SYSTEMD_PLUGIN_ID,
                metricId: SYSTEMD_METRIC_IDS.unitMemoryBytes,
                ts,
                entity: ref,
                value: details.memoryBytes,
                unit: "bytes",
              },
            ]),
        ...(details.cpuUsageNs === null
          ? []
          : [
              {
                pluginId: SYSTEMD_PLUGIN_ID,
                metricId: SYSTEMD_METRIC_IDS.unitCpuUsageNs,
                ts,
                entity: ref,
                value: details.cpuUsageNs,
                unit: "ns",
              },
            ]),
      ]
    }),
  ]

  return { entities, metrics }
}

export const createSystemdAgentPlugin = (
  overrides: Partial<SystemdDependencies> = {},
): ScoutAgentPlugin<PluginExecutionError> => {
  const deps = { ...makeDefaultDependencies(), ...overrides } satisfies SystemdDependencies

  const detect = (): Effect.Effect<PluginCapability, PluginExecutionError> =>
    deps.exec("which", ["systemctl"]).pipe(
      Effect.map(({ exitCode }) => ({
        pluginId: SYSTEMD_PLUGIN_ID,
        version: manifest.version,
        status: (exitCode === 0 ? "available" : "unsupported") as PluginCapability["status"],
        features: [...SYSTEMD_FEATURES],
        ...(exitCode !== 0 && { reason: "systemctl not found on node" }),
      })),
      Effect.mapError((error) => failExecution("detect-failed", String(error))),
    )

  const listUnits = (scope: SystemdScope, type: "service" | "timer") =>
    runSystemctl(deps, [...scopeArgs(scope), "list-units", `--type=${type}`, "--all", "--output=json"]).pipe(
      Effect.map(parseSystemctlListUnits),
    )

  /** Each manager's last successful detail read, reused when a later read fails. */
  const lastDetails = new Map<SystemdScope, ReadonlyMap<string, Record<string, string>>>()

  /**
   * Every property in SHOW_PROPERTIES for `units`, in one systemctl call.
   * `--timestamp=us+utc` (systemd 248+) makes timestamps parseable without the
   * agent's locale or timezone; an older systemctl rejects it, so retry bare
   * (its local-time timestamps then read as unknown).
   *
   * If both attempts fail, the scope keeps its last good details, so one
   * manager's transient failure neither strips its units nor holds back the
   * other manager's fresh data. Only a failure before any successful read
   * fails the collection.
   */
  const showUnits = (scope: SystemdScope, units: ReadonlyArray<string>) => {
    if (units.length === 0) {
      return Effect.succeed({
        details: new Map<string, Record<string, string>>() as ReadonlyMap<string, Record<string, string>>,
        fresh: true,
      })
    }
    const args = [...scopeArgs(scope), "show", `--property=${SHOW_PROPERTIES.join(",")}`, ...units]
    return runSystemctl(deps, [...args, "--timestamp=us+utc"]).pipe(
      Effect.catch(() => runSystemctl(deps, args)),
      Effect.map(parseSystemctlShowBatch),
      Effect.tap((details) => Effect.sync(() => lastDetails.set(scope, details))),
      Effect.map((details) => ({ details, fresh: true })),
      Effect.catch((error) => {
        const previous = lastDetails.get(scope)
        return previous === undefined
          ? Effect.fail(error)
          : Effect.succeed({ details: previous, fresh: false })
      }),
    )
  }

  const emptyScope = (scope: SystemdScope): ScopeSnapshot => ({
    scope,
    services: [],
    timers: [],
    schedule: [],
    details: new Map(),
    detailsFresh: true,
  })

  /**
   * One manager's units, timers, and details. Only a failed service listing of
   * the user manager means "no user manager" (e.g. an agent run as a system
   * service without a login session) and yields an empty scope; a failed
   * detail read falls back as `showUnits` describes.
   */
  const collectScope = (scope: SystemdScope): Effect.Effect<ScopeSnapshot, PluginExecutionError> =>
    listUnits(scope, "service").pipe(
      Effect.map((services): ReadonlyArray<SystemdUnitMetrics> | null => services),
      Effect.catch((error) => (scope === "user" ? Effect.succeed(null) : Effect.fail(error))),
      Effect.flatMap((services) =>
        services === null ? Effect.succeed(emptyScope(scope)) : collectListedScope(scope, services),
      ),
    )

  const collectListedScope = (
    scope: SystemdScope,
    services: ReadonlyArray<SystemdUnitMetrics>,
  ): Effect.Effect<ScopeSnapshot, PluginExecutionError> =>
    Effect.all(
      [
        listUnits(scope, "timer").pipe(Effect.orElseSucceed(() => [])),
        runSystemctl(deps, [...scopeArgs(scope), "list-timers", "--all", "--output=json"]).pipe(
          Effect.map(parseSystemctlListTimers),
          Effect.orElseSucceed(() => []),
        ),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.flatMap(([timers, schedule]) =>
        showUnits(scope, [
          ...new Set([
            ...services.map((unit) => unit.unit),
            ...timers.map((timer) => timer.unit),
            // A timer's service may not be loaded, so list-units can miss it.
            ...schedule.map((entry) => entry.activates).filter((unit) => unit.length > 0),
          ]),
        ]).pipe(
          Effect.map(({ details, fresh }) => ({
            scope,
            services,
            timers,
            schedule,
            details,
            detailsFresh: fresh,
          })),
        ),
      ),
    )

  const collect = (ctx: { readonly nodeId: string; readonly now: number }) =>
    Effect.all([collectScope("system"), collectScope("user")], { concurrency: "unbounded" }).pipe(
      Effect.map((snapshots) => buildCollection(ctx.nodeId, ctx.now, snapshots)),
    )

  const executeUnitAction = (verb: string, actionId: string, target: ActionTarget) =>
    getTargetService(target, { actionId }).pipe(
      Effect.flatMap(({ unit, scope }) =>
        runSystemctlMutation(deps, [...scopeArgs(scope), verb, unit], actionId),
      ),
      Effect.as({}),
    )

  const actions: ReadonlyArray<ScoutActionHandler<unknown, unknown, PluginExecutionError>> = [
    {
      definition: manifest.actions.find((action) => action.id === SYSTEMD_ACTION_IDS.startUnit)!,
      inputSchema: EmptyInputSchema,
      outputSchema: EmptyInputSchema,
      execute: (_ctx, target: ActionTarget, _input: unknown) =>
        executeUnitAction("start", SYSTEMD_ACTION_IDS.startUnit, target),
    },
    {
      definition: manifest.actions.find((action) => action.id === SYSTEMD_ACTION_IDS.stopUnit)!,
      inputSchema: EmptyInputSchema,
      outputSchema: EmptyInputSchema,
      execute: (_ctx, target: ActionTarget, _input: unknown) =>
        executeUnitAction("stop", SYSTEMD_ACTION_IDS.stopUnit, target),
    },
    {
      definition: manifest.actions.find((action) => action.id === SYSTEMD_ACTION_IDS.restartUnit)!,
      inputSchema: EmptyInputSchema,
      outputSchema: EmptyInputSchema,
      execute: (_ctx, target: ActionTarget, _input: unknown) =>
        executeUnitAction("restart", SYSTEMD_ACTION_IDS.restartUnit, target),
    },
    {
      definition: manifest.actions.find((action) => action.id === SYSTEMD_ACTION_IDS.enableUnit)!,
      inputSchema: EmptyInputSchema,
      outputSchema: EmptyInputSchema,
      execute: (_ctx, target: ActionTarget, _input: unknown) =>
        executeUnitAction("enable", SYSTEMD_ACTION_IDS.enableUnit, target),
    },
    {
      definition: manifest.actions.find((action) => action.id === SYSTEMD_ACTION_IDS.disableUnit)!,
      inputSchema: EmptyInputSchema,
      outputSchema: EmptyInputSchema,
      execute: (_ctx, target: ActionTarget, _input: unknown) =>
        executeUnitAction("disable", SYSTEMD_ACTION_IDS.disableUnit, target),
    },
    {
      definition: manifest.actions.find((action) => action.id === SYSTEMD_ACTION_IDS.daemonReload)!,
      inputSchema: EmptyInputSchema,
      outputSchema: EmptyInputSchema,
      execute: (_ctx, _target: ActionTarget, _input: unknown) =>
        runSystemctlMutation(deps, ["daemon-reload"], SYSTEMD_ACTION_IDS.daemonReload).pipe(Effect.as({})),
    },
    {
      definition: manifest.actions.find((action) => action.id === SYSTEMD_ACTION_IDS.readUnitFile)!,
      inputSchema: EmptyInputSchema,
      outputSchema: UnitFileSchema,
      execute: (_ctx, target: ActionTarget, _input: unknown) =>
        getTargetService(target, { actionId: SYSTEMD_ACTION_IDS.readUnitFile }).pipe(
          Effect.flatMap(({ unit, scope }) =>
            getUnitFilePath(deps, unit, scope, SYSTEMD_ACTION_IDS.readUnitFile).pipe(
              Effect.flatMap((path) =>
                deps.readFile(path).pipe(
                  Effect.map((content) => ({ path, content })),
                  Effect.mapError((error) =>
                    failExecution("read-error", String(error), {
                      actionId: SYSTEMD_ACTION_IDS.readUnitFile,
                    }),
                  ),
                ),
              ),
            ),
          ),
        ),
    },
    {
      definition: manifest.actions.find((action) => action.id === SYSTEMD_ACTION_IDS.writeUnitFile)!,
      inputSchema: UnitFileWriteInputSchema,
      outputSchema: EmptyInputSchema,
      execute: (_ctx, target: ActionTarget, input: unknown) =>
        getTargetService(target, { actionId: SYSTEMD_ACTION_IDS.writeUnitFile }).pipe(
          Effect.flatMap(({ unit, scope }) =>
            getUnitFilePath(deps, unit, scope, SYSTEMD_ACTION_IDS.writeUnitFile).pipe(
              Effect.flatMap((targetPath) => {
                const tempPath = deps.makeTempPath("scout-systemd-unit")
                const { content } = input as { content: string }
                return deps.writeFile(tempPath, content).pipe(
                  Effect.flatMap(() =>
                    runChecked(deps, "systemd-analyze", ["verify", tempPath]).pipe(
                      Effect.mapError(() =>
                        failExecution("verify-failed", "systemd-analyze verify failed", {
                          actionId: SYSTEMD_ACTION_IDS.writeUnitFile,
                        }),
                      ),
                    ),
                  ),
                  Effect.flatMap(() =>
                    deps
                      .copyFile(tempPath, targetPath)
                      .pipe(
                        Effect.mapError((error) =>
                          /EACCES|EPERM|permission denied/i.test(String(error))
                            ? permissionDenied(`Writing ${targetPath}`, SYSTEMD_ACTION_IDS.writeUnitFile)
                            : error,
                        ),
                      ),
                  ),
                  Effect.flatMap(() =>
                    runSystemctlMutation(
                      deps,
                      [...scopeArgs(scope), "daemon-reload"],
                      SYSTEMD_ACTION_IDS.writeUnitFile,
                    ),
                  ),
                  Effect.as({}),
                  Effect.ensuring(deps.unlink(tempPath)),
                  Effect.mapError((error) =>
                    error instanceof PluginExecutionError
                      ? error
                      : failExecution("write-error", String(error), {
                          actionId: SYSTEMD_ACTION_IDS.writeUnitFile,
                        }),
                  ),
                )
              }),
            ),
          ),
        ),
    },
  ]

  const streams: ReadonlyArray<ScoutStreamHandler<unknown, LogChunk, PluginExecutionError>> = [
    {
      definition: manifest.streams.find((stream) => stream.id === SYSTEMD_STREAM_IDS.unitLogs)!,
      inputSchema: UnitLogsInputSchema,
      chunkSchema: LogChunkSchema,
      open: (_ctx, target: ActionTarget, input: unknown) =>
        Stream.unwrap(
          getTargetService(target, { streamId: SYSTEMD_STREAM_IDS.unitLogs }).pipe(
            Effect.map(({ unit, scope }) =>
              deps.followJournal(unit, (input as { tail?: number }).tail ?? DEFAULT_LOG_TAIL, scope).pipe(
                Stream.mapError((error) =>
                  error instanceof PluginExecutionError
                    ? error
                    : failExecution("stream-failed", String(error), {
                        streamId: SYSTEMD_STREAM_IDS.unitLogs,
                      }),
                ),
              ),
            ),
          ),
        ),
    },
  ]

  return {
    detect,
    collect,
    actions,
    streams,
  } satisfies ScoutAgentPlugin<PluginExecutionError>
}

export const agent = createSystemdAgentPlugin()
