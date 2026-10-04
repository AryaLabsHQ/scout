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
        "Prefer observe_plugins before plugin_run_action or plugin_logs so the operator uses discovered Docker actions and streams.",
        "Use bash_run only when the Docker plugin does not already expose the capability you need.",
      ].join("\n"),
    }),
  ],
  skills: [
    defineOperatorSkill({
      id: "docker-ops",
      name: "Docker Operations",
      description: "Guidance for diagnosing and operating Docker workloads through Scout.",
      content: [
        "Start with observe_plugins and plugin_logs before using bash_run.",
        "Prefer typed Docker actions over shell commands when the plugin already exposes them.",
        "Treat restart-like actions as mutating and confirm impact on running workloads first.",
      ].join("\n"),
    }),
  ],
})
