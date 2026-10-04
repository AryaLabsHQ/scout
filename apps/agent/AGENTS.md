# AGENT RUNTIME

## OVERVIEW

`apps/agent` is the node-side Scout runtime. It discovers local capabilities, loads plugins from the workspace packages directory, reports metrics to the hub, and serves hub-initiated management RPCs.

## STRUCTURE

```text
apps/agent/
├── src/collectors/   # built-in system, network, process, gpu, smart, temperature collectors
├── src/rpc/          # persistent hub connection + hub→agent handlers
├── src/services/     # collector registry, plugin registry, plugin host, reporter
├── src/config.ts     # required env/config loader
└── test/             # service and RPC tests
```

## WHERE TO LOOK

| Task                                 | Location                                                         | Notes                                                 |
| ------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------- |
| Required env vars / defaults         | `src/config.ts`                                                  | `SCOUT_HUB_URL` and `SCOUT_TOKEN` are required        |
| Collector discovery and report shape | `src/services/collector-registry.ts`                             | Core collector order is fixed here                    |
| Plugin loading / runtime execution   | `src/services/plugin-registry.ts`, `src/services/plugin-host.ts` | Default plugin dir is `packages/`                     |
| Persistent hub connection            | `src/rpc/connection.ts`                                          | Builds duplex RPC client/server over WebSocket        |
| Agent-side RPC handlers              | `src/rpc/handlers.ts`                                            | Implements hub-initiated plugin and terminal commands |

## CONVENTIONS

- `src/main.ts` is the layer graph. Update layer composition there before adding new long-lived services.
- Collector discovery failures are treated as capability absence; collection failures are logged and excluded instead of aborting the full report.
- The reporter is a detached background fiber. Startup work should finish before `Effect.never`.
- Plugin packages are discovered from a directory, not statically imported here.

## ANTI-PATTERNS

- Do not add new wire contracts only inside `apps/agent`; shared RPCs and payload schemas belong in `packages/shared`.
- Do not bypass `AgentPluginRegistry` / `AgentPluginHost` with direct plugin imports in services.
- Do not move collector ordering logic into individual collectors; `CollectorRegistry` owns orchestration.
