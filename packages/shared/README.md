# `@scout/shared`

`packages/shared` is the cross-runtime contract package for Scout. It defines the canonical shapes used by the agent, hub, and web apps for schemas, RPC groups, and a small number of legacy TypeScript-only domain types.

## Responsibilities

- Export Effect Schema-based contracts for systems, alerts, logs, management, terminal, and metrics
- Define the directional RPC groups used across the stack
- Provide the duplex RPC socket adapter used by the agent/hub connection
- Centralize shared types so app packages do not redefine wire shapes locally

## Key Entry Points

- [`src/index.ts`](./src/index.ts): package barrel
- [`src/schemas/index.ts`](./src/schemas/index.ts): schema exports
- [`src/rpc/index.ts`](./src/rpc/index.ts): RPC exports
- [`src/rpc/client-hub.ts`](./src/rpc/client-hub.ts): browser to hub RPCs
- [`src/rpc/agent-hub.ts`](./src/rpc/agent-hub.ts): agent to hub RPCs
- [`src/rpc/hub-agent.ts`](./src/rpc/hub-agent.ts): hub to agent RPCs

## Commands

```bash
# Typecheck
bun run typecheck
```

## How It Fits

If a payload, schema, or RPC method crosses runtime boundaries, it belongs here first. Consumers should update to the new shared shape rather than creating local compatibility copies.

## More Detail

Implementation-oriented guidance lives in [`AGENTS.md`](./AGENTS.md), [`src/rpc/AGENTS.md`](./src/rpc/AGENTS.md), and [`src/schemas/AGENTS.md`](./src/schemas/AGENTS.md).
