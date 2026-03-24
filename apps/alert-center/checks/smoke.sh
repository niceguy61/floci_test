#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT_DIR/ops/floci-env.sh"

ENDPOINT="$AWS_ENDPOINT"
PROFILE="$AWS_PROFILE"
REGION="$AWS_DEFAULT_REGION"
ACCESS_KEY="$AWS_ACCESS_KEY_ID"
SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
TOPIC_NAME="${ALERT_CENTER_TOPIC_NAME:-alert-center-topic}"
QUEUE_A="${ALERT_CENTER_QUEUE_A:-alert-center-subscriber-a}"
QUEUE_B="${ALERT_CENTER_QUEUE_B:-alert-center-subscriber-b}"
APP_URL="${ALERT_CENTER_APP_URL:-http://127.0.0.1:3005}"
TMP_DIR="$(mktemp -d)"
SERVER_LOG="$TMP_DIR/alert-server.log"
PID=""

cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" >/dev/null 2>&1; then
    kill "$PID" >/dev/null 2>&1 || true
    wait "$PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

run_aws() {
  AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
  AWS_DEFAULT_REGION="$REGION" \
  aws --profile "$PROFILE" --endpoint-url "$ENDPOINT" "$@"
}

echo "Running alert-center smoke check against $ENDPOINT"

bash "$ROOT_DIR/apps/alert-center/scripts/setup.sh" >/dev/null

ALERT_CENTER_PORT=3005 node "$ROOT_DIR/apps/alert-center/api/server.mjs" >"$SERVER_LOG" 2>&1 &
PID=$!

for _ in $(seq 1 20); do
  if curl -fsS "$APP_URL/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "$APP_URL/" >/dev/null
curl -fsS "$APP_URL/api/health" >"$TMP_DIR/health.json"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.status!=="ok"){process.exit(1)}' "$TMP_DIR/health.json"

cat >"$TMP_DIR/message.json" <<EOF
{
  "title": "Smoke Alert",
  "body": "Published from smoke.sh"
}
EOF

curl -fsS -X POST \
  -H "Content-Type: application/json" \
  --data @"$TMP_DIR/message.json" \
  "$APP_URL/api/publish" >"$TMP_DIR/publish.json"

curl -fsS "$APP_URL/api/subscribers" >"$TMP_DIR/subscribers.json"

node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const a=data.subscriberA||[]; const b=data.subscriberB||[]; if(!a.length||!b.length){process.exit(1)} if(!a.find((item)=>String(item.message).includes("Smoke Alert"))){process.exit(1)} if(!b.find((item)=>String(item.message).includes("Smoke Alert"))){process.exit(1)}' "$TMP_DIR/subscribers.json"

run_aws sns list-topics >/dev/null
run_aws sqs get-queue-url --queue-name "$QUEUE_A" >/dev/null
run_aws sqs get-queue-url --queue-name "$QUEUE_B" >/dev/null

echo "alert-center smoke check passed."
