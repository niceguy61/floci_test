#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT_DIR/ops/floci-env.sh"

ENDPOINT="$AWS_ENDPOINT"
PROFILE="$AWS_PROFILE"
REGION="$AWS_DEFAULT_REGION"
ACCESS_KEY="$AWS_ACCESS_KEY_ID"
SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
TABLE="${TODO_LOGS_TABLE_NAME:-todos}"
LOG_GROUP="${TODO_LOGS_LOG_GROUP:-/floci/todo-logs}"
LOG_STREAM="${TODO_LOGS_LOG_STREAM:-todo-api}"
APP_URL="${TODO_LOGS_APP_URL:-http://127.0.0.1:3004}"
TMP_DIR="$(mktemp -d)"
SERVER_LOG="$TMP_DIR/todo-server.log"
PID=""

cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" >/dev/null 2>&1; then
    kill "$PID" >/dev/null 2>&1 || true
    wait "$PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

echo "Running todo-logs smoke check against $ENDPOINT"

bash "$ROOT_DIR/apps/todo-logs/scripts/setup.sh" >/dev/null

TODO_LOGS_PORT=3004 node "$ROOT_DIR/apps/todo-logs/api/server.mjs" >"$SERVER_LOG" 2>&1 &
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

curl -fsS -X POST \
  -H "Content-Type: application/json" \
  --data '{"title":"Smoke Todo"}' \
  "$APP_URL/api/todos" >"$TMP_DIR/create.json"

TODO_ID="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!data.id){process.exit(1)} process.stdout.write(data.id)' "$TMP_DIR/create.json")"

curl -fsS -X POST "$APP_URL/api/todos/$TODO_ID/toggle" >"$TMP_DIR/toggle.json"
curl -fsS "$APP_URL/api/todos" >"$TMP_DIR/list.json"
curl -fsS "$APP_URL/api/logs" >"$TMP_DIR/logs.json"

node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!Array.isArray(data.items)||!data.items.find((item)=>item.id===process.argv[2]&&item.completed===true)){process.exit(1)}' "$TMP_DIR/list.json" "$TODO_ID"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!Array.isArray(data.items)||data.items.length<2){process.exit(1)} if(!data.items.find((item)=>String(item.message).includes(process.argv[2]))){process.exit(1)}' "$TMP_DIR/logs.json" "$TODO_ID"

AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
AWS_DEFAULT_REGION="$REGION" \
aws --profile "$PROFILE" --endpoint-url "$ENDPOINT" dynamodb describe-table --table-name "$TABLE" >/dev/null

AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
AWS_DEFAULT_REGION="$REGION" \
aws --profile "$PROFILE" --endpoint-url "$ENDPOINT" logs get-log-events --log-group-name "$LOG_GROUP" --log-stream-name "$LOG_STREAM" >/dev/null

echo "todo-logs smoke check passed."
