import { definePluginManifest } from "../../../../src/index.js"

export const manifest = definePluginManifest({
  apiVersion: "v0alpha1",
  id: "fixture-valid",
  displayName: "Fixture Valid Plugin",
  version: "0.1.0",
  description: "Fixture plugin used for loader tests",
  runtimes: ["agent", "hub", "web"],
  permissions: ["node:read-files"],
  capabilities: [
    {
      id: "fixtures",
      displayName: "Fixture Capability",
    },
  ],
  entityKinds: [
    {
      id: "thing",
      displayName: "Thing",
      pluralDisplayName: "Things",
    },
  ],
  metrics: [
    {
      id: "thing.count",
      displayName: "Thing Count",
      kind: "gauge",
      entityKinds: ["thing"],
    },
  ],
  actions: [
    {
      id: "refresh",
      displayName: "Refresh",
      targetKinds: ["thing"],
      permissions: ["node:read-files"],
      requiresConfirmation: false,
    },
  ],
  streams: [
    {
      id: "events",
      displayName: "Events",
      kind: "events",
      targetKinds: ["thing"],
      permissions: ["node:read-files"],
    },
  ],
  alerts: [],
})
