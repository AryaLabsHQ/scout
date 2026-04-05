# Scout E2E Test Harness

Docker-based multi-node test environment for exercising Scout end-to-end:
metrics collection, management actions, terminal, alerts, and the dashboard.

## Topology

```
┌──────────────────────────────┐
│   Your Mac (host)            │
│                              │
│   apps/hub  ──── :3001       │◀──┐
│   apps/web  ──── :3000       │   │ WS
└──────────────────────────────┘   │
                                   │ (host.docker.internal)
┌──────────────────────────────────┴────────────┐
│           Docker network                      │
│  ┌──────────────┐  ┌──────────────┐           │
│  │ node-server  │  │ node-k3s     │           │
│  │ systemd +    │  │ k3s + sample │           │
│  │ nginx+redis  │  │ workload     │           │
│  └──────────────┘  └──────────────┘           │
│  ┌──────────────┐  ┌──────────────┐           │
│  │ node-docker  │  │ node-minimal │           │
│  │ DinD + test  │  │ bare ubuntu  │           │
│  │ containers   │  │              │           │
│  └──────────────┘  └──────────────┘           │
└───────────────────────────────────────────────┘
```

The **hub runs on the host** (for hot reload), and each containerized node
runs the Scout agent from the mounted source tree at `/opt/scout`.

## Node profiles

Each node exercises a different subset of the agent's collectors.

| Node            | Capabilities                                  | What it tests                          |
| --------------- | --------------------------------------------- | -------------------------------------- |
| `node-server`   | system, network, process, smart, systemd      | Typical app server. systemd management |
| `node-k3s`      | + k8s (single-node cluster)                   | K8s collector, scale/restart actions   |
| `node-docker`   | + docker (Docker-in-Docker)                   | Docker collector + management          |
| `node-minimal`  | system, network (most capabilities absent)    | Capability auto-discovery fallback     |

## Usage

**Prerequisite:** The hub must be running on the host.

```bash
# In one terminal:
cd apps/hub
rm -f test.db  # fresh DB
SCOUT_TOKEN=test-token-123 SCOUT_DB_PATH=./test.db SCOUT_PORT=3001 bun run db:push
SCOUT_TOKEN=test-token-123 SCOUT_DB_PATH=./test.db SCOUT_PORT=3001 bun run dev

# In another terminal (optional — for the dashboard):
cd apps/web
SCOUT_HUB_URL=http://localhost:3001 bun run dev
```

Then bring up the test nodes:

```bash
# Start all nodes (builds images on first run — takes a few minutes)
./e2e/scripts/up.sh

# Or start a single node
./e2e/scripts/up.sh node-server

# Verify agents connected
curl -s http://localhost:3001/health | python3 -m json.tool
curl -s http://localhost:3001/api/systems | python3 -m json.tool
```

Expected output after `up.sh`:

```json
{ "connectedAgents": 4, "totalSystems": 4, ... }
```

### Working with individual nodes

```bash
# Tail agent logs (reads from .scout/<node>.log on the host)
./e2e/scripts/logs.sh node-server          # last 20 lines
./e2e/scripts/logs.sh node-server follow   # tail -f

# Drop into a shell in a node
./e2e/scripts/exec.sh node-k3s

# Run a one-off command
./e2e/scripts/exec.sh node-k3s kubectl get pods -A

# Stop just the agent in a node (without tearing down the container)
./e2e/scripts/stop-agents.sh node-server

# Restart the agent in a node (re-runs capability discovery)
./e2e/scripts/stop-agents.sh node-k3s
docker exec -d scout-node-k3s /opt/scout/e2e/scripts/run-agent.sh
```

### Deploying the k3s test workload

Once `node-k3s` is up and its agent is connected:

```bash
# Apply the sample workload (nginx deployment + redis statefulset)
./e2e/scripts/exec.sh node-k3s \
  kubectl apply -f /opt/scout/e2e/fixtures/k3s/test-app.yaml

# Verify
./e2e/scripts/exec.sh node-k3s kubectl get pods -n scout-test
```

The Scout dashboard's Workloads page should now show these pods.

### Tear down

```bash
./e2e/scripts/down.sh            # stop + remove containers
./e2e/scripts/down.sh --volumes  # also wipe k3s-data volume
```

## Layout

```
e2e/
├── README.md                    # this file
├── compose.yml                  # orchestrates all nodes
├── nodes/
│   ├── base.Dockerfile          # shared Ubuntu + systemd + bun
│   ├── server.Dockerfile        # + nginx + redis
│   ├── k3s.Dockerfile           # + k3s single-node
│   ├── docker.Dockerfile        # + Docker CE (DinD)
│   └── minimal.Dockerfile       # base only
├── scripts/
│   ├── up.sh                    # build + start + agent launch
│   ├── down.sh                  # stop + remove
│   ├── logs.sh                  # tail agent logs
│   └── exec.sh                  # exec into a node
└── fixtures/
    └── k3s/
        └── test-app.yaml        # sample k8s workload
```

## Runtime state

Per-node PID files and agent logs live in `.scout/` at the repo root. This
directory is mounted read-write into each container at `/opt/scout/.scout`,
so the host can read/write agent state without going through `docker exec`.

```
.scout/
├── node-server.pid    # PID of bun agent inside the container
├── node-server.log    # agent stdout/stderr
├── node-k3s.pid
├── node-k3s.log
└── ...
```

`run-agent.sh` runs inside each container and uses `exec bun` so its shell
PID becomes bun's PID, which is written to the pidfile *before* exec. This
gives precise process targeting for stop/restart without pattern-matching.

`.scout/` is gitignored.

## Known limitations

- **node-docker uses the `vfs` storage driver** for the inner dockerd,
  because nested overlay filesystems don't work inside Docker Desktop's
  overlay mount. vfs is slow but correct; fine for testing, never for prod.
- **node-k3s k8s collector**: the Scout agent's k8s collector uses a
  simplistic regex-based kubeconfig parser that doesn't handle k3s's
  self-signed CA or client-cert auth. The `k8s` capability is detected, but
  actual API calls fail with a TLS error. Fixing this requires a proper YAML
  parser and TLS configuration in the collector — tracked as a follow-up.

## Notes

- Containers run **privileged** with `/sys/fs/cgroup` mounted — required for
  systemd inside Docker. This is fine for local testing; obviously don't do it
  in production.
- The scout source tree is mounted **read-only** at `/opt/scout` so agents see
  your local edits without rebuilding images. The agent is run directly with
  `bun --hot` from the mount.
- `host.docker.internal` resolves to the host on Docker Desktop for Mac. On
  Linux you may need `--add-host=host.docker.internal:host-gateway` (already
  wired in `compose.yml`).
- If Docker Desktop's **Resource Saver** auto-pauses the engine, disable it in
  Settings → Resources → Resource Saver (or use a shorter idle timeout).
