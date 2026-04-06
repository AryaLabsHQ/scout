import { defineScoutWebPlugin } from "@scout/plugin-sdk"
import { K8S_VIEW_DEFINITIONS } from "./contracts.js"

export const web = defineScoutWebPlugin({
  views: K8S_VIEW_DEFINITIONS,
})
