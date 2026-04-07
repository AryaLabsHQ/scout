# `@scout/plugin-k8s`

`packages/plugin-k8s` is Scout's Kubernetes integration plugin. It models cluster and workload state, collects Kubernetes inventory and metrics from managed nodes, exposes Kubernetes-specific actions and pod log streaming, and registers the plugin's web surface.

## Responsibilities

- Describe the Kubernetes plugin manifest and permissions
- Define cluster, namespace, workload, pod, and controller entity kinds
- Collect Kubernetes inventory and readiness metrics from an agent
- Expose actions such as describe, scale, restart, and delete
- Provide pod log streaming and the plugin's hub and web surfaces

## Key Entry Points

- [`src/manifest.ts`](./src/manifest.ts): published manifest and permissions
- [`src/contracts.ts`](./src/contracts.ts): Kubernetes ids, metrics, actions, streams, and UI definitions
- [`src/k8s.ts`](./src/k8s.ts): main Kubernetes implementation
- [`src/agent.ts`](./src/agent.ts): agent runtime adapter
- [`src/hub.ts`](./src/hub.ts) and [`src/web.ts`](./src/web.ts): hub and web adapters

## Commands

```bash
# Typecheck
bun run typecheck

# Run tests
bun run test
```

## How It Fits

This package is discovered dynamically by the hub and agent through `@scout/plugin-sdk`. Its manifest id is `@scout/plugin-k8s`.

## More Detail

Implementation-oriented guidance lives in [`AGENTS.md`](./AGENTS.md).
