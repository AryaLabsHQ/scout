#!/usr/bin/env bash
# Stop the Scout agent in one or all nodes (without stopping containers).
# Uses the PID files written by run-agent.sh for precise process targeting.
#
# Usage: ./scripts/stop-agents.sh [node-name]

set -euo pipefail

cd "$(dirname "$0")/.."

if [ $# -eq 0 ]; then
  # Stop all agents we have PID files for
  shopt -s nullglob
  for pidfile in ../.scout/*.pid; do
    node=$(basename "$pidfile" .pid)
    container="scout-$node"
    pid=$(cat "$pidfile")
    if docker exec "$container" kill -TERM "$pid" 2>/dev/null; then
      echo "    $container: stopped agent (pid=$pid)"
    else
      echo "    $container: agent not running (stale pid file)"
    fi
    rm -f "$pidfile"
  done
else
  node=$1
  container="scout-$node"
  pidfile="../.scout/${node}.pid"
  if [ ! -f "$pidfile" ]; then
    echo "No pid file for $node"
    exit 1
  fi
  pid=$(cat "$pidfile")
  docker exec "$container" kill -TERM "$pid" 2>/dev/null && \
    echo "    $container: stopped agent (pid=$pid)" || \
    echo "    $container: agent not running (stale pid file)"
  rm -f "$pidfile"
fi
