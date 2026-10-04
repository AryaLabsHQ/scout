import {
  defineOperatorResource,
  defineOperatorSkill,
  defineOperator,
} from "@scout/plugin-sdk/operator"

export const operator = defineOperator({
  resources: [
    defineOperatorResource({
      id: "capabilities",
      title: "Systemd Operator Capabilities",
      description: "Summary of the Systemd plugin's operator-facing capabilities.",
      content: [
        "This plugin exposes systemd unit inventory, bounded unit logs, and common service-management actions.",
        "Prefer plugin_run_action and plugin_logs for unit-level work before using bash_run.",
        "Treat restart, stop, disable, and unit-file writes as mutating operations with operational impact.",
      ].join("\n"),
    }),
  ],
  skills: [
    defineOperatorSkill({
      id: "systemd-ops",
      name: "Systemd Operations",
      description: "Guidance for diagnosing and operating systemd-managed services through Scout.",
      content: [
        "Start with observe_plugins so the operator knows the exact Systemd actions and streams available on the node.",
        "Use plugin_logs for bounded unit logs before opening a shell.",
        "Prefer typed systemd actions over bash_run for unit lifecycle changes and unit-file management.",
      ].join("\n"),
    }),
  ],
})
