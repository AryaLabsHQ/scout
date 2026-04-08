import { defineWeb } from "@scout/plugin-sdk"
import { K8S_UI_SCREENS } from "./contracts.js"

export const web = defineWeb({
  screens: K8S_UI_SCREENS,
})
