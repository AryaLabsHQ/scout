# `@scout/plugin-docker`

`packages/plugin-docker` is Scout's Docker integration plugin. It discovers Docker capabilities on managed nodes, collects daemon and container data, exposes Docker-specific actions and log streams, and registers the web-facing plugin surface.

## Responsibilities

- Describe the Docker plugin manifest and permissions
- Define Docker entity kinds, metrics, actions, and streams
- Detect Docker support on an agent and collect Docker inventory/metrics
- Expose Docker actions such as inspect, start, stop, restart, remove, pull, and prune
- Provide the plugin's hub and web runtime surfaces

## Key Entry Points

- [`src/manifest.ts`](./src/manifest.ts): published manifest and permissions
- [`src/contracts.ts`](./src/contracts.ts): Docker ids, metrics, actions, streams, and UI definitions
- [`src/docker.ts`](./src/docker.ts): main Docker implementation
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

This package is discovered dynamically by the hub and agent through `@scout/plugin-sdk`. Its manifest id is `@scout/plugin-docker`.

## More Detail

Implementation-oriented guidance lives in [`AGENTS.md`](./AGENTS.md).
