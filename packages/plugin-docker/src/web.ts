import { defineScoutWebPlugin } from "@scout/plugin-sdk"
import { DOCKER_UI_SCREENS } from "./contracts.js"

export const web = defineScoutWebPlugin({
  screens: DOCKER_UI_SCREENS,
})
