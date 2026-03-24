#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT_DIR/ops/floci-env.sh"

ENDPOINT="$AWS_ENDPOINT"
PROFILE="$AWS_PROFILE"
REGION="$AWS_DEFAULT_REGION"
ACCESS_KEY="$AWS_ACCESS_KEY_ID"
SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
BUCKET="${FILE_PIPELINE_BUCKET:-file-pipeline-bucket}"
QUEUE="${FILE_PIPELINE_QUEUE:-file-pipeline-queue}"
TABLE="${FILE_PIPELINE_TABLE:-file_pipeline_jobs}"
APP_URL="${FILE_PIPELINE_APP_URL:-http://127.0.0.1:3006}"
TMP_DIR="$(mktemp -d)"
API_LOG="$TMP_DIR/file-pipeline-api.log"
WORKER_LOG="$TMP_DIR/file-pipeline-worker.log"
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

trap cleanup EXIT

run_aws() {
  AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
  AWS_DEFAULT_REGION="$REGION" \
  aws --profile "$PROFILE" --endpoint-url "$ENDPOINT" "$@"
}

echo "Running file-pipeline smoke check against $ENDPOINT"

bash "$ROOT_DIR/apps/file-pipeline/scripts/setup.sh" >/dev/null

FILE_PIPELINE_WORKER_POLL_MS=500 node "$ROOT_DIR/apps/file-pipeline/worker/worker.mjs" >"$WORKER_LOG" 2>&1 &
WORKER_PID=$!

FILE_PIPELINE_PORT=3006 node "$ROOT_DIR/apps/file-pipeline/api/server.mjs" >"$API_LOG" 2>&1 &
API_PID=$!

for _ in $(seq 1 20); do
  if curl -fsS "$APP_URL/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "$APP_URL/" >/dev/null

DATA_BASE64="$(printf 'hello from smoke pipeline\n' | base64 -w0)"
cat >"$TMP_DIR/upload.json" <<EOF
{
  "filename": "smoke.txt",
  "contentType": "text/plain",
  "description": "Smoke pipeline file",
  "dataBase64": "$DATA_BASE64"
}
EOF

curl -fsS -X POST \
  -H "Content-Type: application/json" \
  --data @"$TMP_DIR/upload.json" \
  "$APP_URL/api/files" >"$TMP_DIR/create.json"

JOB_ID="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!data.id){process.exit(1)} process.stdout.write(data.id)' "$TMP_DIR/create.json")"

STATUS=""
for _ in $(seq 1 20); do
  curl -fsS "$APP_URL/api/files" >"$TMP_DIR/list.json"
  STATUS="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const item=(data.items||[]).find((entry)=>entry.id===process.argv[2]); if(!item){process.exit(1)} process.stdout.write(item.status)' "$TMP_DIR/list.json" "$JOB_ID")"
  if [ "$STATUS" = "COMPLETED" ]; then
    break
  fi
  sleep 1
done

test "$STATUS" = "COMPLETED"

node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const item=(data.items||[]).find((entry)=>entry.id===process.argv[2]); if(!item || Number(item.processedBytes)<=0){process.exit(1)}' "$TMP_DIR/list.json" "$JOB_ID"

run_aws s3api head-bucket --bucket "$BUCKET" >/dev/null
run_aws sqs get-queue-url --queue-name "$QUEUE" >/dev/null
run_aws dynamodb describe-table --table-name "$TABLE" >/dev/null

echo "file-pipeline smoke check passed."
