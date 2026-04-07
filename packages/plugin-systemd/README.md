# `@scout/plugin-systemd`

`packages/plugin-systemd` is Scout's systemd integration plugin. It detects and collects unit state from Linux nodes, exposes service-management actions and journal log streaming, and registers both alert metadata and web screens for systemd operations.

## Responsibilities

- Describe the systemd plugin manifest and permissions
- Define the systemd unit entity, related metrics, actions, streams, and alerts
- Detect systemd support on an agent and collect unit state
- Expose actions such as start, stop, restart, enable, disable, daemon reload, and unit-file read/write
- Provide the plugin's hub and web runtime surfaces

## Key Entry Points

- [`src/manifest.ts`](./src/manifest.ts): published manifest, permissions, and alert metadata
- [`src/contracts.ts`](./src/contracts.ts): systemd ids, metrics, actions, streams, and UI state
- [`src/systemd.ts`](./src/systemd.ts): main systemd implementation
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

This package is discovered dynamically by the hub and agent through `@scout/plugin-sdk`. Its manifest id is `systemd`.

## More Detail

Implementation-oriented guidance lives in [`AGENTS.md`](./AGENTS.md).
