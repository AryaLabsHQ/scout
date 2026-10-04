import type { EntitySnapshot } from "@scout/plugin-sdk"
import {
  SYSTEMD_ACTION_IDS,
  SYSTEMD_SERVICE_KINDS,
  SYSTEMD_TIMER_KINDS,
  systemdScopeOfKind,
  type SystemdScope,
  type SystemdTimerState,
  type SystemdUnitState,
} from "@scout/plugin-systemd/contracts"
import type { StatusTone } from "@/components/status-dot"

export type { SystemdScope, SystemdTimerState, SystemdUnitState }

const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback)
const asNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null)
const asNullableString = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null)
const stateRecord = (entity: EntitySnapshot): Record<string, unknown> =>
  (typeof entity.state === "object" && entity.state !== null ? entity.state : {}) as Record<string, unknown>

/** The manager that owns a service or timer entity, from its kind. */
export const entityScope = (entity: EntitySnapshot): SystemdScope => systemdScopeOfKind(entity.ref.kind) ?? "system"

export const isServiceEntity = (entity: EntitySnapshot): boolean =>
  entity.ref.kind === SYSTEMD_SERVICE_KINDS.system || entity.ref.kind === SYSTEMD_SERVICE_KINDS.user

export const isTimerEntity = (entity: EntitySnapshot): boolean =>
  entity.ref.kind === SYSTEMD_TIMER_KINDS.system || entity.ref.kind === SYSTEMD_TIMER_KINDS.user

/**
 * A unit entity's `state` (`SystemdUnitStateSchema`). Read leniently: rows a
 * hub stored before an agent upgrade lack the newer fields, which read as null.
 */
export function unitState(entity: EntitySnapshot): SystemdUnitState {
  const state = stateRecord(entity)
  return {
    scope: entityScope(entity),
    description: asString(state["description"], entity.displayName ?? ""),
    loadState: asString(state["loadState"], entity.labels?.["loadState"] ?? ""),
    activeState: asString(state["activeState"], entity.status ?? ""),
    subState: asString(state["subState"], entity.labels?.["subState"] ?? ""),
    unitFileState: asNullableString(state["unitFileState"]),
    result: asNullableString(state["result"]),
    execMainStatus: asNumber(state["execMainStatus"]),
    execMainExitAt: asNumber(state["execMainExitAt"]),
    activeEnterAt: asNumber(state["activeEnterAt"]),
    restarts: asNumber(state["restarts"]),
    pid: asNumber(state["pid"]),
    memoryBytes: asNumber(state["memoryBytes"]),
    cpuUsageNs: asNumber(state["cpuUsageNs"]),
  }
}

/** A timer entity's `state` (`SystemdTimerStateSchema`). */
export function timerState(entity: EntitySnapshot): SystemdTimerState {
  const state = stateRecord(entity)
  return {
    scope: entityScope(entity),
    description: asString(state["description"], entity.displayName ?? ""),
    activeState: asString(state["activeState"], entity.status ?? ""),
    subState: asString(state["subState"]),
    unitFileState: asNullableString(state["unitFileState"]),
    activates: asString(state["activates"], entity.labels?.["activates"] ?? ""),
    nextRunAt: asNumber(state["nextRunAt"]),
    lastTriggerAt: asNumber(state["lastTriggerAt"]),
    activatesState: asNullableString(state["activatesState"]),
    lastResult: asNullableString(state["lastResult"]),
    lastExitStatus: asNumber(state["lastExitStatus"]),
    lastExitAt: asNumber(state["lastExitAt"]),
  }
}

export function unitTone(state: Pick<SystemdUnitState, "activeState">): StatusTone {
  switch (state.activeState) {
    case "failed":
      return "err"
    case "active":
      return "ok"
    case "activating":
    case "deactivating":
    case "reloading":
      return "warn"
    default:
      return "off"
  }
}

/** A timer whose last run did not succeed. A run that never happened is not a failure. */
export const timerFailed = (state: SystemdTimerState): boolean =>
  state.lastResult !== null && state.lastResult !== "success" && state.lastExitAt !== null

/** The activated unit is running right now (a backup in progress). */
export const timerRunning = (state: SystemdTimerState): boolean =>
  state.activatesState === "active" || state.activatesState === "activating"

export function timerTone(state: SystemdTimerState): StatusTone {
  if (timerFailed(state)) return "err"
  if (state.activeState !== "active") return "off"
  return "ok"
}

/** Display name: the unit id without its `.service` / `.timer` suffix. */
export const shortUnitName = (id: string): string => id.replace(/\.(service|timer)$/, "")

/**
 * Pin key for a unit. System units keep their bare id, so pins saved before
 * user units existed still match; user units carry a `user:` prefix because
 * both managers can own a unit with the same name.
 */
export const pinKey = (scope: SystemdScope, unitId: string): string => (scope === "user" ? `user:${unitId}` : unitId)

/** The `systemctl` prefix for a scope, for confirm dialogs and hints. */
export const systemctlFor = (scope: SystemdScope): string => (scope === "user" ? "systemctl --user" : "systemctl")

/** Failed units first, then by name. */
export const byFailedThenName = (a: EntitySnapshot, b: EntitySnapshot): number =>
  Number(unitState(b).activeState === "failed") - Number(unitState(a).activeState === "failed") ||
  a.ref.id.localeCompare(b.ref.id)

const BACKUP_TIMER = /backup|restic|borg|snapshot|dump/i

/** Timers by what an operator checks first: failed, then backups, then the soonest next run. */
export const byTimerPriority = (a: EntitySnapshot, b: EntitySnapshot): number => {
  const left = timerState(a)
  const right = timerState(b)
  return (
    Number(timerFailed(right)) - Number(timerFailed(left)) ||
    Number(BACKUP_TIMER.test(b.ref.id)) - Number(BACKUP_TIMER.test(a.ref.id)) ||
    (left.nextRunAt ?? Number.MAX_SAFE_INTEGER) - (right.nextRunAt ?? Number.MAX_SAFE_INTEGER) ||
    a.ref.id.localeCompare(b.ref.id)
  )
}

export type UnitActionKind = "start" | "stop" | "restart" | "enable" | "disable"

/** Each unit action: the plugin action id, the systemctl verb, and its confirm copy. */
export const UNIT_ACTIONS: Record<
  UnitActionKind,
  { readonly actionId: string; readonly verb: string; readonly destructive: boolean; readonly effect: string }
> = {
  start: {
    actionId: SYSTEMD_ACTION_IDS.startUnit,
    verb: "Start",
    destructive: false,
    effect: "The unit starts now.",
  },
  restart: {
    actionId: SYSTEMD_ACTION_IDS.restartUnit,
    verb: "Restart",
    destructive: false,
    effect: "The unit stops and starts again; anything it serves drops briefly.",
  },
  stop: {
    actionId: SYSTEMD_ACTION_IDS.stopUnit,
    verb: "Stop",
    destructive: true,
    effect: "The unit stays stopped until someone starts it again.",
  },
  enable: {
    actionId: SYSTEMD_ACTION_IDS.enableUnit,
    verb: "Enable",
    destructive: false,
    effect: "The unit starts at boot.",
  },
  disable: {
    actionId: SYSTEMD_ACTION_IDS.disableUnit,
    verb: "Disable",
    destructive: true,
    effect: "The unit no longer starts at boot.",
  },
}
