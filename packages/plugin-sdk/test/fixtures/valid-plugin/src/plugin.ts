import { definePlugin } from "../../../../src/index.js"
import { agent } from "./agent.js"
import { hub } from "./hub.js"
import { manifest } from "./manifest.js"
import { defineOperator } from "../../../../src/operator.js"
import { web } from "./web.js"

const operator = defineOperator({
  skills: [
    {
      id: "fixture-skill",
      name: "Fixture Skill",
      description: "Fixture operator skill",
      content: "Prefer typed fixture capabilities first.",
    },
  ],
})

export const plugin = definePlugin({
  manifest,
  agent,
  hub,
  web,
  operator,
})

export default plugin
