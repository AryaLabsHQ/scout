import { defineAgent } from "@scout/plugin-sdk"
import { agent as edgeAgent } from "./edge.js"

export const agent = defineAgent(edgeAgent)
