import { definePluginManifest } from "@scout/plugin-sdk"
import {
  K8S_ACTION_DEFINITIONS,
  K8S_CAPABILITIES,
  K8S_ENTITY_KIND_DEFINITIONS,
  K8S_METRIC_DEFINITIONS,
  K8S_PLUGIN_ID,
  K8S_STREAM_DEFINITIONS,
} from "./contracts.js"

export const manifest = definePluginManifest({
  apiVersion: "v0alpha1",
  id: K8S_PLUGIN_ID,
  displayName: "Kubernetes",
  version: "0.0.1",
  description: "Inspect Kubernetes clusters and workloads from Scout.",
  runtimes: ["agent", "hub", "web"],
  permissions: [
    "node:k8s-api",
    "node:spawn-process",
    "node:stream-logs",
    "node:read-files",
  ],
  capabilities: K8S_CAPABILITIES,
  entityKinds: K8S_ENTITY_KIND_DEFINITIONS,
  metrics: K8S_METRIC_DEFINITIONS,
  actions: K8S_ACTION_DEFINITIONS,
  streams: K8S_STREAM_DEFINITIONS,
  alerts: [],
})
