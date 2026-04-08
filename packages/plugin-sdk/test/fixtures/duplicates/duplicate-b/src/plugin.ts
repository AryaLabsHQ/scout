import { definePlugin } from "../../../../../src/index.js"

export const plugin = definePlugin({
  manifest: {
    apiVersion: "v0alpha1",
    id: "fixture-duplicate",
    displayName: "Duplicate B",
    version: "0.1.0",
    description: "Duplicate plugin id fixture B",
    permissions: [],
    capabilities: [],
    entityKinds: [],
    metrics: [],
    actions: [],
    streams: [],
    alerts: [],
  },
})

export default plugin
