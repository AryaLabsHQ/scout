import { defineAgent } from "@scout/plugin-sdk"
import { docker } from "./docker.js"

export const agent = defineAgent(docker)
