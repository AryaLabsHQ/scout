import { defineScoutHubPlugin } from "@scout/plugin-sdk"
import { manifest } from "./manifest.js"

export const hub = defineScoutHubPlugin({
  alerts: manifest.alerts,
})
