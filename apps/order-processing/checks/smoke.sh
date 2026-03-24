#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT_DIR/ops/floci-env.sh"

ENDPOINT="$AWS_ENDPOINT"
PROFILE="$AWS_PROFILE"
REGION="$AWS_DEFAULT_REGION"
ACCESS_KEY="$AWS_ACCESS_KEY_ID"
SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
ORDER_QUEUE="${ORDER_QUEUE_NAME:-order-processing-queue}"
EVENT_QUEUE="${EVENT_QUEUE_NAME:-order-processing-events}"
TABLE="${ORDER_TABLE_NAME:-orders}"
APP_URL="${ORDER_PROCESSING_APP_URL:-http://127.0.0.1:3002}"
TMP_DIR="$(mktemp -d)"
API_LOG="$TMP_DIR/order-api.log"
WORKER_LOG="$TMP_DIR/order-worker.log"
API_PID=""
WORKER_PID=""

cleanup() {
  if [ -n "$API_PID" ] && kill -0 "$API_PID" >/dev/null 2>&1; then
    kill "$API_PID" >/dev/null 2>&1 || true
    wait "$API_PID" >/dev/null 2>&1 || true
  fi
  if [ -n "$WORKER_PID" ] && kill -0 "$WORKER_PID" >/dev/null 2>&1; then
    kill "$WORKER_PID" >/dev/null 2>&1 || true
    wait "$WORKER_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}

run_aws() {
  AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
  AWS_DEFAULT_REGION="$REGION" \
  aws --profile "$PROFILE" --endpoint-url "$ENDPOINT" "$@"
}

trap cleanup EXIT

echo "Running order-processing smoke check against $ENDPOINT"

bash "$ROOT_DIR/apps/order-processing/scripts/setup.sh" >/dev/null

run_aws sqs get-queue-url --queue-name "$ORDER_QUEUE" >/dev/null
run_aws sqs get-queue-url --queue-name "$EVENT_QUEUE" >/dev/null
run_aws sns list-topics >/dev/null
run_aws dynamodb describe-table --table-name "$TABLE" >/dev/null

ORDER_PROCESSING_WORKER_POLL_MS=500 \
  node "$ROOT_DIR/apps/order-processing/worker/worker.mjs" >"$WORKER_LOG" 2>&1 &
WORKER_PID=$!

ORDER_PROCESSING_PORT=3002 \
  node "$ROOT_DIR/apps/order-processing/api/server.mjs" >"$API_LOG" 2>&1 &
API_PID=$!

for _ in $(seq 1 20); do
  if curl -fsS "$APP_URL/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "$APP_URL/" >/dev/null
curl -fsS "$APP_URL/api/health" >"$TMP_DIR/health.json"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.status!=="ok"){process.exit(1)}' "$TMP_DIR/health.json"

cat >"$TMP_DIR/order.json" <<EOF
{
  "customerName": "Smoke Test Customer",
  "itemName": "Demo Mug",
  "quantity": 2
}
EOF

curl -fsS -X POST \
  -H "Content-Type: application/json" \
  --data @"$TMP_DIR/order.json" \
  "$APP_URL/api/orders" >"$TMP_DIR/order-response.json"

ORDER_ID="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!data.id){process.exit(1)} process.stdout.write(data.id)' "$TMP_DIR/order-response.json")"

STATUS=""
for _ in $(seq 1 20); do
  curl -fsS "$APP_URL/api/orders/$ORDER_ID" >"$TMP_DIR/detail.json"
  STATUS="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.status || "")' "$TMP_DIR/detail.json")"
  if [ "$STATUS" = "COMPLETED" ]; then
    break
  fi
  sleep 1
done

test "$STATUS" = "COMPLETED"

curl -fsS "$APP_URL/api/orders" >"$TMP_DIR/orders.json"
curl -fsS "$APP_URL/api/events" >"$TMP_DIR/events.json"

node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!Array.isArray(data.items)||!data.items.find((item)=>item.id===process.argv[2])){process.exit(1)}' "$TMP_DIR/orders.json" "$ORDER_ID"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!Array.isArray(data.items)||!data.items.find((item)=>String(item.message).includes(process.argv[2]))){process.exit(1)}' "$TMP_DIR/events.json" "$ORDER_ID"

echo "order-processing smoke check passed."
