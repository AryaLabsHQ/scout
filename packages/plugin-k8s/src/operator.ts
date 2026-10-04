import {
  defineOperatorResource,
  defineOperatorSkill,
  defineOperator,
} from "@scout/plugin-sdk/operator"

export const operator = defineOperator({
  resources: [
    defineOperatorResource({
      id: "capabilities",
      title: "Kubernetes Operator Capabilities",
      description: "Summary of the Kubernetes plugin's operator-facing capabilities.",
      content: [
        "This plugin exposes Kubernetes inventory, workload actions, and bounded pod logs.",
        "Prefer observe_plugins before plugin_run_action or plugin_logs so the operator stays grounded in discovered Kubernetes capabilities.",
        "Use typed Kubernetes actions for workload changes before falling back to bash_run.",
      ].join("\n"),
    }),
  ],
  skills: [
    defineOperatorSkill({
      id: "k8s-ops",
      name: "Kubernetes Operations",
      description: "Guidance for diagnosing and operating Kubernetes workloads through Scout.",
      content: [
        "Start with observe_plugins to discover installed Kubernetes actions, streams, and entity counts.",
        "Prefer plugin_logs for bounded pod log inspection before opening broader shell sessions.",
        "Treat scaling and restart-like actions as mutating operations that deserve explicit review.",
      ].join("\n"),
    }),
  ],
})
