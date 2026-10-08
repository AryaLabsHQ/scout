import type { PluginManifest } from "@scout/plugin-sdk"
import {
  SYSTEMD_ACTION_IDS,
  SYSTEMD_CAPABILITY_ID,
  SYSTEMD_METRIC_IDS,
  SYSTEMD_PLUGIN_ID,
  SYSTEMD_STREAM_IDS,
  SYSTEMD_TIMER_KIND,
  SYSTEMD_UNIT_KIND,
  SYSTEMD_USER_TIMER_KIND,
  SYSTEMD_USER_UNIT_KIND,
} from "./contracts.js"

/** Unit actions work on services of either manager; user units go through `systemctl --user`. */
const SERVICE_KINDS = [SYSTEMD_UNIT_KIND, SYSTEMD_USER_UNIT_KIND]

export const manifest = {
  apiVersion: "v0alpha1",
  id: SYSTEMD_PLUGIN_ID,
  displayName: "Systemd",
  version: "0.0.1",
  description: "Monitor and control systemd units on Linux nodes.",
  permissions: [
    "node:systemd",
    "node:spawn-process",
    "node:stream-logs",
    "node:read-files",
    "node:write-files",
  ],
  capabilities: [
    {
      id: SYSTEMD_CAPABILITY_ID,
      displayName: "Systemd",
      description: "Detect, collect, and manage systemd units.",
    },
  ],
  entityKinds: [
    {
      id: SYSTEMD_UNIT_KIND,
      displayName: "Systemd Unit",
      pluralDisplayName: "Systemd Units",
      description: "A systemd service unit on a managed Linux node.",
    },
    {
      id: SYSTEMD_USER_UNIT_KIND,
      displayName: "Systemd User Unit",
      pluralDisplayName: "Systemd User Units",
      description: "A service unit of the agent user's systemd manager (systemctl --user).",
    },
    {
      id: SYSTEMD_TIMER_KIND,
      displayName: "Systemd Timer",
      pluralDisplayName: "Systemd Timers",
      description: "A systemd timer unit: its schedule and the last run of the unit it activates.",
    },
    {
      id: SYSTEMD_USER_TIMER_KIND,
      displayName: "Systemd User Timer",
      pluralDisplayName: "Systemd User Timers",
      description: "A timer unit of the agent user's systemd manager.",
    },
  ],
  metrics: [
    {
      id: SYSTEMD_METRIC_IDS.totalUnits,
      displayName: "Total Units",
      kind: "gauge",
      unit: "count",
    },
    {
      id: SYSTEMD_METRIC_IDS.activeUnits,
      displayName: "Active Units",
      kind: "gauge",
      unit: "count",
    },
    {
      id: SYSTEMD_METRIC_IDS.failedUnits,
      displayName: "Failed Units",
      kind: "gauge",
      unit: "count",
    },
    {
      id: SYSTEMD_METRIC_IDS.totalUserUnits,
      displayName: "Total User Units",
      kind: "gauge",
      unit: "count",
    },
    {
      id: SYSTEMD_METRIC_IDS.activeUserUnits,
      displayName: "Active User Units",
      kind: "gauge",
      unit: "count",
    },
    {
      id: SYSTEMD_METRIC_IDS.failedUserUnits,
      displayName: "Failed User Units",
      kind: "gauge",
      unit: "count",
    },
    {
      id: SYSTEMD_METRIC_IDS.unitMemoryBytes,
      displayName: "Unit Memory",
      kind: "gauge",
      entityKinds: SERVICE_KINDS,
      unit: "bytes",
    },
    {
      id: SYSTEMD_METRIC_IDS.unitCpuUsageNs,
      displayName: "Unit CPU Time",
      kind: "counter",
      entityKinds: SERVICE_KINDS,
      unit: "ns",
    },
  ],
  actions: [
    {
      id: SYSTEMD_ACTION_IDS.startUnit,
      displayName: "Start Unit",
      targetKinds: SERVICE_KINDS,
      permissions: ["node:systemd", "node:spawn-process"],
      requiresConfirmation: false,
    },
    {
      id: SYSTEMD_ACTION_IDS.stopUnit,
      displayName: "Stop Unit",
      targetKinds: SERVICE_KINDS,
      permissions: ["node:systemd", "node:spawn-process"],
      requiresConfirmation: true,
    },
    {
      id: SYSTEMD_ACTION_IDS.restartUnit,
      displayName: "Restart Unit",
      targetKinds: SERVICE_KINDS,
      permissions: ["node:systemd", "node:spawn-process"],
      requiresConfirmation: true,
    },
    {
      id: SYSTEMD_ACTION_IDS.enableUnit,
      displayName: "Enable Unit",
      targetKinds: SERVICE_KINDS,
      permissions: ["node:systemd", "node:spawn-process"],
      requiresConfirmation: false,
    },
    {
      id: SYSTEMD_ACTION_IDS.disableUnit,
      displayName: "Disable Unit",
      targetKinds: SERVICE_KINDS,
      permissions: ["node:systemd", "node:spawn-process"],
      requiresConfirmation: true,
    },
    {
      id: SYSTEMD_ACTION_IDS.daemonReload,
      displayName: "Reload systemd",
      targetKinds: [],
      permissions: ["node:systemd", "node:spawn-process"],
      requiresConfirmation: false,
    },
    {
      id: SYSTEMD_ACTION_IDS.readUnitFile,
      displayName: "Read Unit File",
      targetKinds: SERVICE_KINDS,
      permissions: ["node:systemd", "node:read-files", "node:spawn-process"],
      requiresConfirmation: false,
    },
    {
      id: SYSTEMD_ACTION_IDS.writeUnitFile,
      displayName: "Write Unit File",
      targetKinds: SERVICE_KINDS,
      permissions: ["node:systemd", "node:read-files", "node:write-files", "node:spawn-process"],
      requiresConfirmation: true,
    },
  ],
  streams: [
    {
      id: SYSTEMD_STREAM_IDS.unitLogs,
      displayName: "Unit Logs",
      kind: "logs",
      targetKinds: SERVICE_KINDS,
      permissions: ["node:systemd", "node:stream-logs", "node:spawn-process"],
    },
  ],
  alerts: [
    {
      id: "unit.failed",
      displayName: "Failed unit",
      description: "A system service unit entered the failed state.",
      severity: "critical",
      entityKinds: [SYSTEMD_UNIT_KIND],
      metricIds: [SYSTEMD_METRIC_IDS.failedUnits],
    },
    {
      id: "user-unit.failed",
      displayName: "Failed user unit",
      description: "A service unit of the agent user's manager entered the failed state.",
      severity: "warning",
      entityKinds: [SYSTEMD_USER_UNIT_KIND],
      metricIds: [SYSTEMD_METRIC_IDS.failedUserUnits],
    },
  ],
} satisfies PluginManifest
