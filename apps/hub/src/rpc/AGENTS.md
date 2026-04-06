# HUB RPC

## OVERVIEW
This directory owns the websocket/RPC boundary for the hub: browser-facing RPCs, agent-facing duplex RPC bridging, auth middleware, and the connected-agent registry.

## STRUCTURE
```text
apps/hub/src/rpc/
├── server.ts           # public RPC layer composition and route mounting
├── auth.ts             # browser RPC auth middleware
├── client-handlers.ts  # browser-facing handler implementations
├── agent-bridge.ts     # agent connection lifecycle and typed client registry
└── agent-handlers.ts   # hub-side handlers for agent→hub RPCs
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add a browser RPC | `packages/shared/src/rpc/client-hub.ts`, then `client-handlers.ts` | `/ws/rpc` serves the shared group |
| Add a hub→agent or agent→hub RPC | `packages/shared/src/rpc/{hub-agent,agent-hub}.ts`, then `agent-bridge.ts` or `agent-handlers.ts` | Keep caller/callee direction explicit |
| Change browser auth behavior | `auth.ts` | Middleware is provided into the browser RPC server layer |
| Change connection lifecycle or agent bookkeeping | `agent-bridge.ts` | `AgentRegistry` is the source of truth |
| Change server composition | `server.ts` | Merges browser RPC server, registry, and agent upgrade route |

## CONVENTIONS
- Shared schemas and RPC names are defined in `packages/shared`, not locally.
- `server.ts` exposes `/ws/rpc` for browsers and `/ws/rpc/agent` for agents.
- `agent-bridge.ts` owns the duplex socket pairing and the per-agent typed client cache used by management flows.
- Streams are the preferred shape for metrics, alerts, system status, logs, and terminal output.
- Browser auth concerns stay in `auth.ts`; keep transport-level checks out of handler business logic when possible.

## ANTI-PATTERNS
- Do not create app-local payload schemas in this directory.
- Do not bypass `AgentRegistry` when routing management calls to connected agents.
- Do not add a second websocket protocol surface outside `server.ts`.
