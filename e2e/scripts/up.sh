#!/usr/bin/env bash
# Scout E2E harness: bring up all nodes, start the agent in each.
#
# Usage: ./scripts/up.sh [node-name]
#   With no args:     start all nodes
#   With node name:   start only that node (e.g. node-server, node-k3s)
#
# Prerequisite: the hub must already be running on localhost:3001.
# Start it from apps/hub with:
#   SCOUT_AGENT_TOKENS=node-server=test-token-server,node-k3s=test-token-k3s,node-docker=test-token-docker,node-minimal=test-token-minimal bun run dev

set -euo pipefail

cd "$(dirname "$0")/.."

# Ensure the shared runtime state dir exists on the host before containers
# mount it. Without this, Docker creates it as root-owned.
mkdir -p ../.scout

# Build the shared base image first (compose doesn't auto-build it since it's
# only used via FROM in other Dockerfiles)
echo "==> Building base image..."
docker compose --profile build build base

# Bring up requested nodes (or all if none specified)
if [ $# -eq 0 ]; then
  echo "==> Starting all nodes..."
  docker compose up -d --build node-server node-k3s node-docker node-minimal
  NODES=(node-server node-k3s node-docker node-minimal)
else
  echo "==> Starting $1..."
  docker compose up -d --build "$1"
  NODES=("$1")
fi

# Wait for each container to be healthy enough to run the agent
echo "==> Waiting for containers to be ready..."
for node in "${NODES[@]}"; do
  container="scout-$node"
  for i in {1..30}; do
    if docker exec "$container" systemctl is-system-running 2>/dev/null | grep -qE "running|degraded|starting"; then
      echo "    $container: ready"
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo "    $container: timeout waiting for systemd"
      exit 1
    fi
    sleep 1
  done
done

# Stop any previously running agent for each node (by PID file), then start
# a fresh agent via the run-agent.sh wrapper which records its PID.
echo "==> Starting Scout agent in each node..."
for node in "${NODES[@]}"; do
  container="scout-$node"
  pidfile="../.scout/${node}.pid"

  # Stop previous instance if PID file exists
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    docker exec "$container" kill -TERM "$pid" 2>/dev/null || true
    rm -f "$pidfile"
  fi

  # Start fresh via the wrapper script (records PID, execs bun)
  docker exec -d "$container" /opt/scout/e2e/scripts/run-agent.sh

  # Wait up to 5s for the pid file to appear so we know the agent started
  for i in {1..10}; do
    if [ -f "$pidfile" ]; then
      pid=$(cat "$pidfile")
      echo "    $container: agent started (pid=$pid)"
      break
    fi
    sleep 0.5
    if [ "$i" -eq 10 ]; then
      echo "    $container: agent failed to start (no pid file)"
    fi
  done
done

echo ""
echo "==> Done. Verify with:"
echo "    curl -s http://localhost:3001/health | python3 -m json.tool"
echo "    curl -s http://localhost:3001/api/systems | python3 -m json.tool"
echo ""
echo "    View agent logs:"
echo "    tail -f .scout/<node-name>.log"
