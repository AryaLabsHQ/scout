# `@scout/agent`

`apps/agent` is the Scout runtime that runs on monitored nodes. It discovers local capabilities, loads plugin packages, collects host metrics, reports to the hub, and executes hub-initiated plugin and terminal operations.

## Responsibilities

- Discover built-in collector capabilities such as system, network, process, temperature, GPU, and SMART data
- Load agent-capable plugin packages from the workspace or `SCOUT_PLUGIN_DIR`
- Maintain a persistent RPC connection to the hub
- Report core metrics and plugin collections on a fixed interval
- Serve hub-initiated actions, log streams, and terminal session RPCs

## Configuration

Required environment variables:
- `SCOUT_HUB_URL`
- `SCOUT_TOKEN`

Common optional variables:
- `SCOUT_HOSTNAME`
- `SCOUT_INTERVAL`
- `SCOUT_COLLECTORS_DISABLE`
- `SCOUT_COLLECTORS_ENABLE`
- `SCOUT_PLUGIN_DIR`

The config loader lives in [`src/config.ts`](./src/config.ts).

## Key Entry Points

- [`src/main.ts`](./src/main.ts): layer composition and process startup
- [`src/services/collector-registry.ts`](./src/services/collector-registry.ts): core collector discovery and report assembly
- [`src/services/plugin-host.ts`](./src/services/plugin-host.ts): plugin capability detection, collection, actions, and streams
- [`src/rpc/connection.ts`](./src/rpc/connection.ts): persistent hub connection and reconnect loop
- [`src/rpc/handlers.ts`](./src/rpc/handlers.ts): hub-initiated RPC handlers

## Commands

```bash
# Run in dev mode
bun run dev

# Build the compiled agent binary
bun run build

# Typecheck
bun run typecheck

# Run tests
bun run test
```

## Related Packages

- [`../../packages/shared/README.md`](../../packages/shared/README.md): shared schemas and RPC groups
- [`../../packages/plugin-sdk/README.md`](../../packages/plugin-sdk/README.md): plugin loader and execution model

## More Detail

Implementation-oriented guidance lives in [`AGENTS.md`](./AGENTS.md).
