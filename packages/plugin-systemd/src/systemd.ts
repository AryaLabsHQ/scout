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
  SYSTEMD_STREAM_IDS,
  SYSTEMD_UNIT_KIND,
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
  readonly exec: (
    command: string,
    args: ReadonlyArray<string>,
  ) => Effect.Effect<CommandResult, Error>
  readonly readFile: (path: string) => Effect.Effect<string, Error>
  readonly copyFile: (from: string, to: string) => Effect.Effect<void, Error>
  readonly writeFile: (path: string, content: string) => Effect.Effect<void, Error>
  readonly unlink: (path: string) => Effect.Effect<void>
  readonly makeTempPath: (prefix: string) => string
  readonly followJournal: (unit: string, tail: number) => Stream.Stream<LogChunk, Error>
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

const MAX_ACTIVE_SERVICES = 50
const DEFAULT_LOG_TAIL = 200

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

export const parseSystemctlShow = (output: string): {
  readonly pid: number | null
  readonly memoryBytes: number | null
  readonly cpuUsageNs: number | null
} => {
  const fields: Record<string, string> = {}
  for (const line of output.split("\n")) {
    const separator = line.indexOf("=")
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    fields[key] = value
  }

  const rawPid = fields["MainPID"]
  const rawMemory = fields["MemoryCurrent"]
  const rawCpu = fields["CPUUsageNSec"]

  return {
    pid: rawPid && rawPid !== "0" ? Number(rawPid) : null,
    memoryBytes:
      rawMemory && rawMemory !== "[not set]" && !Number.isNaN(Number(rawMemory))
        ? Number(rawMemory)
        : null,
    cpuUsageNs:
      rawCpu && rawCpu !== "[not set]" && Number(rawCpu) > 0 && !Number.isNaN(Number(rawCpu))
        ? Number(rawCpu)
        : null,
  }
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

const failExecution = (
  code: string,
  message: string,
  opts?: { actionId?: string; streamId?: string },
) =>
  new PluginExecutionError({
    code,
    message,
    pluginId: SYSTEMD_PLUGIN_ID,
    ...(opts?.actionId !== undefined && { actionId: opts.actionId }),
    ...(opts?.streamId !== undefined && { streamId: opts.streamId }),
  })

const entityRef = (nodeId: string, unit: string) => ({
  pluginId: SYSTEMD_PLUGIN_ID,
  kind: SYSTEMD_UNIT_KIND,
  nodeId,
  id: unit,
}) as const

const getTargetUnit = (
  target: ActionTarget,
  opts?: { actionId?: string; streamId?: string },
): Effect.Effect<string, PluginExecutionError> => {
  const unit = target.entity?.id
  if (unit === undefined || !validateUnit(unit)) {
    return Effect.fail(
      failExecution("invalid-target", "Systemd actions require a valid unit target", opts),
    )
  }
  return Effect.succeed(unit)
}

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
  makeTempPath: (prefix) =>
    join(tmpdir(), `${prefix}-${randomUUID()}.tmp`),
  followJournal: (unit, tail) =>
    Stream.fromAsyncIterable(
      (async function* () {
        // Unprivileged agents read system unit logs through journal group
        // membership (`adm` or `systemd-journal`).
        const proc = spawn(
          "journalctl",
          ["-f", "-u", unit, "-n", String(tail), "--output=short-iso"],
          { stdio: ["ignore", "pipe", "pipe"] },
        )
        const decoder = new TextDecoder()
        let buffer = ""
        let lineBatch: string[] = []

        try {
          for await (const value of proc.stdout) {
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""

            for (const line of lines) {
              if (line.length === 0) continue
              lineBatch.push(line)
              if (lineBatch.length >= 50) {
                yield { lines: lineBatch.splice(0), ts: Date.now() }
              }
            }

            // Flush what this chunk completed: a quiet unit may write nothing
            // more, so waiting for the next chunk would hold its lines back.
            if (lineBatch.length > 0) {
              yield { lines: lineBatch.splice(0), ts: Date.now() }
            }
          }

          if (buffer.length > 0) {
            lineBatch.push(buffer)
          }
          if (lineBatch.length > 0) {
            yield { lines: lineBatch, ts: Date.now() }
          }
        } finally {
          try {
            proc.kill("SIGTERM")
          } catch {
            /* ignore */
          }
        }
      })(),
      (error) => (error instanceof Error ? error : new Error(String(error))),
    ),
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
      error instanceof PluginExecutionError
        ? error
        : failExecution("command-error", String(error)),
    ),
  )

/** Read-only systemctl queries; these work for any user on the system bus. */
const runSystemctl = (
  deps: SystemdDependencies,
  args: ReadonlyArray<string>,
): Effect.Effect<string, PluginExecutionError> => runChecked(deps, "systemctl", args)

const AUTHORIZATION_DENIED = /interactive authentication required|access denied|not authorized|permission denied/i

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
 * surfaces as a `permission-denied` execution error.
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
          : failExecution("command-failed", `systemctl ${args.join(" ")} exited with ${exitCode}: ${detail}`, {
              actionId,
            }),
      )
    }),
  )

const getUnitFilePath = (
  deps: SystemdDependencies,
  unit: string,
  actionId: string,
): Effect.Effect<string, PluginExecutionError> =>
  runSystemctl(deps, ["show", "-p", "FragmentPath", unit]).pipe(
    Effect.flatMap((output) => {
      const match = output.match(/^FragmentPath=(.+)$/m)
      const path = match?.[1]?.trim() ?? ""
      return path.length > 0
        ? Effect.succeed(path)
        : Effect.fail(
            failExecution("not-found", "Unit file path not found", { actionId }),
          )
    }),
  )

const collectEntities = (
  nodeId: string,
  ts: number,
  units: ReadonlyArray<SystemdUnitMetrics>,
): PluginCollectionResult => {
  const entities = units.map((unit) => ({
    ref: entityRef(nodeId, unit.unit),
    ts,
    displayName: unit.description.length > 0 ? unit.description : unit.unit,
    status: unit.activeState,
    labels: {
      loadState: unit.loadState,
      subState: unit.subState,
    },
    state: {
      description: unit.description,
      loadState: unit.loadState,
      activeState: unit.activeState,
      subState: unit.subState,
      pid: unit.pid,
      memoryBytes: unit.memoryBytes,
      cpuUsageNs: unit.cpuUsageNs,
    },
  }))

  const metrics = [
    {
      pluginId: SYSTEMD_PLUGIN_ID,
      metricId: SYSTEMD_METRIC_IDS.totalUnits,
      ts,
      value: units.length,
      unit: "count",
    },
    {
      pluginId: SYSTEMD_PLUGIN_ID,
      metricId: SYSTEMD_METRIC_IDS.activeUnits,
      ts,
      value: units.filter((unit) => unit.activeState === "active").length,
      unit: "count",
    },
    {
      pluginId: SYSTEMD_PLUGIN_ID,
      metricId: SYSTEMD_METRIC_IDS.failedUnits,
      ts,
      value: units.filter((unit) => unit.activeState === "failed").length,
      unit: "count",
    },
    ...units.flatMap((unit) => {
      const ref = entityRef(nodeId, unit.unit)
      return [
        ...(unit.memoryBytes === null
          ? []
          : [{
              pluginId: SYSTEMD_PLUGIN_ID,
              metricId: SYSTEMD_METRIC_IDS.unitMemoryBytes,
              ts,
              entity: ref,
              value: unit.memoryBytes,
              unit: "bytes",
            }]),
        ...(unit.cpuUsageNs === null
          ? []
          : [{
              pluginId: SYSTEMD_PLUGIN_ID,
              metricId: SYSTEMD_METRIC_IDS.unitCpuUsageNs,
              ts,
              entity: ref,
              value: unit.cpuUsageNs,
              unit: "ns",
            }]),
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

  const collect = (ctx: { readonly nodeId: string; readonly now: number }) =>
    runSystemctl(deps, [
      "list-units",
      "--type=service",
      "--all",
      "--output=json",
    ]).pipe(
      Effect.map(parseSystemctlListUnits),
      Effect.flatMap((units) => {
        const enrichedUnits = new Set(
          units
            .filter((unit) => unit.activeState === "active")
            .slice(0, MAX_ACTIVE_SERVICES)
            .map((unit) => unit.unit),
        )

        return Effect.forEach(
          units,
          (unit) =>
            !enrichedUnits.has(unit.unit)
              ? Effect.succeed(unit)
              : runSystemctl(deps, [
                  "show",
                  unit.unit,
                  "--property=MainPID,MemoryCurrent,CPUUsageNSec",
                ]).pipe(
                  Effect.map((output) => {
                    const resources = parseSystemctlShow(output)
                    return {
                      ...unit,
                      pid: resources.pid,
                      memoryBytes: resources.memoryBytes,
                      cpuUsageNs: resources.cpuUsageNs,
                    }
                  }),
                  Effect.orElseSucceed(() => unit),
                ),
          { concurrency: 8 },
        )
      }),
      Effect.map((units) => collectEntities(ctx.nodeId, ctx.now, units)),
    )

  const executeUnitAction = (verb: string, actionId: string, target: ActionTarget) =>
    getTargetUnit(target, { actionId }).pipe(
      Effect.flatMap((unit) => runSystemctlMutation(deps, [verb, unit], actionId)),
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
        getTargetUnit(target, { actionId: SYSTEMD_ACTION_IDS.readUnitFile }).pipe(
          Effect.flatMap((unit) =>
            getUnitFilePath(deps, unit, SYSTEMD_ACTION_IDS.readUnitFile).pipe(
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
        getTargetUnit(target, { actionId: SYSTEMD_ACTION_IDS.writeUnitFile }).pipe(
          Effect.flatMap((unit) =>
            getUnitFilePath(deps, unit, SYSTEMD_ACTION_IDS.writeUnitFile).pipe(
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
                    deps.copyFile(tempPath, targetPath).pipe(
                      Effect.mapError((error) =>
                        /EACCES|EPERM|permission denied/i.test(String(error))
                          ? permissionDenied(`Writing ${targetPath}`, SYSTEMD_ACTION_IDS.writeUnitFile)
                          : error,
                      ),
                    ),
                  ),
                  Effect.flatMap(() =>
                    runSystemctlMutation(deps, ["daemon-reload"], SYSTEMD_ACTION_IDS.writeUnitFile),
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
          getTargetUnit(target, { streamId: SYSTEMD_STREAM_IDS.unitLogs }).pipe(
            Effect.map((unit) =>
              deps.followJournal(unit, (input as { tail?: number }).tail ?? DEFAULT_LOG_TAIL).pipe(
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
