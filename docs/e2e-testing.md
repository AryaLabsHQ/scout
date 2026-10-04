# E2E Testing

Scout's end-to-end test harness runs four Docker containers — each with systemd as PID 1 — that connect back to a hub running on your host machine. The web dev server also runs on the host, giving you hot reload across the full stack.

## Quick Start

Three terminals:

```bash
# 1. Hub (push schema on first run)
cd apps/hub
bun --env-file=.env.test run db:push
bun --env-file=.env.test run dev

# 2. Web
cd apps/web
bun --env-file=.env.test run dev

# 3. E2E containers + agents
cd e2e
./scripts/up.sh
```

Verify: `curl -s http://localhost:3001/health` should show `"connectedAgents": 4`.

Open http://localhost:3000 to use the web UI.

## Teardown

```bash
cd e2e
./scripts/down.sh            # stop containers, clean state
./scripts/down.sh --volumes  # also remove k3s persistent data
```

Hub and web are regular dev processes — Ctrl+C to stop.

## Architecture

```
Host (your machine)
├── apps/hub   → :3001  (Bun, hot reload)
├── apps/web   → :3000  (Vite, hot reload)
└── .scout/    → agent PID files + logs

Docker network
├── scout-node-server   (systemd + nginx + redis)
├── scout-node-k3s      (systemd + k3s single-node cluster)
├── scout-node-docker   (systemd + Docker-in-Docker)
└── scout-node-minimal  (systemd only, bare ubuntu)
```

Containers mount the repo read-only at `/opt/scout` so agents see your local edits without rebuilding. Each agent connects to the hub via `ws://host.docker.internal:3001`.

## Node Profiles

| Node | Plugin capabilities | What it tests |
|------|-------------------|---------------|
| `node-server` | systemd | Service management (nginx, redis), unit files, journal logs |
| `node-k3s` | systemd, k8s | Kubernetes workloads, pod logs, scale/restart actions |
| `node-docker` | systemd, docker | Container lifecycle, image/network inventory, container logs |
| `node-minimal` | systemd | Bare system — capability auto-discovery fallback |

All nodes also report core system metrics (CPU, memory, disk, network, processes).

## Environment

### apps/hub/.env.test

```
SCOUT_TOKEN=test-token-123
SCOUT_DB_PATH=./test.db
SCOUT_HOST=127.0.0.1
SCOUT_PORT=3001
SCOUT_AUTH=disabled
```

`SCOUT_AUTH=disabled` turns off Cloudflare Access verification for browsers and is refused unless
the hub listens on a loopback address. Agents still need `SCOUT_TOKEN`.

> **Linux hosts:** containers reach the host through `host.docker.internal` (the Docker bridge
> gateway), which does not reach a hub bound to `127.0.0.1`. Docker Desktop on macOS forwards it to
> host loopback, so the defaults work there. On Linux, bind the hub to the bridge gateway
> (`SCOUT_HOST=172.17.0.1`) and configure Access instead of disabling auth, for example with a
> test JWKS via `SCOUT_ACCESS_CERTS_URL`.

### apps/web/.env.test

```
SCOUT_HUB_URL=http://127.0.0.1:3001
```

The browser opens `/ws/rpc` on the web origin (`:3000`); the Vite dev server proxies it to
`SCOUT_HUB_URL`.

The containers use matching env vars set in `e2e/compose.yml`:

```
SCOUT_HUB_URL=ws://host.docker.internal:3001
SCOUT_TOKEN=test-token-123
SCOUT_INTERVAL=15
```

> **Note:** Use `127.0.0.1` (not `localhost`) for `SCOUT_HUB_URL` in the web env. On macOS, `localhost` may resolve to IPv6 first and collide with other processes on the same port.

## Scripts

All scripts live in `e2e/scripts/` and should be run from the `e2e/` directory.

| Script | Usage | Purpose |
|--------|-------|---------|
| `up.sh [node]` | `./scripts/up.sh` | Build images, start containers, launch agents |
| `down.sh [--volumes]` | `./scripts/down.sh` | Stop containers, clean `.scout/` state |
| `logs.sh [node]` | `./scripts/logs.sh node-k3s` | Tail agent logs (no args = last 20 lines from all) |
| `exec.sh <node> [cmd]` | `./scripts/exec.sh node-server` | Shell into container (or run a command) |
| `stop-agents.sh [node]` | `./scripts/stop-agents.sh` | SIGTERM agents without tearing down containers |

### Starting a single node

```bash
./scripts/up.sh node-server
```

### Restarting an agent (without rebuilding the container)

```bash
./scripts/stop-agents.sh node-docker
docker exec -d scout-node-docker /opt/scout/e2e/scripts/run-agent.sh
```

### Deploying the K8s test workload

```bash
./scripts/exec.sh node-k3s kubectl apply -f /opt/scout/e2e/fixtures/k3s/test-app.yaml
```

This creates a `scout-test` namespace with a nginx Deployment (2 replicas), a ClusterIP Service, and a redis StatefulSet.

## Agent Logs

Agent stdout/stderr is written to `.scout/<node-name>.log` on the host:

```bash
tail -f .scout/node-server.log    # from e2e/ directory
# or
./scripts/logs.sh node-server     # equivalent
```

PID files at `.scout/<node-name>.pid` track the agent process inside each container.

## Hub Database

The hub uses `apps/hub/test.db` (SQLite). To reset:

```bash
rm apps/hub/test.db
cd apps/hub && bun --env-file=.env.test run db:push
```

## Troubleshooting

**`connectedAgents: 0` after `up.sh`**

Check agent logs: `./scripts/logs.sh`. Common causes:
- Hub not running on port 3001
- Schema not pushed (`bun --env-file=.env.test run db:push`)
- Layer wiring error in agent (check for "Service not found" in logs)

**Container stuck on "timeout waiting for systemd"**

The container's systemd may report `degraded` instead of `running` (usually means a service failed to start). This is usually fine — retry or start the agent manually:

```bash
docker exec -d scout-node-docker /opt/scout/e2e/scripts/run-agent.sh
```

**Port 3000 already in use**

Vite auto-increments ports. Kill the stale process: `lsof -ti:3000 | xargs kill`

**Plugin data not appearing**

Check for schema validation errors in agent logs (`grep "WARN" .scout/<node>.log`). Common cause: entity fields set to `undefined` instead of omitted — `Schema.optionalKey` rejects explicit `undefined`.

## File Structure

```
e2e/
├── compose.yml                  # Docker Compose services
├── fixtures/
│   └── k3s/test-app.yaml       # Sample K8s workload
├── nodes/
│   ├── base.Dockerfile          # Ubuntu 24.04 + systemd + bun
│   ├── server.Dockerfile        # + nginx + redis
│   ├── k3s.Dockerfile           # + k3s
│   ├── docker.Dockerfile        # + Docker CE (DinD, VFS driver)
│   └── minimal.Dockerfile       # Base only
└── scripts/
    ├── up.sh
    ├── down.sh
    ├── logs.sh
    ├── exec.sh
    ├── run-agent.sh
    └── stop-agents.sh
```
