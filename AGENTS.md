# SCOUT KNOWLEDGE BASE

**Generated:** 2026-04-07
**Commit:** c0c923b

## OVERVIEW
Scout is an Effect v4 + Bun monorepo for monitoring and managing remote systems.
`apps/agent` runs collectors and plugins on nodes, `apps/hub` persists state and serves APIs, `apps/web` is the TanStack Start dashboard, `packages/*` hold shared contracts and plugin runtimes, and `e2e/` spins a Docker test lab.

## STRUCTURE
```text
scout/
├── apps/
│   ├── agent/      # node-side runtime, collectors, plugin host, hub RPC client
│   ├── hub/        # DB-backed control plane, REST endpoints, WS RPC servers
│   │   ├── services/operator-*  # operator session runtime, persistence, models, skills
│   └── web/        # TanStack Start dashboard, AtomRpc client, SSR bootstrap
│       ├── src/components/operator/  # operator chat UI + tiptap rich input
├── packages/
│   ├── plugin-sdk/ # plugin contracts, loader, execution/runtime helpers
│   ├── plugin-*    # concrete plugins: docker, k8s, systemd
│   └── shared/     # Effect Schema models and RPC groups shared by all runtimes
├── e2e/            # multi-node Docker harness for end-to-end testing
└── .scratchpad/    # ephemeral research and milestone notes; not product code
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add a new collector or node capability | `apps/agent/src/collectors`, `apps/agent/src/services/collector-registry.ts` | Registry order is the canonical core collector order |
| Change hub APIs or live control flow | `apps/hub/src/routes.ts`, `apps/hub/src/rpc`, `packages/shared/src/rpc` | REST is for bootstrap/HTTP, RPC is for live browser and agent traffic |
| Change browser data flow | `apps/web/src/routes`, `apps/web/src/server`, `apps/web/src/rpc`, `apps/web/src/providers/atom-provider.tsx` | SSR bootstrap happens before AtomRpc subscriptions |
| Add or change shared wire contracts | `packages/shared/src/schemas`, `packages/shared/src/rpc` | Shared package is the source of truth for cross-runtime shapes |
| Add or change plugin capabilities | `packages/plugin-sdk`, `packages/plugin-docker`, `packages/plugin-k8s`, `packages/plugin-systemd` | Plugin manifests, contracts, and runtime adapters live together |
| Run the full stack against disposable nodes | `e2e/README.md`, `e2e/scripts`, `e2e/nodes` | Hub runs on the host; containers mount the repo at `/opt/scout` |
| Operator sessions, tools, approvals | `apps/hub/src/services/operator-*`, `apps/web/src/components/operator/` | Hub services own runtime + persistence; web owns chat UI |

## WHY EFFECT V4
Effect is the primary application framework here, not a helper library.
Services are built with `Context.Service`, dependencies are composed with `Layer`, shared contracts use `Schema`, browser reactivity uses `AtomRpc`/`@effect/atom-react`, and long-running processes are launched through Effect runtimes.

## QUICK REFERENCE
| DO | DON'T |
|---|---|
| Use `Context.Service` plus `static readonly layer` for services | Introduce ad-hoc singletons or app-local service registries |
| Define cross-runtime contracts in `packages/shared` or `packages/plugin-sdk` | Re-declare payload/result shapes inside apps |
| Compose infra with `Layer.provide`, `Layer.provideMerge`, and `Layer.mergeAll` | Hand-wire dependencies inside route handlers or React components |
| Use `apps/web/src/server/*` for SSR/bootstrap fetches and `HubClient` for live RPC | Scatter raw hub fetches throughout route components |
| Treat plugin `manifest.ts` + `contracts.ts` as the canonical public surface | Duplicate plugin ids, actions, streams, or permission names across files |
| Follow the current Effect import style: `effect`, `effect/<Module>`, `effect/{http,rpc,reactivity,socket}/*`, `@effect/*` | Hide architectural decisions behind barrel-only indirection |

## KEY PATTERNS
- `apps/agent/src/main.ts` and `apps/hub/src/app.ts` are the layer-composition entry points; start there before changing service wiring.
- Browser data has two lanes: SSR bootstrap through `createServerFn` wrappers in `apps/web/src/server/*`, then live state through `HubClient` atoms in `apps/web/src/rpc/client.ts`.
- Shared RPC directionality is explicit: browser→hub, agent→hub, and hub→agent each get their own file under `packages/shared/src/rpc`.
- Plugin packages are split the same way everywhere: `contracts.ts` defines ids/schemas, `manifest.ts` exposes metadata, and `agent.ts` / `hub.ts` / `web.ts` bind runtime-specific behavior.
- Hub HTTP endpoints in `apps/hub/src/routes.ts` serialize database state for bootstrap and diagnostics; interactive management flows belong in RPC layers instead of bespoke REST routes.
- Operator sessions run on pi-durable (`@earendil-works/pi-durable`) over a separate SQLite file (`SCOUT_OPERATOR_DB_PATH`): transcripts, tool calls, and Scout documents (session metadata, approvals) commit durably and resume after a hub restart. The browser watches projected session snapshots (`operator.sessions.watch`).
- Approvals and `ask_user` wait inside the tool's `execute()` on a durable approvals document; side-effecting tools claim a single execution with a task memo, so a restart never re-executes them. See `docs/operator/architecture.md`.

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `AgentConfig` | config loader | `apps/agent/src/config.ts` | Reads required agent env vars and plugin directory |
| `CollectorRegistry` | service | `apps/agent/src/services/collector-registry.ts` | Discovers active collectors and assembles flat metrics samples |
| `AppLayer` | layer composition | `apps/hub/src/app.ts` | Merges hub database, ingestion, retention, alerts, registry services |
| `RpcLayer` | layer composition | `apps/hub/src/rpc/server.ts` | Exposes `/ws/rpc` and `/ws/rpc/agent` |
| `ClientHubRpcs` | RPC group | `packages/shared/src/rpc/client-hub.ts` | Browser-facing queries, mutations, and streams |
| `HubAgentRpcs` / `AgentHubRpcs` | RPC groups | `packages/shared/src/rpc` | Duplex control channel between hub and agents |
| `HubClient` | AtomRpc service | `apps/web/src/rpc/client.ts` | Browser RPC client consumed by route/page atoms |
| `definePluginManifest` | SDK helper | `packages/plugin-sdk/src/runtime.ts` | Canonical plugin manifest typing helper |
| `OperatorHarness` | service | `apps/hub/src/services/operator-harness.ts` | pi-durable Harness lifecycle (open/resume/close) and Scout extensions |
| `OperatorSessions` | service | `apps/hub/src/services/operator-sessions.ts` | Session lifecycle, fork, approvals, abort, projection, watch stream |
| `makeOperatorExtensions` | function | `apps/hub/src/services/operator-tools.ts` | 8 tools, durable approval gate, plan-mode extension |
| `OperatorModelRegistry` | service | `apps/hub/src/services/operator-model-registry.ts` | pi-ai models with configured credentials, default model |
| `OperatorPromptInput` | component | `apps/web/src/components/operator/operator-prompt-input.tsx` | Tiptap editor with @mentions, /commands, history |

## CONVENTIONS
- Root `README.md` is still a template stub. Treat workspace source plus `e2e/README.md` as ground truth instead.
- Effect and every `@effect/*` package are pinned to the same exact stable version in every workspace; bump them together.
- `typescript` is pinned to the same exact 7.x version in every workspace, and every `typecheck` script runs TS 7's native `tsc`. TS 7 does not ship the TypeScript 5/6 JS API (`import "typescript"` exports only `version`); a tool that needs that API gets a scoped `typescript@6` alias for that tool alone.
- `bunfig.toml` turns off Bun's global install store: `bun-types` and several React libraries import undeclared type packages (`undici-types`, `@types/react`), which only resolve from the per-repo `node_modules/.bun` store.
- This is a Bun workspace repo with Turbo orchestration. Root scripts cover `dev`, `build`, `typecheck`, and formatting/linting; most tests run from workspace roots.
- `.scratchpad/` is active working memory and research, not shipped code. Do not rely on it for product behavior.
- New shared system, alert, terminal, or plugin contracts belong in `packages/shared` first, then consumers update from there.
- New plugin surfaces should keep the existing export shape from `src/index.ts` and avoid app-specific imports inside package contracts.

## ANTI-PATTERNS (THIS PROJECT)
- Adding new websocket behavior directly in `apps/hub/src/routes.ts` or random browser sockets; extend the shared RPC groups and hub/agent/web RPC layers instead.
- Treating the root README as authoritative architecture documentation.
- Re-declaring plugin/system/alert payloads inside apps when a shared schema or exported type already exists.
- Spreading plugin ids, permissions, action names, and stream names across multiple files instead of centralizing them in plugin contracts/manifests.
- Confusing `e2e/` constraints with production behavior; the harness is privileged, host-coupled, and intentionally local-only.

## COMMANDS
```bash
# Install workspace deps
bun install

# Run the monorepo in dev mode
bun run dev

# Build all workspaces
bun run build

# Typecheck all workspaces
bun run typecheck

# Representative tests
cd apps/hub && bun run test
cd apps/agent && bun run test
cd packages/plugin-sdk && bun run test

# Start the Docker test harness (hub must already be running on the host)
cd e2e && ./scripts/up.sh
```

## AGENTS.MD LOCATIONS
- `apps/agent/AGENTS.md` — node agent runtime, collectors, plugin host, hub connection
- `apps/hub/AGENTS.md` — hub service graph, database, REST endpoints, plugin registry
- `apps/hub/src/rpc/AGENTS.md` — browser and agent websocket/RPC layers
- `apps/web/AGENTS.md` — dashboard app structure, SSR bootstrap, AtomRpc client usage
- `apps/web/src/routes/AGENTS.md` — route-file conventions and page boundaries
- `packages/shared/AGENTS.md` — shared contracts package
- `packages/shared/src/rpc/AGENTS.md` — RPC group definitions and duplex socket adapter
- `packages/shared/src/schemas/AGENTS.md` — canonical Effect Schema models
- `packages/plugin-sdk/AGENTS.md` — plugin runtime/loader SDK
- `packages/plugin-docker/AGENTS.md` — Docker plugin package
- `packages/plugin-k8s/AGENTS.md` — Kubernetes plugin package
- `packages/plugin-systemd/AGENTS.md` — systemd plugin package
- `e2e/AGENTS.md` — Docker-based end-to-end harness
- `apps/hub/src/services/AGENTS.md` — hub services including operator runtime, sessions, models, skills
- `apps/web/src/components/operator/AGENTS.md` — operator chat UI components and tiptap extensions
- `docs/architecture.md` — full system architecture reference
- `docs/operator/README.md` — operator user guide
- `docs/operator/architecture.md` — operator developer architecture
