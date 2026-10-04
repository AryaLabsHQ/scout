import type { EntitySnapshot } from "@scout/plugin-sdk"
import { SYSTEMD_ACTION_IDS } from "@scout/plugin-systemd/contracts"
import type { StatusTone } from "@/components/status-dot"

/** The fields the systemd plugin reports in a unit entity's `state`. */
export interface SystemdUnitState {
  readonly description: string
  readonly loadState: string
  readonly activeState: string
  readonly subState: string
  readonly pid: number | null
  readonly memoryBytes: number | null
  readonly cpuUsageNs: number | null
}

const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback)
const asNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null)

export function unitState(entity: EntitySnapshot): SystemdUnitState {
  const state = (typeof entity.state === "object" && entity.state !== null ? entity.state : {}) as Record<string, unknown>
  return {
    description: asString(state["description"], entity.displayName ?? ""),
    loadState: asString(state["loadState"], entity.labels?.["loadState"] ?? ""),
    activeState: asString(state["activeState"], entity.status ?? ""),
    subState: asString(state["subState"], entity.labels?.["subState"] ?? ""),
    pid: asNumber(state["pid"]),
    memoryBytes: asNumber(state["memoryBytes"]),
    cpuUsageNs: asNumber(state["cpuUsageNs"]),
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

/** Display name: the unit id without its `.service` suffix. */
export const shortUnitName = (id: string): string => id.replace(/\.service$/, "")

/** Failed units first, then by name. */
export const byFailedThenName = (a: EntitySnapshot, b: EntitySnapshot): number =>
  Number(unitState(b).activeState === "failed") - Number(unitState(a).activeState === "failed") ||
  a.ref.id.localeCompare(b.ref.id)

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
