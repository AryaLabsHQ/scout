import { defineWeb } from "@scout/plugin-sdk"
import { edgeScreens } from "./contracts.js"

export const web = defineWeb({
  screens: edgeScreens,
})
