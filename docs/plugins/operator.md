# Plugins And The Operator

This guide explains how Scout plugins extend the Operator.

## Mental Model

Scout owns the Operator runtime.

Core Scout is responsible for:

- sessions
- persistence
- branching and forking
- approvals
- runtime orchestration
- eventing
- terminal integration

Plugins are responsible for domain-specific operator behavior.

That means a plugin may extend the Operator through its `operator` block, but the Operator is not itself a plugin.

## The Operator Surface

The current plugin operator surface is:

- `tools`
- `resources`
- `skills`
- `hooks`

Example:

```ts
import {
  defineOperator,
  defineOperatorResource,
  defineOperatorSkill,
  defineOperatorTool,
} from "@scout/plugin-sdk/operator"

export const operator = defineOperator({
  tools: [
    defineOperatorTool({
      name: "docker.container.inspect_safe",
      label: "docker.container.inspect_safe",
      description: "Inspect a Docker container through the Docker plugin.",
      requiresConfirmation: false,
      parameters: SomeSchema,
      execute: async (toolCallId, params, signal, onUpdate, ctx) => {
        // implementation
      },
    }),
  ],
  resources: [
    defineOperatorResource({
      id: "capabilities",
      title: "Docker Operator Capabilities",
      description: "Summary of Docker-specific operator behavior.",
      content: "Prefer typed Docker actions before shell commands.",
    }),
  ],
  skills: [
    defineOperatorSkill({
      id: "docker-ops",
      name: "Docker Operations",
      description: "Guidance for Docker workflows.",
      content: "Start with observe_plugins and plugin_logs before bash_run.",
    }),
  ],
  hooks: {
    beforePrompt(input) {
      return Effect.succeed("Plugin-specific operator guidance")
    },
  },
})
```

## Tools

Operator tools are executable capabilities contributed by a plugin.

Use a plugin operator tool when:

- the Operator needs a typed domain-specific capability
- the plugin can provide something sharper than generic `plugin_run_action`
- the tool meaning is stable and worth naming directly

Good examples:

- `docker.container.inspect_safe`
- `k8s.workload.scale_reviewed`
- `systemd.unit.restart_with_context`

Avoid:

- trivial wrappers around `bash_run`
- broad generic tools with unclear semantics
- tools that bypass existing approval policy

## Resources

Operator resources are read-only context.

Use resources for:

- capability summaries
- domain runbooks
- plugin-specific operating guidance
- compact reference material the Operator can load selectively

Resources should not be:

- giant documentation dumps
- hidden prompt stuffing
- executable logic

## Skills

Operator skills are reusable behavior guidance.

Use skills when you want to teach the Operator how to behave in a domain, for example:

- preferred troubleshooting order
- safe mutation expectations
- when to choose typed actions over shell commands

Skills should be:

- short
- opinionated
- specific to the plugin domain

Skills should not just restate the manifest.

## Hooks

Hooks let a plugin enrich the operator lifecycle.

Current hooks are:

- `beforePrompt`
- `beforeToolCall`
- `afterToolCall`

Hooks should be used sparingly. They are for:

- adding bounded prompt context
- logging or annotating tool behavior
- enforcing plugin-specific preconditions

Hooks should not:

- bypass Scout approval logic
- introduce hidden side effects
- replace typed tools with ad hoc logic

## What Belongs In Core Scout vs A Plugin

Keep these in core Scout:

- generic observe tools
- generic plugin execution tools
- approvals
- sessions
- terminal
- audit and persistence

Put these in plugins:

- domain-specific operator skills
- domain-specific resources
- domain-specific tools
- domain-specific hook behavior

This keeps the Operator runtime stable while allowing plugin-defined domain intelligence.

## The Current First-Party Pattern

The existing first-party plugins already follow the right direction:

- Docker operator guidance in [packages/plugin-docker/src/operator.ts](../../packages/plugin-docker/src/operator.ts)
- Kubernetes operator guidance in [packages/plugin-k8s/src/operator.ts](../../packages/plugin-k8s/src/operator.ts)
- Systemd operator guidance in [packages/plugin-systemd/src/operator.ts](../../packages/plugin-systemd/src/operator.ts)

Right now they contribute mostly resources and skills. That is a good starting point.

The next natural step, once real usage justifies it, is richer plugin-defined operator tools.

## Design Rule

The Operator should increasingly be defined by plugins at the domain layer, but not at the runtime layer.

In practice that means:

- core Scout defines how the Operator works
- plugins define what the Operator knows and can do in each domain
