import { defineWeb } from "@scout/plugin-sdk"
import { DOCKER_UI_SCREENS } from "./contracts.js"

export const web = defineWeb({
  screens: DOCKER_UI_SCREENS,
})
