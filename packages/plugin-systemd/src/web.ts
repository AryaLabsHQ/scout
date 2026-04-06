import { defineScoutWebPlugin } from "@scout/plugin-sdk"
import { systemdViews } from "./contracts.js"

export const web = defineScoutWebPlugin({
  views: systemdViews,
})
