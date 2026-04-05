#!/usr/bin/env bash
# Drop into an interactive shell inside a node.
#
# Usage: ./scripts/exec.sh <node-name> [command...]
#   ./scripts/exec.sh node-server
#   ./scripts/exec.sh node-k3s kubectl get pods -A

set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: $0 <node-name> [command...]"
  echo "Available nodes: node-server, node-k3s, node-docker, node-minimal"
  exit 1
fi

node=$1
shift

if [ $# -eq 0 ]; then
  docker exec -it "scout-$node" bash
else
  docker exec -it "scout-$node" "$@"
fi
