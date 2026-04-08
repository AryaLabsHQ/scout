import { definePlugin } from "@scout/plugin-sdk"
import { agent } from "./agent.js"
import { hub } from "./hub.js"
import { manifest } from "./manifest.js"
import { operator } from "./operator.js"
import { web } from "./web.js"

export const plugin = definePlugin({
  manifest,
  agent,
  hub,
  web,
  operator,
})

export default plugin
