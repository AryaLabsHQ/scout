import { Schema } from "effect"
import type { ViewDefinition } from "@scout/plugin-sdk"

export const SYSTEMD_PLUGIN_ID = "systemd"
export const SYSTEMD_CAPABILITY_ID = "systemd"
export const SYSTEMD_UNIT_KIND = "systemd.unit"

export const SYSTEMD_FEATURES = [
  "collect",
  "actions",
  "logs",
  "unit-files",
] as const

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

export const systemdViews: ReadonlyArray<ViewDefinition> = [
  {
    id: "systemd.dashboard",
    pluginId: SYSTEMD_PLUGIN_ID,
    kind: "dashboard",
    title: "Systemd",
    sections: [
      {
        _tag: "stat-grid",
        title: "Fleet Summary",
        metrics: [
          { metricId: SYSTEMD_METRIC_IDS.totalUnits, label: "Units" },
          { metricId: SYSTEMD_METRIC_IDS.activeUnits, label: "Active" },
          { metricId: SYSTEMD_METRIC_IDS.failedUnits, label: "Failed" },
        ],
      },
      {
        _tag: "entity-table",
        title: "Units",
        entityKind: SYSTEMD_UNIT_KIND,
        columns: [
          { id: "unit", label: "Unit", source: { _tag: "field", path: "ref.id" } },
          { id: "description", label: "Description", source: { _tag: "field", path: "state.description" } },
          { id: "status", label: "Status", source: { _tag: "status" } },
          { id: "subState", label: "Substate", source: { _tag: "field", path: "state.subState" } },
          { id: "pid", label: "PID", source: { _tag: "field", path: "state.pid" } },
        ],
        actions: [
          { actionId: SYSTEMD_ACTION_IDS.startUnit, label: "Start" },
          { actionId: SYSTEMD_ACTION_IDS.stopUnit, label: "Stop" },
          { actionId: SYSTEMD_ACTION_IDS.restartUnit, label: "Restart" },
        ],
      },
    ],
  },
  {
    id: "systemd.unit-detail",
    pluginId: SYSTEMD_PLUGIN_ID,
    kind: "detail",
    title: "Systemd Unit",
    entityKind: SYSTEMD_UNIT_KIND,
    sections: [
      {
        _tag: "detail",
        title: "Status",
        fields: [
          { id: "unit", label: "Unit", source: { _tag: "field", path: "ref.id" } },
          { id: "description", label: "Description", source: { _tag: "field", path: "state.description" } },
          { id: "status", label: "Status", source: { _tag: "status" } },
          { id: "loadState", label: "Load State", source: { _tag: "field", path: "state.loadState" } },
          { id: "subState", label: "Substate", source: { _tag: "field", path: "state.subState" } },
          { id: "pid", label: "PID", source: { _tag: "field", path: "state.pid" } },
        ],
      },
      {
        _tag: "timeseries",
        title: "Resource Usage",
        metrics: [
          { metricId: SYSTEMD_METRIC_IDS.unitMemoryBytes, label: "Memory", unit: "bytes" },
          { metricId: SYSTEMD_METRIC_IDS.unitCpuUsageNs, label: "CPU Time", unit: "ns" },
        ],
      },
      {
        _tag: "actions",
        title: "Controls",
        actions: [
          { actionId: SYSTEMD_ACTION_IDS.startUnit, label: "Start" },
          { actionId: SYSTEMD_ACTION_IDS.stopUnit, label: "Stop" },
          { actionId: SYSTEMD_ACTION_IDS.restartUnit, label: "Restart" },
          { actionId: SYSTEMD_ACTION_IDS.enableUnit, label: "Enable" },
          { actionId: SYSTEMD_ACTION_IDS.disableUnit, label: "Disable" },
          { actionId: SYSTEMD_ACTION_IDS.readUnitFile, label: "View Unit File" },
        ],
      },
      {
        _tag: "logs",
        title: "Journal",
        streamId: SYSTEMD_STREAM_IDS.unitLogs,
      },
    ],
  },
]
