#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/product-catalog-cache"
APP_PORT="${PRODUCT_CATALOG_CACHE_PORT:-3011}"
APP_URL="${PRODUCT_CATALOG_CACHE_APP_URL:-http://127.0.0.1:${APP_PORT}}"
GRAFANA_URL="${PRODUCT_CATALOG_CACHE_GRAFANA_URL:-http://127.0.0.1:3012}"
PROMETHEUS_URL="${PRODUCT_CATALOG_CACHE_PROMETHEUS_URL:-http://127.0.0.1:9091}"
LOKI_URL="${PRODUCT_CATALOG_CACHE_LOKI_URL:-http://127.0.0.1:3101}"

docker rm -f \
  product-catalog-cache-prometheus \
  product-catalog-cache-loki \
  product-catalog-cache-promtail \
  product-catalog-cache-grafana >/dev/null 2>&1 || true

bash "$ROOT_DIR/ops/bootstrap-floci.sh"
bash "$APP_DIR/scripts/setup.sh"

echo "Waiting for Grafana / Prometheus / Loki ..."
for _ in $(seq 1 40); do
  if curl -fsS "$GRAFANA_URL/api/health" >/dev/null 2>&1 && \
     curl -fsS "$PROMETHEUS_URL/-/ready" >/dev/null 2>&1 && \
     curl -fsS "$LOKI_URL/ready" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "product-catalog-cache monitoring stack is ready."
echo "app: $APP_URL"
echo "grafana: $GRAFANA_URL"
echo "prometheus: $PROMETHEUS_URL"
echo "loki: $LOKI_URL"
echo "grafana login: admin / admin"

if curl -fsS "$APP_URL/api/health" >/dev/null 2>&1 && curl -fsS "$APP_URL/metrics" >/dev/null 2>&1; then
  echo "product-catalog-cache app is already running at $APP_URL"
  exit 0
fi

if curl -fsS "$APP_URL/api/health" >/dev/null 2>&1; then
  pkill -f "product-catalog-cache/api/server.mjs" >/dev/null 2>&1 || true
  sleep 1
fi

if ss -ltn | grep -q ":${APP_PORT}\b"; then
  echo "port $APP_PORT is already in use, but product-catalog-cache health did not respond." >&2
  echo "stop the existing process or set PRODUCT_CATALOG_CACHE_PORT to another port." >&2
  exit 1
fi

exec node "$APP_DIR/api/server.mjs"
