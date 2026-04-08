import { defineWeb } from "@scout/plugin-sdk"
import { systemdScreens } from "./contracts.js"

export const web = defineWeb({
  screens: systemdScreens,
})
