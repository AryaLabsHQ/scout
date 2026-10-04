# Scout Architecture

This document describes the architecture of Scout, a system observability and management platform built on Effect v4 and Bun.

## System Topology

Scout runs as two processes behind one origin: the hub (API, RPC, state) and the web dashboard
(TanStack Start SSR). A reverse proxy splits paths between them, so the browser talks to both
same-origin. On Agni the origin is `scout.arya.sh`, protected by Cloudflare Access.

```
browser
  -> Cloudflare Access (app "Scout", scout.arya.sh)
  -> cloudflared tunnel agni-host
  -> Caddy 127.0.0.1:80 (http://scout.arya.sh)
       /api/*, /ws/*, /health  -> hub  127.0.0.1:3901   (/ws/rpc/agent answers 404 here)
       everything else         -> web  127.0.0.1:3900

agni (OVH VPS, systemd --user units)
+-----------------------------------------------------------+
| scout-hub (Bun, apps/hub)                                  |
|  +-- REST /api/*, /health  (@effect/platform-bun routes)   |
|  +-- WS /ws/rpc       RpcServer<ClientHubRpcs>, NDJSON     |
|  +-- WS /ws/rpc/agent DuplexRpcSocket per agent:           |
|                       RpcServer<AgentHubRpcs> +            |
|                       RpcClient<HubAgentRpcs>              |
|  +-- SQLite (WAL, Drizzle, 30-day tiered retention)        |
+-----------------------------------------------------------+
| scout-web (Bun, apps/web .output)                          |
|  +-- TanStack Start SSR; server functions call the hub at  |
|      SCOUT_HUB_URL, forwarding the Access credential       |
+-----------------------------------------------------------+
| scout-agent (Bun, apps/agent)                              |
|  +-- ws://127.0.0.1:3901/ws/rpc/agent, Bearer SCOUT_TOKEN  |
+-----------------------------------------------------------+

Browser
+-- SSR initial load -> TanStack loader -> server function -> hub REST
|   -> AtomProvider seeds query atoms via useAtomInitialValues
+-- Client-side: HubClient = AtomRpc.Service backed by
|                BrowserSocket.layerWebSocket(same-origin /ws/rpc)
|                + NDJSON serialization
+-- Typed queries / mutations / streams via useAtomValue +
    useAtom hooks. reactivityKeys drive cache invalidation.
```

Deployment assets and the runbook live in [`deploy/agni`](../deploy/agni/README.md).

## Authentication

| Caller | Path | Credential | Checked by |
|--------|------|------------|------------|
| Anyone | `/health` | none | -- |
| Browser, web SSR | `/api/*`, `/ws/rpc`, any other path | Cloudflare Access JWT: `Cf-Access-Jwt-Assertion` header, else `CF_Authorization` cookie | `HttpAuthGate` (`apps/hub/src/auth/http-gate.ts`) |
| Browser RPC | each `ClientHubRpcs` call | same JWT, copied from the upgrade request | `ClientAuthMiddleware` (`apps/hub/src/rpc/auth.ts`) |
| Agent | `/ws/rpc/agent` | `Authorization: Bearer <SCOUT_TOKEN>` on the upgrade, and `token` in `agent.connect` | `HttpAuthGate`, `agent.connect` handler |

- The hub verifies the RS256 signature against `https://<team-domain>/cdn-cgi/access/certs`
  (cached; refetched on an unknown `kid` at most every 30 s, and hourly), plus `iss`, `aud`,
  `exp`, and `nbf` (30 s leeway).
- `ClientAuthMiddleware` provides `CurrentIdentity` (`source`, `subject`, `email`) to RPC handlers
  and logs an `rpc audit` line with the actor for every RPC outside the read-only list.
- The hub fails closed at startup: it requires a non-blank `SCOUT_TOKEN` and both Access settings
  unless `SCOUT_AUTH=disabled` is set on a loopback `SCOUT_HOST` (local development and e2e).

## Three-Runtime Model

Scout runs as three distinct runtime contexts that share typed contracts through `packages/shared`.

### Hub (`apps/hub`)

The hub is a Bun process that serves REST bootstrap endpoints and two WebSocket RPC surfaces; it does not serve the web frontend. It owns all persistent state in SQLite and acts as the control plane for agents and browser clients.

Key responsibilities:
- SQLite persistence via Drizzle ORM (WAL mode)
- Metrics ingestion with tiered retention (1m / 10m / 20m / 120m / 480m over 30 days)
- Alert evaluation engine with 3-strike debounce
- Plugin registry and metadata serving
- Operator session runtime (pi-durable harness; see `docs/operator/architecture.md`)
- Browser and agent WebSocket RPC servers

The hub service graph is composed in `apps/hub/src/app.ts` through Effect Layer composition across four tiers:

| Layer | Services |
|-------|----------|
| Layer 0: Infrastructure | Database, MetricsBroadcast |
| Layer 1: Core | MetricsIngestion, Retention |
| Layer 2: Alerting | AlertEngine (depends on Database + MetricsBroadcast) |
| Layer 3: Platform | AgentRegistry, OperatorModelRegistry, OperatorSessions, PluginRegistry, OperatorSkills, OperatorResources, OperatorExtensions, OperatorHarness |

### Agent (`apps/agent`)

Agents run as standalone binaries on each monitored machine. Each agent connects to the hub via a single WebSocket that carries bidirectional RPC traffic through the `DuplexRpcSocket` adapter.

Key responsibilities:
- Auto-discover system capabilities (CPU, memory, disk, network, GPU, SMART, temps, processes)
- Run plugin hosts for systemd, Docker, and Kubernetes collectors
- Report core metrics and plugin collection results on a 15-second interval
- Handle hub-initiated commands: terminal sessions, plugin actions, plugin log streams

### Web (`apps/web`)

The web dashboard is a separate TanStack Start (nitro) process with SSR bootstrap and client-side AtomRpc state management.

Key responsibilities:
- SSR page loaders fetch initial data from hub REST endpoints
- `AtomProvider` seeds query atoms with SSR data via `useAtomInitialValues`
- Live state flows through `HubClient` (an `AtomRpc.Service` over browser WebSocket)
- All queries, mutations, and streams are typed end-to-end from shared contracts

## Data Flow

Scout has two data lanes that work together to eliminate cold-start races while maintaining real-time updates.

### SSR Bootstrap

1. Browser requests a page from TanStack Start
2. The route loader calls `createServerFn` wrappers in `apps/web/src/server/*`
3. Server functions fetch from hub REST endpoints (`/api/systems`, `/api/alerts`, etc.) at `SCOUT_HUB_URL`, forwarding the visitor's Access JWT header or `CF_Authorization` cookie
4. Loader data is returned to the client
5. `AtomProvider` calls `useAtomInitialValues` to pre-seed the `HubClient` query atoms with `AsyncResult.success(data)`
6. The page renders immediately with server-fetched data

### Live AtomRpc

1. `AtomProvider` mounts and establishes a WebSocket to `/ws/rpc` on the page origin (the reverse proxy routes it to the hub; Vite proxies it in development)
2. `HubClient` is an `AtomRpc.Service` backed by `BrowserSocket.layerWebSocket` + NDJSON serialization
3. Components use `useAtomValue(HubClient.query(...))` for reads and `useAtomSet(HubClient.mutation(...))` for writes
4. Stream subscriptions (metrics, alerts, system updates, operator session snapshots) use `HubClient.runtime.pull` with `Atom.pull`-style consumption
5. Cache invalidation is driven by `reactivityKeys` on mutations

### Agent Duplex Socket

1. Agent connects to `/ws/rpc/agent` with `Authorization: Bearer <SCOUT_TOKEN>` and repeats the token in `agent.connect`
2. The single WebSocket carries two RPC directions via `DuplexRpcSocket`:
   - **Agent -> Hub** (`AgentHubRpcs`): `agent.connect`, `agent.report`, `agent.reportPluginCollection`
   - **Hub -> Agent** (`HubAgentRpcs`): `terminal.open`, `terminal.input`, `terminal.resize`, `terminal.close`, `plugins.runAction`, `plugins.logs`
3. Agent reports core metrics every 15 seconds via `agent.report`
4. Plugin collection results flow via `agent.reportPluginCollection`
5. Hub-initiated commands (terminal sessions, plugin actions) are routed through `AgentRegistry` to the correct agent's RPC client

## RPC Surface

All RPC methods are defined in `packages/shared/src/rpc/` and organized by communication direction.

### Browser -> Hub (`ClientHubRpcs` -- 33 methods)

| Domain | Method | Type |
|--------|--------|------|
| Systems | `systems.list` | Query |
| Systems | `systems.get` | Query |
| Systems | `systems.metrics` | Query |
| Systems | `systems.remove` | Mutation |
| Alerts | `alerts.list` | Query |
| Alerts | `alerts.ack` | Mutation |
| Alerts | `alerts.resolve` | Mutation |
| Alert Rules | `alertRules.list` | Query |
| Alert Rules | `alertRules.update` | Mutation |
| Operator | `operator.sessions.list` | Query |
| Operator | `operator.sessions.get` | Query |
| Operator | `operator.sessions.create` | Mutation |
| Operator | `operator.sessions.setTitle` | Mutation |
| Operator | `operator.sessions.setApprovalMode` | Mutation |
| Operator | `operator.sessions.setPlanMode` | Mutation |
| Operator | `operator.sessions.setSkills` | Mutation |
| Operator | `operator.sessions.archive` | Mutation |
| Operator | `operator.sessions.delete` | Mutation |
| Operator | `operator.sessions.fork` | Mutation |
| Operator | `operator.prompt` | Mutation |
| Operator | `operator.sessions.abort` | Mutation |
| Operator | `operator.approvals.resolve` | Mutation |
| Operator | `operator.skills.list` | Query |
| Operator | `operator.models.list` | Query |
| Plugins | `plugins.runAction` | Mutation |
| Terminal | `terminal.input` | Mutation |
| Terminal | `terminal.resize` | Mutation |
| Terminal | `terminal.close` | Mutation |
| Streams | `metrics.subscribe` | Stream |
| Streams | `alerts.subscribe` | Stream |
| Streams | `systems.subscribe` | Stream |
| Streams | `operator.sessions.watch` | Stream |
| Streams | `plugins.logs` | Stream |
| Streams | `terminal.open` | Stream |

### Agent -> Hub (`AgentHubRpcs` -- 3 methods)

| Method | Description |
|--------|-------------|
| `agent.connect` | Register agent with hostname, capabilities, and plugin capabilities |
| `agent.report` | Send core metrics payload (CPU, memory, disk, network, etc.) |
| `agent.reportPluginCollection` | Send plugin entity snapshots, metric points, and events |

### Hub -> Agent (`HubAgentRpcs` -- 6 methods)

| Method | Type | Description |
|--------|------|-------------|
| `plugins.runAction` | Mutation | Execute a plugin action on the agent |
| `plugins.logs` | Stream | Tail plugin log output from the agent |
| `terminal.open` | Stream | Open a PTY session on the agent |
| `terminal.input` | Mutation | Send input to an active terminal session |
| `terminal.resize` | Mutation | Resize an active terminal session |
| `terminal.close` | Mutation | Close an active terminal session |

## Database

All state is stored in a single SQLite database (WAL mode) managed by Drizzle ORM. The database path is configured via `SCOUT_DB_PATH`.

### Core Tables

| Table | Description |
|-------|-------------|
| `systems` | Registered agents with hostname, status (online/offline/pending), capabilities, plugin capabilities, and last-seen timestamp |
| `system_metrics` | Time-series core metric samples (JSON blobs of `SystemMetricsSample`) with tiered retention type (1m/10m/20m/120m/480m) |
| `alert_rules` | Alert rule definitions with metric, operator, threshold, consecutive count, severity, and enabled flag |
| `alerts` | Fired alert instances with rule reference, system, state (active/acknowledged/resolved), severity, and timestamps |

### Plugin Tables

| Table | Description |
|-------|-------------|
| `plugin_entities` | Plugin-reported entity snapshots with kind, labels, spec, state, and relationships (composite key: systemId + pluginId + entityId) |
| `plugin_metric_points` | Plugin metric time-series with metric ID, entity reference, value, unit, and tags |
| `plugin_events` | Plugin event log with severity (info/warning/error), entity reference, and JSON payload |

### Operator Storage

The operator does not use Drizzle tables. Its sessions live in a separate pi-durable SQLite file (`SCOUT_OPERATOR_DB_PATH`, default `scout-operator.db` next to `SCOUT_DB_PATH`) whose schema pi-durable owns. See `docs/operator/architecture.md`.

## Plugin Model

Scout uses a plugin-native architecture where domain-specific capabilities (systemd, Docker, Kubernetes) are delivered as runtime-loaded trusted plugins.

### Plugin Structure

Each plugin is a package under `packages/plugin-*` with a standard structure:

```
packages/plugin-docker/
+-- src/
|   +-- contracts.ts   # IDs, schemas, entity kinds, metric definitions
|   +-- manifest.ts    # Plugin manifest with capabilities, actions, streams
|   +-- agent.ts       # Agent-side collection and action execution
|   +-- hub.ts         # Hub-side storage and query logic (if needed)
|   +-- web.ts         # Schema-driven web view definitions
|   +-- index.ts       # Public barrel export
```

### Plugin Lifecycle

1. **Discovery**: `PluginRegistry` in the hub scans first-party packages (`packages/plugin-*`) and optional external directories (`SCOUT_PLUGIN_DIR`)
2. **Manifest**: Each plugin exports a `definePluginManifest` result declaring its ID, display name, actions, streams, metrics, entity kinds, and permissions
3. **Contracts**: Plugin-specific schemas (entity shapes, metric IDs, action inputs) live in `contracts.ts` and are the canonical public surface
4. **Agent Runtime**: The agent plugin host loads plugin agent modules, runs collection on the 15-second tick, and handles hub-initiated action/stream requests
5. **Hub Runtime**: The hub receives plugin collection results via `agent.reportPluginCollection`, persists entities/metrics/events, and serves them via REST and RPC
6. **Web Views**: Plugins export schema-driven view definitions that the generic plugin route (`/systems/$systemId/plugins/$pluginId`) renders using JSON-described UI components

### First-Party Plugins

| Plugin | Package | Capabilities |
|--------|---------|-------------|
| systemd | `packages/plugin-systemd` | Service entities, metrics, start/stop/restart/enable/disable actions, journal logs |
| Docker | `packages/plugin-docker` | Container/image/volume/network entities, container metrics (CPU/mem/net), start/stop/restart actions, container logs |
| Kubernetes | `packages/plugin-k8s` | Cluster/namespace/node/pod/deployment/service/ingress/job entities, resource metrics and events, scale/restart actions, pod logs |

### Plugin Operator Surface

Plugins can optionally contribute to the operator by exporting an operator surface:

- **Tools**: Custom `AgentTool` instances injected into operator sessions
- **Skills**: `SKILL.md` files or `ScoutOperatorSkillDefinition` objects attached to sessions as system prompt extensions
- **Resources**: Reference documentation available to the operator
- **Hooks**: `beforePrompt`, `beforeToolCall`, and `afterToolCall` lifecycle hooks

## Operator

The operator is an AI-powered assistant for system administration, built on pi-durable (`@earendil-works/pi-durable`). It runs as a set of hub services that manage durable sessions, execute tools against monitored nodes, and stream results to the browser in real time.

See [docs/operator/README.md](operator/README.md) for user-facing documentation and [docs/operator/architecture.md](operator/architecture.md) for developer-facing architecture details.

## Configuration

All configuration is through environment variables. No configuration files.

### Hub Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SCOUT_TOKEN` | Yes | -- | Agent authentication token; blank is refused |
| `SCOUT_ACCESS_TEAM_DOMAIN` | Yes, unless auth disabled | -- | Cloudflare Access team domain, e.g. `aryalabs.cloudflareaccess.com` |
| `SCOUT_ACCESS_AUD` | Yes, unless auth disabled | -- | Access application Audience (AUD) tag |
| `SCOUT_AUTH` | No | `access` | `access` or `disabled`; `disabled` requires a loopback `SCOUT_HOST` |
| `SCOUT_ACCESS_CERTS_URL` | No (test only) | `https://<team-domain>/cdn-cgi/access/certs` | JWKS URL override for local tests |
| `SCOUT_HOST` | No | `127.0.0.1` | HTTP/WebSocket listen address |
| `SCOUT_PORT` | No | `3001` | HTTP/WebSocket listen port |
| `SCOUT_DB_PATH` | No | `./scout.db` | SQLite database file path |
| `SCOUT_LOG_LEVEL` | No | `info` | Structured log level |
| `SCOUT_PLUGIN_DIR` | No | `packages/` | Directory to scan for plugins |

### Web Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SCOUT_HUB_URL` | No | `http://127.0.0.1:3001` | Hub base URL for SSR/server functions (and the Vite dev proxy) |
| `NITRO_HOST` / `NITRO_PORT` | No | nitro defaults | Production listener of the built server |

### Operator Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SCOUT_OPERATOR_DB_PATH` | No | `scout-operator.db` next to `SCOUT_DB_PATH` | pi-durable SQLite file for operator sessions |
| `SCOUT_OPERATOR_MODEL_PROVIDER` | No | Auto-detected among configured providers (prefers anthropic, then openai) | pi-ai provider ID for the default operator model; `faux` selects a scripted local model for smoke tests |
| `SCOUT_OPERATOR_MODEL_ID` | No | First reasoning model from selected provider | Specific model ID within the provider |
| `SCOUT_OPERATOR_THINKING_LEVEL` | No | `medium` | Thinking level: off, minimal, low, medium, high, xhigh |
| `SCOUT_OPERATOR_SYSTEM_PROMPT` | No | Built-in prompt | Custom system prompt for the operator |
| `SCOUT_OPERATOR_SKILLS_DIRS` | No | -- | Colon-separated list of additional directories to scan for SKILL.md files |
| `MINIMAX_API_KEY` | No | -- | API key for MiniMax provider (if used) |

### Agent Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SCOUT_HUB_URL` | Yes | -- | URL of the hub (e.g., `ws://127.0.0.1:3901`) |
| `SCOUT_TOKEN` | Yes | -- | Agent authentication token (must match hub); blank is refused |
| `SCOUT_HOSTNAME` | No | OS hostname | System id reported to the hub |
| `KUBECONFIG` | No | kubectl default | Kubeconfig used by the k8s plugin's `kubectl` calls |
| `SCOUT_PLUGIN_DIR` | No | -- | Additional directory to scan for external plugins |
| `SCOUT_LOG_LEVEL` | No | `info` | Structured log level |
| `SCOUT_COLLECTORS_DISABLE` | No | -- | Comma-separated list of core collectors to disable |
| `SCOUT_COLLECTORS_ENABLE` | No | -- | Comma-separated list of core collectors to force-enable |

## Locked Decisions

These architectural decisions are locked and should not be revisited without explicit justification.

| Decision | Choice |
|----------|--------|
| Hub deployment | Hub (API + WS) and web (SSR) as separate Bun processes, systemd user units on agni |
| Agent deployment | Standalone binary + systemd per machine |
| Collectors | Auto-discover + config override per agent |
| K8s monitoring | Generic discovery (not Agni-specific) |
| Data retention | 30-day tiered (1m -> 10m -> 20m -> 120m -> 480m) |
| Plugin model | Runtime-loaded trusted plugins, one package per plugin |
| Web serving | Reverse proxy splits one origin between web (pages) and hub (`/api`, `/ws`, `/health`) |
| SSR strategy | Server functions for initial load, direct client -> hub after |
| Terminal emulator | ghostty-web (custom React wrapper) |
| HTTP layer | @effect/platform-bun (native WS upgrade) |
| Alert rules | Standard defaults with 3-strike debounce |
| Type strategy | Schema-first at platform boundaries, TS inferred from Effect Schema |
| Report interval | 15 seconds |
| React | React 19 + shadcn/ui v4 + @effect/atom-react |
| Client <-> hub protocol | effect/rpc over WebSocket (NDJSON), AtomRpc.Service |
| Hub <-> agent protocol | effect/rpc over one WebSocket, DuplexRpcSocket adapter |
| Auth | Cloudflare Access JWT for browsers; shared token for agents |
| Network metrics | Total rx/tx bytes only |
| K8s scope | Full workload (Pods, Deployments, Services, Ingress, Jobs) |
| Historical ranges | 1h / 6h / 24h / 7d |
| Linting | oxlint + oxfmt |
| Name | Scout (final) |
