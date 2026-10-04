import { Schema } from "effect"
import type { PluginUiScreen } from "@scout/plugin-sdk"

export const SYSTEMD_PLUGIN_ID = "systemd"
export const SYSTEMD_CAPABILITY_ID = "systemd"
/** A service unit of the system manager (`systemctl`). */
export const SYSTEMD_UNIT_KIND = "systemd.unit"
/** A service unit of the agent user's manager (`systemctl --user`). */
export const SYSTEMD_USER_UNIT_KIND = "systemd.user-unit"
/** A timer unit of the system manager. */
export const SYSTEMD_TIMER_KIND = "systemd.timer"
/** A timer unit of the agent user's manager. */
export const SYSTEMD_USER_TIMER_KIND = "systemd.user-timer"

/**
 * Which systemd manager owns a unit. The two managers have separate unit
 * namespaces (both can run a `dbus.service`), so each scope gets its own
 * entity kinds and user-scope commands run `systemctl --user`.
 */
export type SystemdScope = "system" | "user"

export const SYSTEMD_SERVICE_KINDS = {
  system: SYSTEMD_UNIT_KIND,
  user: SYSTEMD_USER_UNIT_KIND,
} as const satisfies Record<SystemdScope, string>

export const SYSTEMD_TIMER_KINDS = {
  system: SYSTEMD_TIMER_KIND,
  user: SYSTEMD_USER_TIMER_KIND,
} as const satisfies Record<SystemdScope, string>

/** The scope a service or timer entity kind belongs to, or null for any other kind. */
export const systemdScopeOfKind = (kind: string): SystemdScope | null => {
  switch (kind) {
    case SYSTEMD_UNIT_KIND:
    case SYSTEMD_TIMER_KIND:
      return "system"
    case SYSTEMD_USER_UNIT_KIND:
    case SYSTEMD_USER_TIMER_KIND:
      return "user"
    default:
      return null
  }
}

export const SYSTEMD_FEATURES = ["collect", "actions", "logs", "unit-files", "timers", "user-units"] as const

const NullableString = Schema.NullOr(Schema.String)
const NullableNumber = Schema.NullOr(Schema.Number)
const ScopeSchema = Schema.Literals(["system", "user"])

/**
 * `state` of a `systemd.unit` / `systemd.user-unit` entity. Timestamps are
 * epoch milliseconds. `execMainStatus` is the main process exit status of the
 * last run and is null until the unit's main process has exited once.
 */
export const SystemdUnitStateSchema = Schema.Struct({
  scope: ScopeSchema,
  description: Schema.String,
  loadState: Schema.String,
  activeState: Schema.String,
  subState: Schema.String,
  unitFileState: NullableString,
  result: NullableString,
  execMainStatus: NullableNumber,
  execMainExitAt: NullableNumber,
  activeEnterAt: NullableNumber,
  restarts: NullableNumber,
  pid: NullableNumber,
  memoryBytes: NullableNumber,
  cpuUsageNs: NullableNumber,
})

/**
 * `state` of a `systemd.timer` / `systemd.user-timer` entity. `lastResult`,
 * `lastExitStatus`, and `lastExitAt` describe the last run of the unit the
 * timer activates; `activatesState` is that unit's current active state.
 */
export const SystemdTimerStateSchema = Schema.Struct({
  scope: ScopeSchema,
  description: Schema.String,
  activeState: Schema.String,
  subState: Schema.String,
  unitFileState: NullableString,
  activates: Schema.String,
  nextRunAt: NullableNumber,
  lastTriggerAt: NullableNumber,
  activatesState: NullableString,
  lastResult: NullableString,
  lastExitStatus: NullableNumber,
  lastExitAt: NullableNumber,
})

export type SystemdUnitState = typeof SystemdUnitStateSchema.Type
export type SystemdTimerState = typeof SystemdTimerStateSchema.Type

export const SYSTEMD_METRIC_IDS = {
  totalUnits: "units.total",
  activeUnits: "units.active",
  failedUnits: "units.failed",
  unitMemoryBytes: "unit.memory.bytes",
  unitCpuUsageNs: "unit.cpu.usage.ns",
} as const

export const SYSTEMD_ACTION_IDS = {
  startUnit: "unit.start",
  stopUnit: "unit.stop",
  restartUnit: "unit.restart",
  enableUnit: "unit.enable",
  disableUnit: "unit.disable",
  daemonReload: "daemon.reload",
  readUnitFile: "unit-file.read",
  writeUnitFile: "unit-file.write",
} as const

export const SYSTEMD_STREAM_IDS = {
  unitLogs: "unit.logs",
} as const

export const EmptyInputSchema = Schema.Struct({})

export const UnitFileSchema = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
})

export const UnitFileWriteInputSchema = Schema.Struct({
  content: Schema.String,
})

export const UnitLogsInputSchema = Schema.Struct({
  tail: Schema.optionalKey(Schema.Number),
})

export type UnitFile = typeof UnitFileSchema.Type
export type EmptyInput = typeof EmptyInputSchema.Type
export type UnitFileWriteInput = typeof UnitFileWriteInputSchema.Type
export type UnitLogsInput = typeof UnitLogsInputSchema.Type

const entityRefState = {
  $state: "/selectedEntity/ref",
} as const

const selectedEntityVisible = {
  $state: "/selectedEntity",
} as const

const unitsStatePath = `/entitiesByKind/${SYSTEMD_UNIT_KIND}` as const

export const systemdScreens: ReadonlyArray<PluginUiScreen> = [
  {
    id: "systemd.overview",
    pluginId: SYSTEMD_PLUGIN_ID,
    kind: "overview",
    title: "Systemd",
    spec: {
      root: "page",
      elements: {
        page: {
          type: "Page",
          props: {
            title: "Systemd",
            subtitle: "Inspect unit health, resource usage, and journal logs.",
          },
          children: ["summarySection", "unitsSection"],
        },
        summarySection: {
          type: "Section",
          props: {
            title: "Fleet Summary",
          },
          children: ["summaryGrid"],
        },
        summaryGrid: {
          type: "Grid",
          props: {
            columns: 3,
            gap: "md",
          },
          children: ["totalUnitsStat", "activeUnitsStat", "failedUnitsStat"],
        },
        totalUnitsStat: {
          type: "StatCard",
          props: {
            label: "Units",
            metricId: SYSTEMD_METRIC_IDS.totalUnits,
            value: { $state: `/metricsLatest/${SYSTEMD_METRIC_IDS.totalUnits}` },
            tone: "default",
          },
        },
        activeUnitsStat: {
          type: "StatCard",
          props: {
            label: "Active",
            metricId: SYSTEMD_METRIC_IDS.activeUnits,
            value: { $state: `/metricsLatest/${SYSTEMD_METRIC_IDS.activeUnits}` },
            tone: "success",
          },
        },
        failedUnitsStat: {
          type: "StatCard",
          props: {
            label: "Failed",
            metricId: SYSTEMD_METRIC_IDS.failedUnits,
            value: { $state: `/metricsLatest/${SYSTEMD_METRIC_IDS.failedUnits}` },
            tone: "danger",
          },
        },
        unitsSection: {
          type: "Section",
          props: {
            title: "Units",
            description: "Browse units and jump into detailed controls.",
          },
          children: ["unitsToolbar", "unitsTable"],
        },
        unitsToolbar: {
          type: "Stack",
          props: {
            direction: "row",
            gap: "sm",
            justify: "end",
          },
          children: ["daemonReloadButton"],
        },
        daemonReloadButton: {
          type: "ActionButton",
          props: {
            label: "Reload systemd",
            variant: "secondary",
          },
          on: {
            press: {
              action: "plugin.runAction",
              params: {
                pluginId: SYSTEMD_PLUGIN_ID,
                actionId: SYSTEMD_ACTION_IDS.daemonReload,
                target: {
                  nodeId: {
                    $state: "/system/id",
                  },
                },
              },
            },
          },
        },
        unitsTable: {
          type: "EntityTable",
          props: {
            entityKind: SYSTEMD_UNIT_KIND,
            statePath: unitsStatePath,
            detailScreenId: "systemd.unit-detail",
            columns: [
              {
                id: "unit",
                label: "Unit",
                source: {
                  kind: "field",
                  path: "ref.id",
                },
              },
              {
                id: "description",
                label: "Description",
                source: {
                  kind: "field",
                  path: "state.description",
                },
              },
              {
                id: "status",
                label: "Status",
                source: {
                  kind: "status",
                },
              },
              {
                id: "subState",
                label: "Substate",
                source: {
                  kind: "field",
                  path: "state.subState",
                },
              },
              {
                id: "pid",
                label: "PID",
                source: {
                  kind: "field",
                  path: "state.pid",
                },
              },
            ],
            rowActions: [
              {
                actionId: SYSTEMD_ACTION_IDS.startUnit,
                label: "Start",
              },
              {
                actionId: SYSTEMD_ACTION_IDS.stopUnit,
                label: "Stop",
                variant: "secondary",
              },
              {
                actionId: SYSTEMD_ACTION_IDS.restartUnit,
                label: "Restart",
                variant: "secondary",
              },
            ],
            empty: {
              title: "No units found",
              description: "Systemd did not report any units for this node.",
            },
          },
          on: {
            rowSelect: [
              {
                action: "ui.selectEntity",
                params: {
                  entityRef: {
                    $state: "/event/entityRef",
                  },
                },
              },
              {
                action: "ui.navigate",
                params: {
                  screenId: "systemd.unit-detail",
                  entityRef: {
                    $state: "/event/entityRef",
                  },
                },
              },
            ],
          },
        },
      },
    },
  },
  {
    id: "systemd.unit-detail",
    pluginId: SYSTEMD_PLUGIN_ID,
    kind: "entity-detail",
    title: "Systemd Unit",
    entityKind: SYSTEMD_UNIT_KIND,
    spec: {
      root: "page",
      elements: {
        page: {
          type: "Page",
          props: {
            title: {
              $state: "/selectedEntity/displayName",
            },
            subtitle: {
              $state: "/selectedEntity/ref/id",
            },
          },
          visible: selectedEntityVisible,
          children: ["statusSection", "resourceSection", "controlsSection", "logsSection"],
        },
        statusSection: {
          type: "Section",
          props: {
            title: "Status",
          },
          children: ["statusDetails"],
        },
        statusDetails: {
          type: "DetailList",
          props: {
            entityStatePath: "/selectedEntity",
            fields: [
              {
                id: "unit",
                label: "Unit",
                source: {
                  kind: "field",
                  path: "ref.id",
                },
              },
              {
                id: "description",
                label: "Description",
                source: {
                  kind: "field",
                  path: "state.description",
                },
              },
              {
                id: "status",
                label: "Status",
                source: {
                  kind: "status",
                },
                presentation: "badge",
              },
              {
                id: "loadState",
                label: "Load State",
                source: {
                  kind: "field",
                  path: "state.loadState",
                },
              },
              {
                id: "subState",
                label: "Substate",
                source: {
                  kind: "field",
                  path: "state.subState",
                },
              },
              {
                id: "pid",
                label: "PID",
                source: {
                  kind: "field",
                  path: "state.pid",
                },
              },
            ],
          },
        },
        resourceSection: {
          type: "Section",
          props: {
            title: "Resource Usage",
          },
          children: ["resourceChart"],
        },
        resourceChart: {
          type: "MetricChart",
          props: {
            entityStatePath: "/selectedEntity",
            metrics: [
              {
                metricId: SYSTEMD_METRIC_IDS.unitMemoryBytes,
                label: "Memory",
                unit: "bytes",
              },
              {
                metricId: SYSTEMD_METRIC_IDS.unitCpuUsageNs,
                label: "CPU Time",
                unit: "ns",
              },
            ],
          },
        },
        controlsSection: {
          type: "Section",
          props: {
            title: "Controls",
          },
          children: ["controlsGrid"],
        },
        controlsGrid: {
          type: "Grid",
          props: {
            columns: 3,
            gap: "sm",
          },
          children: [
            "startButton",
            "stopButton",
            "restartButton",
            "enableButton",
            "disableButton",
            "readUnitFileButton",
          ],
        },
        startButton: {
          type: "ActionButton",
          props: {
            label: "Start",
          },
          on: {
            press: {
              action: "plugin.runAction",
              params: {
                pluginId: SYSTEMD_PLUGIN_ID,
                actionId: SYSTEMD_ACTION_IDS.startUnit,
                target: {
                  entityRef: entityRefState,
                },
              },
            },
          },
        },
        stopButton: {
          type: "ActionButton",
          props: {
            label: "Stop",
            variant: "secondary",
          },
          on: {
            press: {
              action: "plugin.runAction",
              params: {
                pluginId: SYSTEMD_PLUGIN_ID,
                actionId: SYSTEMD_ACTION_IDS.stopUnit,
                target: {
                  entityRef: entityRefState,
                },
              },
              confirm: {
                title: "Stop unit?",
                message: "Stopping this unit may interrupt service on the node.",
                confirmLabel: "Stop unit",
                variant: "danger",
              },
            },
          },
        },
        restartButton: {
          type: "ActionButton",
          props: {
            label: "Restart",
            variant: "secondary",
          },
          on: {
            press: {
              action: "plugin.runAction",
              params: {
                pluginId: SYSTEMD_PLUGIN_ID,
                actionId: SYSTEMD_ACTION_IDS.restartUnit,
                target: {
                  entityRef: entityRefState,
                },
              },
              confirm: {
                title: "Restart unit?",
                message: "Scout will issue systemctl restart for the selected unit.",
                confirmLabel: "Restart unit",
              },
            },
          },
        },
        enableButton: {
          type: "ActionButton",
          props: {
            label: "Enable",
            variant: "secondary",
          },
          on: {
            press: {
              action: "plugin.runAction",
              params: {
                pluginId: SYSTEMD_PLUGIN_ID,
                actionId: SYSTEMD_ACTION_IDS.enableUnit,
                target: {
                  entityRef: entityRefState,
                },
              },
            },
          },
        },
        disableButton: {
          type: "ActionButton",
          props: {
            label: "Disable",
            variant: "secondary",
          },
          on: {
            press: {
              action: "plugin.runAction",
              params: {
                pluginId: SYSTEMD_PLUGIN_ID,
                actionId: SYSTEMD_ACTION_IDS.disableUnit,
                target: {
                  entityRef: entityRefState,
                },
              },
              confirm: {
                title: "Disable unit?",
                message: "This prevents the unit from starting automatically.",
                confirmLabel: "Disable unit",
                variant: "danger",
              },
            },
          },
        },
        readUnitFileButton: {
          type: "ActionButton",
          props: {
            label: "View Unit File",
            variant: "ghost",
          },
          on: {
            press: {
              action: "plugin.runAction",
              params: {
                pluginId: SYSTEMD_PLUGIN_ID,
                actionId: SYSTEMD_ACTION_IDS.readUnitFile,
                target: {
                  entityRef: entityRefState,
                },
              },
            },
          },
        },
        logsSection: {
          type: "Section",
          props: {
            title: "Journal",
          },
          children: ["logsPanel"],
        },
        logsPanel: {
          type: "LogPanel",
          props: {
            title: "Journal",
            streamId: SYSTEMD_STREAM_IDS.unitLogs,
            targetEntityStatePath: "/selectedEntity",
            input: {
              tail: 200,
            },
          },
        },
      },
    },
  },
]
