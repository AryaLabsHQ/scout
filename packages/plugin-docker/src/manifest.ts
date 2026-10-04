import type { PluginManifest } from "@scout/plugin-sdk"
import {
  DOCKER_ACTION_DEFINITIONS,
  DOCKER_CAPABILITIES,
  DOCKER_ENTITY_KIND_DEFINITIONS,
  DOCKER_METRIC_DEFINITIONS,
  DOCKER_PLUGIN_ID,
  DOCKER_STREAM_DEFINITIONS,
} from "./contracts.js"

export const manifest = {
  apiVersion: "v0alpha1",
  id: DOCKER_PLUGIN_ID,
  displayName: "Docker",
  version: "0.0.1",
  description: "Inspect Docker daemons, containers, images, networks, and volumes from Scout.",
  permissions: ["node:docker-socket", "node:stream-logs", "node:network-egress", "node:read-files"],
  capabilities: DOCKER_CAPABILITIES,
  entityKinds: DOCKER_ENTITY_KIND_DEFINITIONS,
  metrics: DOCKER_METRIC_DEFINITIONS,
  actions: DOCKER_ACTION_DEFINITIONS,
  streams: DOCKER_STREAM_DEFINITIONS,
  alerts: [],
} satisfies PluginManifest
