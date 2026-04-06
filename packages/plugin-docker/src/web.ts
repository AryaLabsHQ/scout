import { defineScoutWebPlugin } from "@scout/plugin-sdk"
import { DOCKER_VIEW_DEFINITIONS } from "./contracts.js"

export const web = defineScoutWebPlugin({
  views: DOCKER_VIEW_DEFINITIONS,
})
