import { defineHub } from "@scout/plugin-sdk"
import { manifest } from "./manifest.js"

export const hub = defineHub({
  alerts: manifest.alerts,
})
