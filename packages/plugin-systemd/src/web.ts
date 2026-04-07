import { defineScoutWebPlugin } from "@scout/plugin-sdk"
import { systemdScreens } from "./contracts.js"

export const web = defineScoutWebPlugin({
  screens: systemdScreens,
})
