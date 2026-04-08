import type { ScoutHubPlugin } from "../../../../src/index.js"
import { defineHub } from "../../../../src/index.js"

export const hub = defineHub({
  alerts: [],
} satisfies ScoutHubPlugin)
