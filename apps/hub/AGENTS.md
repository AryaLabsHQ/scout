# HUB APP

## OVERVIEW
`apps/hub` is the control plane. It stores system state in SQLite via Drizzle, ingests metrics from agents, serves bootstrap REST endpoints, and hosts the browser and agent websocket RPC layers.

## STRUCTURE
```text
apps/hub/
├── drizzle/          # SQLite schema and migrations
├── src/services/     # database, ingestion, retention, alerting, plugin registry
├── src/rpc/          # browser RPC server, agent bridge, auth, handlers
├── src/auth/         # Cloudflare Access JWT verification + global HTTP auth gate
├── src/config.ts     # HubConfig: host/port/token/auth mode, fails closed at startup
├── src/routes.ts     # REST/HTTP endpoints used for health and SSR bootstrap
├── src/app.ts        # service layer composition
└── test/             # route, service, and end-to-end hub tests
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Database schema or migration flow | `drizzle/schema.ts`, `drizzle.config.ts` | SQLite path comes from `SCOUT_DB_PATH` |
| Service wiring | `src/app.ts` | Database and broadcast layers are the base infra layers |
| REST endpoints for SSR/bootstrap | `src/routes.ts` | `/health`, `/api/systems`, `/api/alerts`, `/api/plugins`, etc. |
| Browser / agent RPC entry points | `src/rpc/server.ts`, `src/rpc/agent-bridge.ts` | `/ws/rpc` for browsers, `/ws/rpc/agent` for agents |
| Auth, startup config | `src/config.ts`, `src/auth/*`, `src/rpc/auth.ts` | Gate covers every path but `/health`; RPC middleware provides `CurrentIdentity` + audit log |
| Plugin discovery | `src/services/plugin-registry.ts` | Loads packages from `SCOUT_PLUGIN_DIR` or `packages/` |
| Operator session lifecycle | `src/services/operator-*.ts`, `src/services/AGENTS.md` | 7 services: runtime, sessions, manager, models, skills, extensions, resources |
| Operator RPC handlers | `src/rpc/client-handlers.ts` | 17 operator.* methods (sessions, approvals, skills, models, events stream) |

## CONVENTIONS
- Add new hub business logic as services first, then provide those layers from `src/app.ts`.
- Keep shared wire contracts in `packages/shared`; the hub should implement them, not redefine them.
- REST is mainly for health checks and SSR bootstrap. Live control and subscriptions go through RPC.
- `test/helpers/test-database.ts` is the database fixture anchor for service and route tests.
- New routes are authenticated by `HttpAuthGate` automatically; only add a path to `OPEN_PATHS` deliberately.
- New browser RPCs are audit-logged unless listed in `UNAUDITED_RPCS` (`src/rpc/auth.ts`); list only read-only ones.

## ANTI-PATTERNS
- Do not add new websocket APIs straight to `src/routes.ts`; wire them through shared RPC groups and `src/rpc`.
- Do not query plugin packages directly from route files; go through `PluginRegistry` or RPC handlers.
- Do not hide new service dependencies in route handlers; extend the layer graph explicitly.
