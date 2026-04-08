import {
  defineOperatorResource,
  defineOperatorSkill,
  defineOperator,
} from "@scout/plugin-sdk/operator"

export const operator = defineOperator({
  resources: [
    defineOperatorResource({
      id: "capabilities",
      title: "Docker Operator Capabilities",
      description: "Summary of the Docker plugin's operator-facing capabilities.",
      content: [
        "This plugin exposes Docker inventory, metrics, actions, and bounded logs.",
        "Prefer observe.plugins before plugin.runAction or plugin.logs so the operator uses discovered Docker actions and streams.",
        "Use bash.run only when the Docker plugin does not already expose the capability you need.",
      ].join("\n"),
    }),
  ],
  skills: [
    defineOperatorSkill({
      id: "docker-ops",
      name: "Docker Operations",
      description: "Guidance for diagnosing and operating Docker workloads through Scout.",
      content: [
        "Start with observe.plugins and plugin.logs before using bash.run.",
        "Prefer typed Docker actions over shell commands when the plugin already exposes them.",
        "Treat restart-like actions as mutating and confirm impact on running workloads first.",
      ].join("\n"),
    }),
  ],
})
