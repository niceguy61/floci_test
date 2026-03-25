#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT_DIR/ops/floci-env.sh"

APP_URL="${PRODUCT_CATALOG_CACHE_APP_URL:-http://127.0.0.1:3011}"
TMP_DIR="$(mktemp -d)"
SERVER_LOG="$TMP_DIR/product-catalog-cache.log"
HEALTH_FILE="$TMP_DIR/health.json"
PID=""

cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" >/dev/null 2>&1; then
    kill "$PID" >/dev/null 2>&1 || true
    wait "$PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

echo "Running product-catalog-cache smoke check against $AWS_ENDPOINT"

bash "$ROOT_DIR/apps/product-catalog-cache/scripts/setup.sh" >/dev/null

PRODUCT_CATALOG_CACHE_PORT=3011 node "$ROOT_DIR/apps/product-catalog-cache/api/server.mjs" >"$SERVER_LOG" 2>&1 &
PID=$!

for _ in $(seq 1 30); do
  if curl -fsS "$APP_URL/api/health" >"$HEALTH_FILE" 2>/dev/null; then
    break
  fi
  sleep 1
done

curl -fsS "$APP_URL/" >/dev/null
curl -fsS "$APP_URL/api/health" >"$HEALTH_FILE"

node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.status!=="ok"||!data.rds||!data.cache){process.exit(1)}' "$HEALTH_FILE"

curl -fsS -X POST \
  -H "Content-Type: application/json" \
  --data '{"sku":"sku-smoke","name":"Smoke Product","description":"Inserted by smoke test","priceCents":19900}' \
  "$APP_URL/api/products" >"$TMP_DIR/create.json"

curl -fsS "$APP_URL/api/products?q=Smoke" >"$TMP_DIR/list-first.json"
curl -fsS "$APP_URL/api/products?q=Smoke" >"$TMP_DIR/list-second.json"
curl -fsS "$APP_URL/api/products/sku-smoke" >"$TMP_DIR/detail-first.json"
curl -fsS "$APP_URL/api/products/sku-smoke" >"$TMP_DIR/detail-second.json"

node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.source!=="db"||!Array.isArray(data.items)||!data.items.find((item)=>item.sku==="sku-smoke")){process.exit(1)}' "$TMP_DIR/list-first.json"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.source!=="cache"||!Array.isArray(data.items)||!data.items.find((item)=>item.sku==="sku-smoke")){process.exit(1)}' "$TMP_DIR/list-second.json"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.source!=="db"||!data.item||data.item.sku!=="sku-smoke"){process.exit(1)}' "$TMP_DIR/detail-first.json"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.source!=="cache"||!data.item||data.item.sku!=="sku-smoke"){process.exit(1)}' "$TMP_DIR/detail-second.json"

RDS_HOST="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.rds.host);' "$HEALTH_FILE")"
RDS_PORT="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(data.rds.port));' "$HEALTH_FILE")"
RDS_USER="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.rds.username);' "$HEALTH_FILE")"
RDS_PASSWORD="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.rds.password);' "$HEALTH_FILE")"
RDS_DATABASE="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.rds.database);' "$HEALTH_FILE")"

COUNT="$(PGPASSWORD="$RDS_PASSWORD" psql -h "$RDS_HOST" -p "$RDS_PORT" -U "$RDS_USER" -d "$RDS_DATABASE" -Atqc "select count(*) from products where sku = 'sku-smoke';")"
if [ "$COUNT" != "1" ]; then
  echo "Expected sku-smoke to exist in products table, got count=$COUNT" >&2
  exit 1
fi

echo "product-catalog-cache smoke check passed."
