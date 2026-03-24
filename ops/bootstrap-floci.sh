#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/ops/docker-compose.floci.yml"
ENDPOINT="${AWS_ENDPOINT:-http://localhost:4566}"

docker compose -f "$COMPOSE_FILE" up -d

echo "Waiting for floci at $ENDPOINT ..."
for _ in $(seq 1 30); do
  if curl -fsS "$ENDPOINT" >/dev/null 2>&1; then
    echo "floci is reachable at $ENDPOINT"
    exit 0
  fi
  sleep 1
done

echo "floci did not become reachable at $ENDPOINT" >&2
exit 1
