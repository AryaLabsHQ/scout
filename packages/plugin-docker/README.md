# `@scout/plugin-docker`

`packages/plugin-docker` is Scout's Docker integration plugin. It discovers Docker capabilities on managed nodes, collects daemon and container data, exposes Docker-specific actions and log streams, registers plugin UI, and extends the Operator with Docker-specific resources and skills.

## Responsibilities

- Describe the Docker plugin manifest and permissions
- Define Docker entity kinds, metrics, actions, and streams
- Detect Docker support on an agent and collect Docker inventory/metrics
- Expose Docker actions such as inspect, start, stop, restart, remove, pull, and prune
- Provide the plugin's hub, web, and operator surfaces

## Key Entry Points

- [`src/plugin.ts`](./src/plugin.ts): canonical plugin entrypoint that assembles the plugin object
- [`src/manifest.ts`](./src/manifest.ts): published manifest and permissions
- [`src/contracts.ts`](./src/contracts.ts): Docker ids, metrics, actions, streams, and UI definitions
- [`src/docker.ts`](./src/docker.ts): main Docker implementation
- [`src/agent.ts`](./src/agent.ts): agent runtime adapter
- [`src/hub.ts`](./src/hub.ts) and [`src/web.ts`](./src/web.ts): hub and web adapters
- [`src/operator.ts`](./src/operator.ts): Docker operator resources and skills

## Commands

```bash
# Typecheck
bun run typecheck

# Run tests
bun run test
```

## How It Fits

This package is discovered dynamically by the hub and agent through `@scout/plugin-sdk`. The canonical entrypoint is `src/plugin.ts`, and its manifest id is `@scout/plugin-docker`.

The current `operator` surface contributes:

- Docker-specific operator resources
- Docker-specific operator skills

It does not yet contribute Docker-specific operator tools.

## More Detail

Canonical plugin authoring guidance lives in [`../../docs/plugins/authoring.md`](../../docs/plugins/authoring.md).

Operator-specific guidance lives in [`../../docs/plugins/operator.md`](../../docs/plugins/operator.md).

Implementation-oriented guidance lives in [`AGENTS.md`](./AGENTS.md).
