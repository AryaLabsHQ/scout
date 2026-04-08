import { defineAgent } from "@scout/plugin-sdk"
import { agent as systemdAgent } from "./systemd.js"

export const agent = defineAgent(systemdAgent)
