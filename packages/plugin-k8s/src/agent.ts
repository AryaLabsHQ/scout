import { defineAgent } from "@scout/plugin-sdk"
import { k8s } from "./k8s.js"

export const agent = defineAgent(k8s)
