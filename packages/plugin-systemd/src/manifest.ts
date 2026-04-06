import { definePluginManifest } from "@scout/plugin-sdk"
import {
  SYSTEMD_ACTION_IDS,
  SYSTEMD_CAPABILITY_ID,
  SYSTEMD_METRIC_IDS,
  SYSTEMD_PLUGIN_ID,
  SYSTEMD_STREAM_IDS,
  SYSTEMD_UNIT_KIND,
} from "./contracts.js"

export const manifest = definePluginManifest({
  apiVersion: "v0alpha1",
  id: SYSTEMD_PLUGIN_ID,
  displayName: "Systemd",
  version: "0.0.1",
  description: "Monitor and control systemd units on Linux nodes.",
  runtimes: ["agent", "hub", "web"],
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
      id: SYSTEMD_METRIC_IDS.unitMemoryBytes,
      displayName: "Unit Memory",
      kind: "gauge",
      entityKinds: [SYSTEMD_UNIT_KIND],
      unit: "bytes",
    },
    {
      id: SYSTEMD_METRIC_IDS.unitCpuUsageNs,
      displayName: "Unit CPU Time",
      kind: "counter",
      entityKinds: [SYSTEMD_UNIT_KIND],
      unit: "ns",
    },
  ],
  actions: [
    {
      id: SYSTEMD_ACTION_IDS.startUnit,
      displayName: "Start Unit",
      targetKinds: [SYSTEMD_UNIT_KIND],
      permissions: ["node:systemd", "node:spawn-process"],
      requiresConfirmation: false,
    },
    {
      id: SYSTEMD_ACTION_IDS.stopUnit,
      displayName: "Stop Unit",
      targetKinds: [SYSTEMD_UNIT_KIND],
      permissions: ["node:systemd", "node:spawn-process"],
      requiresConfirmation: true,
    },
    {
      id: SYSTEMD_ACTION_IDS.restartUnit,
      displayName: "Restart Unit",
      targetKinds: [SYSTEMD_UNIT_KIND],
      permissions: ["node:systemd", "node:spawn-process"],
      requiresConfirmation: true,
    },
    {
      id: SYSTEMD_ACTION_IDS.enableUnit,
      displayName: "Enable Unit",
      targetKinds: [SYSTEMD_UNIT_KIND],
      permissions: ["node:systemd", "node:spawn-process"],
      requiresConfirmation: false,
    },
    {
      id: SYSTEMD_ACTION_IDS.disableUnit,
      displayName: "Disable Unit",
      targetKinds: [SYSTEMD_UNIT_KIND],
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
      targetKinds: [SYSTEMD_UNIT_KIND],
      permissions: ["node:systemd", "node:read-files", "node:spawn-process"],
      requiresConfirmation: false,
    },
    {
      id: SYSTEMD_ACTION_IDS.writeUnitFile,
      displayName: "Write Unit File",
      targetKinds: [SYSTEMD_UNIT_KIND],
      permissions: ["node:systemd", "node:read-files", "node:write-files", "node:spawn-process"],
      requiresConfirmation: true,
    },
  ],
  streams: [
    {
      id: SYSTEMD_STREAM_IDS.unitLogs,
      displayName: "Unit Logs",
      kind: "logs",
      targetKinds: [SYSTEMD_UNIT_KIND],
      permissions: ["node:systemd", "node:stream-logs", "node:spawn-process"],
    },
  ],
  alerts: [
    {
      id: "unit.failed",
      displayName: "Failed unit",
      description: "A systemd unit entered the failed state.",
      severity: "critical",
      entityKinds: [SYSTEMD_UNIT_KIND],
      metricIds: [SYSTEMD_METRIC_IDS.failedUnits],
    },
  ],
})
