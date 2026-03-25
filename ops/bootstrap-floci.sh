#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/ops/docker-compose.floci.yml"
ENDPOINT="${AWS_ENDPOINT:-http://localhost:4566}"
EXPORTER_PORT="${FLOCI_EXPORTER_PORT:-9464}"
EXPORTER_URL="http://127.0.0.1:${EXPORTER_PORT}/health"

pkill -f "ops/monitoring/exporter/server.mjs" >/dev/null 2>&1 || true

docker compose -f "$COMPOSE_FILE" up -d floci
docker compose -f "$COMPOSE_FILE" up -d --build --force-recreate floci-exporter
docker compose -f "$COMPOSE_FILE" up -d --force-recreate prometheus loki promtail grafana

echo "Waiting for floci at $ENDPOINT ..."
for _ in $(seq 1 30); do
  if curl -fsS "$ENDPOINT" >/dev/null 2>&1; then
    echo "floci is reachable at $ENDPOINT"
    break
  fi
  sleep 1
done

if ! curl -fsS "$ENDPOINT" >/dev/null 2>&1; then
  echo "floci did not become reachable at $ENDPOINT" >&2
  exit 1
fi

echo "Waiting for floci exporter at $EXPORTER_URL ..."
for _ in $(seq 1 20); do
  if curl -fsS "$EXPORTER_URL" >/dev/null 2>&1; then
    echo "floci exporter is reachable at http://127.0.0.1:${EXPORTER_PORT}"
    exit 0
  fi
  sleep 1
done

echo "floci exporter did not become reachable at $EXPORTER_URL" >&2
exit 1
