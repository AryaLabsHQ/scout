# `@scout/plugin-k8s`

`packages/plugin-k8s` is Scout's Kubernetes integration plugin. It models cluster and workload state, collects Kubernetes inventory and metrics from managed nodes, exposes Kubernetes-specific actions and pod log streaming, registers plugin UI, and extends the Operator with Kubernetes-specific resources and skills.

## Responsibilities

- Describe the Kubernetes plugin manifest and permissions
- Define cluster, namespace, workload, pod, and controller entity kinds
- Collect Kubernetes inventory and readiness metrics from an agent
- Expose actions such as describe, scale, restart, and delete
- Provide pod log streaming and the plugin's hub, web, and operator surfaces

## Key Entry Points

- [`src/plugin.ts`](./src/plugin.ts): canonical plugin entrypoint that assembles the plugin object
- [`src/manifest.ts`](./src/manifest.ts): published manifest and permissions
- [`src/contracts.ts`](./src/contracts.ts): Kubernetes ids, metrics, actions, streams, and UI definitions
- [`src/k8s.ts`](./src/k8s.ts): main Kubernetes implementation
- [`src/agent.ts`](./src/agent.ts): agent runtime adapter
- [`src/hub.ts`](./src/hub.ts) and [`src/web.ts`](./src/web.ts): hub and web adapters
- [`src/operator.ts`](./src/operator.ts): Kubernetes operator resources and skills

## Commands

```bash
# Typecheck
bun run typecheck

# Run tests
bun run test
```

## How It Fits

This package is discovered dynamically by the hub and agent through `@scout/plugin-sdk`. The canonical entrypoint is `src/plugin.ts`, and its manifest id is `@scout/plugin-k8s`.

The current `operator` surface contributes:

- Kubernetes-specific operator resources
- Kubernetes-specific operator skills

It does not yet contribute Kubernetes-specific operator tools.

## More Detail

Canonical plugin authoring guidance lives in [`../../docs/plugins/authoring.md`](../../docs/plugins/authoring.md).

Operator-specific guidance lives in [`../../docs/plugins/operator.md`](../../docs/plugins/operator.md).

Implementation-oriented guidance lives in [`AGENTS.md`](./AGENTS.md).
