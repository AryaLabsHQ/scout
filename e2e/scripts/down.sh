#!/usr/bin/env bash
# Tear down the Scout E2E harness.
#
# Usage: ./scripts/down.sh [--volumes]
#   --volumes: also remove k3s-data and other persistent volumes

set -euo pipefail

cd "$(dirname "$0")/.."

if [ "${1:-}" = "--volumes" ]; then
  echo "==> Stopping and removing containers + volumes..."
  docker compose down -v
else
  echo "==> Stopping and removing containers..."
  docker compose down
fi

# Clean up stale PID + log files from the shared runtime dir
echo "==> Cleaning up .scout/ state..."
rm -f ../.scout/*.pid ../.scout/*.log

echo "==> Done."
