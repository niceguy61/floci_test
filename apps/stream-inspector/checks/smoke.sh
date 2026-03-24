#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT_DIR/ops/floci-env.sh"

ENDPOINT="$AWS_ENDPOINT"
PROFILE="$AWS_PROFILE"
REGION="$AWS_DEFAULT_REGION"
ACCESS_KEY="$AWS_ACCESS_KEY_ID"
SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
STREAM="${STREAM_INSPECTOR_STREAM:-stream-inspector-stream}"
APP_URL="${STREAM_INSPECTOR_APP_URL:-http://127.0.0.1:3009}"
TMP_DIR="$(mktemp -d)"
SERVER_LOG="$TMP_DIR/stream-inspector.log"
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

echo "Running stream-inspector smoke check against $ENDPOINT"

bash "$ROOT_DIR/apps/stream-inspector/scripts/setup.sh" >/dev/null

STREAM_INSPECTOR_PORT=3009 node "$ROOT_DIR/apps/stream-inspector/api/server.mjs" >"$SERVER_LOG" 2>&1 &
PID=$!

for _ in $(seq 1 20); do
  if curl -fsS "$APP_URL/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "$APP_URL/" >/dev/null

curl -fsS -X POST \
  -H "Content-Type: application/json" \
  --data '{"partitionKey":"smoke","data":"hello-stream"}' \
  "$APP_URL/api/records" >"$TMP_DIR/create.json"

curl -fsS "$APP_URL/api/records" >"$TMP_DIR/list.json"

node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!Array.isArray(data.items)||!data.items.find((item)=>item.partitionKey==="smoke"&&item.data==="hello-stream")){process.exit(1)}' "$TMP_DIR/list.json"

run_aws kinesis describe-stream --stream-name "$STREAM" >/dev/null

echo "stream-inspector smoke check passed."
