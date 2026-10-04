# `@scout/plugin-systemd`

`packages/plugin-systemd` is Scout's systemd integration plugin. It detects and collects unit state from Linux nodes, exposes service-management actions and journal log streaming, registers alert metadata and plugin UI, and extends the Operator with systemd-specific resources and skills.

## Responsibilities

- Describe the systemd plugin manifest and permissions
- Define the systemd unit entity, related metrics, actions, streams, and alerts
- Detect systemd support on an agent and collect unit state: system and user (`systemctl --user`) services, timers with their next and last run, and each unit's last result, exit status, and restart count
- Expose actions such as start, stop, restart, enable, disable, daemon reload, and unit-file read/write
- Provide the plugin's hub, web, and operator surfaces

## Key Entry Points

- [`src/plugin.ts`](./src/plugin.ts): canonical plugin entrypoint that assembles the plugin object
- [`src/manifest.ts`](./src/manifest.ts): published manifest, permissions, and alert metadata
- [`src/contracts.ts`](./src/contracts.ts): systemd ids, metrics, actions, streams, and UI state
- [`src/systemd.ts`](./src/systemd.ts): main systemd implementation
- [`src/agent.ts`](./src/agent.ts): agent runtime adapter
- [`src/hub.ts`](./src/hub.ts) and [`src/web.ts`](./src/web.ts): hub and web adapters
- [`src/operator.ts`](./src/operator.ts): systemd operator resources and skills

## Commands

```bash
# Typecheck
bun run typecheck

# Run tests
bun run test
```

## How It Fits

This package is discovered dynamically by the hub and agent through `@scout/plugin-sdk`. The canonical entrypoint is `src/plugin.ts`, and its manifest id is `systemd`.

The current `operator` surface contributes:

- systemd-specific operator resources
- systemd-specific operator skills

It does not yet contribute systemd-specific operator tools.

## More Detail

Canonical plugin authoring guidance lives in [`../../docs/plugins/authoring.md`](../../docs/plugins/authoring.md).

Operator-specific guidance lives in [`../../docs/plugins/operator.md`](../../docs/plugins/operator.md).

Implementation-oriented guidance lives in [`AGENTS.md`](./AGENTS.md).
