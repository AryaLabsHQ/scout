#!/usr/bin/env bash
# Tail agent logs from one or all nodes.
#
# Usage: ./scripts/logs.sh [node-name]
#   With no args:     show last lines from all node logs
#   With node name:   follow log from that node (e.g. node-server)
#
# Logs are written by run-agent.sh to .scout/<node>.log on the host via a
# shared mount, so we read directly from the filesystem instead of docker exec.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ $# -eq 0 ]; then
  shopt -s nullglob
  logs=(../.scout/*.log)
  if [ ${#logs[@]} -eq 0 ]; then
    echo "No agent logs found in .scout/"
    exit 0
  fi
  for log in "${logs[@]}"; do
    node=$(basename "$log" .log)
    echo "=== $node ==="
    tail -20 "$log"
    echo ""
  done
else
  log="../.scout/$1.log"
  if [ ! -f "$log" ]; then
    echo "No log found at .scout/$1.log"
    exit 1
  fi
  tail -f "$log"
fi
