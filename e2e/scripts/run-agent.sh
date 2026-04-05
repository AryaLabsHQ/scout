#!/usr/bin/env bash
# run-agent.sh — wrapper that runs inside a node container to start the agent
# and record its PID to a shared file.
#
# The PID file lives at /opt/scout/.scout/<SCOUT_HOSTNAME>.pid. Since /opt/scout
# is a read-write mount from the host's .scout/ directory, host-side scripts
# (up.sh, down.sh) can read it to stop the agent by PID instead of pattern-
# matching processes.
#
# Usage (inside container):
#   SCOUT_HOSTNAME=node-server /opt/scout/e2e/scripts/run-agent.sh
#
# Typically invoked via: docker exec -d <container> /opt/scout/e2e/scripts/run-agent.sh

set -euo pipefail

: "${SCOUT_HOSTNAME:?SCOUT_HOSTNAME must be set}"

PIDFILE="/opt/scout/.scout/${SCOUT_HOSTNAME}.pid"
LOGFILE="/opt/scout/.scout/${SCOUT_HOSTNAME}.log"

mkdir -p "$(dirname "$PIDFILE")"

# Record our PID — after exec below, this script's PID becomes bun's PID
echo "$$" > "$PIDFILE"

# Auto-detect k3s kubeconfig so the agent's k8s collector can find it.
# k3s writes its config to /etc/rancher/k3s/k3s.yaml; the agent otherwise
# looks at $KUBECONFIG or ~/.kube/config, neither of which exists on a
# vanilla node-k3s container.
if [ -z "${KUBECONFIG:-}" ] && [ -r "/etc/rancher/k3s/k3s.yaml" ]; then
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
fi

cd /opt/scout/apps/agent

# exec replaces this shell with bun, preserving the PID we just saved
exec bun run dev > "$LOGFILE" 2>&1
