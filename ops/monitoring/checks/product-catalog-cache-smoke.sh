#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APP_DIR="$ROOT_DIR/apps/product-catalog-cache"
COMPOSE_FILE="$ROOT_DIR/ops/docker-compose.floci.yml"
APP_URL="${PRODUCT_CATALOG_CACHE_APP_URL:-http://127.0.0.1:3011}"
GRAFANA_URL="${PRODUCT_CATALOG_CACHE_GRAFANA_URL:-http://127.0.0.1:3012}"
PROMETHEUS_URL="${PRODUCT_CATALOG_CACHE_PROMETHEUS_URL:-http://127.0.0.1:9091}"
LOKI_URL="${PRODUCT_CATALOG_CACHE_LOKI_URL:-http://127.0.0.1:3101}"
EXPORTER_URL="${FLOCI_EXPORTER_URL:-http://127.0.0.1:9464}"
TMP_DIR="$(mktemp -d)"
SERVER_LOG="$TMP_DIR/product-catalog-cache-api.log"
PID=""

docker rm -f \
  product-catalog-cache-prometheus \
  product-catalog-cache-loki \
  product-catalog-cache-promtail \
  product-catalog-cache-grafana >/dev/null 2>&1 || true

cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" >/dev/null 2>&1; then
    kill "$PID" >/dev/null 2>&1 || true
    wait "$PID" >/dev/null 2>&1 || true
  fi
  docker compose -f "$COMPOSE_FILE" stop grafana prometheus loki promtail >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

echo "Running product-catalog-cache monitoring smoke check"

bash "$APP_DIR/scripts/setup.sh" >/dev/null

pkill -f "product-catalog-cache/api/server.mjs" >/dev/null 2>&1 || true
sleep 1

for _ in $(seq 1 30); do
  if curl -fsS "$APP_URL/api/health" >/dev/null 2>&1; then
    break
  fi
  if [ -z "$PID" ]; then
    PRODUCT_CATALOG_CACHE_PORT=3011 node "$APP_DIR/api/server.mjs" >"$SERVER_LOG" 2>&1 &
    PID=$!
  fi
  sleep 1
done

curl -fsS "$APP_URL/api/health" >/dev/null

docker compose -f "$COMPOSE_FILE" up -d grafana prometheus loki promtail >/dev/null

for _ in $(seq 1 40); do
  if curl -fsS "$GRAFANA_URL/api/health" >/dev/null 2>&1 && \
     curl -fsS "$PROMETHEUS_URL/-/ready" >/dev/null 2>&1 && \
     curl -fsS "$EXPORTER_URL/health" >/dev/null 2>&1 && \
     curl -fsS "$LOKI_URL/ready" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

curl -fsS "$APP_URL/api/products?q=hoodie" >/dev/null
curl -fsS "$APP_URL/api/products?q=hoodie" >/dev/null
curl -fsS -X POST \
  -H "Content-Type: application/json" \
  --data '{"sku":"sku-monitor","name":"Monitor Product","description":"Inserted for monitoring smoke","priceCents":20900}' \
  "$APP_URL/api/products" >/dev/null

for _ in $(seq 1 30); do
  curl -fsS "$GRAFANA_URL/api/health" >"$TMP_DIR/grafana.json" || true
  curl -fsS "$EXPORTER_URL/health" >"$TMP_DIR/exporter-health.json" || true
  curl -fsS "$EXPORTER_URL/metrics" >"$TMP_DIR/exporter-metrics.txt" || true
  curl -fsS "$PROMETHEUS_URL/api/v1/query?query=hands_on_http_requests_total%7Bapp%3D%22product-catalog-cache%22%7D" >"$TMP_DIR/prometheus-requests.json" || true
  curl -fsS "$PROMETHEUS_URL/api/v1/query?query=hands_on_domain_events_total%7Bapp%3D%22product-catalog-cache%22%7D" >"$TMP_DIR/prometheus-events.json" || true
  curl -fsS --get \
    --data-urlencode 'query={app="product-catalog-cache"}' \
    --data-urlencode "start=$(date -u -d '2 minutes ago' +%s)000000000" \
    --data-urlencode "end=$(date -u +%s)000000000" \
    --data-urlencode 'limit=20' \
    "$LOKI_URL/loki/api/v1/query_range" >"$TMP_DIR/loki.json" || true

  if node -e 'const fs=require("fs"); const files=process.argv.slice(1); try { const grafana=JSON.parse(fs.readFileSync(files[0],"utf8")); const exporter=JSON.parse(fs.readFileSync(files[1],"utf8")); const exporterMetrics=fs.readFileSync(files[2],"utf8"); const req=JSON.parse(fs.readFileSync(files[3],"utf8")); const evt=JSON.parse(fs.readFileSync(files[4],"utf8")); const loki=JSON.parse(fs.readFileSync(files[5],"utf8")); const exporterOk=exporterMetrics.includes("floci_resource_total") && exporterMetrics.includes("floci_proxy_tcp_up"); if(grafana.database==="ok"&&exporter.status==="ok"&&exporterOk&&req.status==="success"&&Array.isArray(req.data.result)&&req.data.result.length>0&&evt.status==="success"&&Array.isArray(evt.data.result)&&evt.data.result.length>0&&loki.status==="success"&&loki.data&&Array.isArray(loki.data.result)&&loki.data.result.length>0){process.exit(0)} } catch (error) {} process.exit(1)' \
    "$TMP_DIR/grafana.json" \
    "$TMP_DIR/exporter-health.json" \
    "$TMP_DIR/exporter-metrics.txt" \
    "$TMP_DIR/prometheus-requests.json" \
    "$TMP_DIR/prometheus-events.json" \
    "$TMP_DIR/loki.json"; then
    break
  fi

  sleep 2
done

echo "Checking Grafana health output"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.database!=="ok"){process.exit(1)}' "$TMP_DIR/grafana.json"
echo "Checking floci exporter health output"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.status!=="ok"){process.exit(1)}' "$TMP_DIR/exporter-health.json"
echo "Checking floci exporter metrics output"
node -e 'const fs=require("fs"); const data=fs.readFileSync(process.argv[1],"utf8"); if(!data.includes("floci_resource_total")||!data.includes("floci_proxy_tcp_up")){process.exit(1)}' "$TMP_DIR/exporter-metrics.txt"
echo "Checking Prometheus request metrics"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.status!=="success"||!Array.isArray(data.data.result)||data.data.result.length===0){process.exit(1)}' "$TMP_DIR/prometheus-requests.json"
echo "Checking Prometheus domain events"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.status!=="success"||!Array.isArray(data.data.result)||data.data.result.length===0){process.exit(1)}' "$TMP_DIR/prometheus-events.json"
echo "Checking Loki log ingestion"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.status!=="success"||!data.data||!Array.isArray(data.data.result)||data.data.result.length===0){process.exit(1)}' "$TMP_DIR/loki.json"

echo "product-catalog-cache monitoring smoke check passed."
