# SHARED RPC

## OVERVIEW

This directory defines the typed RPC surface shared across browser, hub, and agent runtimes. Each file maps to one direction of communication, and `duplex-socket.ts` adapts raw websocket sockets into Effect RPC protocols.

## STRUCTURE

```text
packages/shared/src/rpc/
├── client-hub.ts    # browser -> hub queries, mutations, streams
├── agent-hub.ts     # agent -> hub registration and reporting
├── hub-agent.ts     # hub -> agent terminal and plugin control
├── duplex-socket.ts # raw socket adapter for duplex RPC links
└── index.ts         # public package barrel
```

## WHERE TO LOOK

| Task                       | Location           | Notes                                             |
| -------------------------- | ------------------ | ------------------------------------------------- |
| Browser → hub RPCs         | `client-hub.ts`    | Queries, mutations, and streams for the dashboard |
| Agent → hub RPCs           | `agent-hub.ts`     | Agent registration and reporting                  |
| Hub → agent RPCs           | `hub-agent.ts`     | Terminal and plugin management calls              |
| Raw duplex protocol bridge | `duplex-socket.ts` | Shared by agent and hub websocket code            |

## CONVENTIONS

- Keep schemas imported from `../schemas/*`; RPC files should name operations and contracts, not invent new shapes.
- Use streams for long-lived event flows such as metrics, alerts, logs, and terminal output.
- Keep transport code runtime-neutral here; hub and agent glue lives in their respective app packages.
- Preserve the directional split even when two operations feel related; caller/callee boundaries matter more than feature grouping.

## ANTI-PATTERNS

- Do not import hub or agent services into this directory.
- Do not mix multiple communication directions into one RPC file.
- Do not add untyped payloads when a schema can be expressed here first.
