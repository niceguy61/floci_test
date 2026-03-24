#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT_DIR/ops/floci-env.sh"

ENDPOINT="$AWS_ENDPOINT"
PROFILE="$AWS_PROFILE"
REGION="$AWS_DEFAULT_REGION"
ACCESS_KEY="$AWS_ACCESS_KEY_ID"
SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
APP_URL="${CLOUDFORMATION_PLAYGROUND_APP_URL:-http://127.0.0.1:3010}"
TMP_DIR="$(mktemp -d)"
SERVER_LOG="$TMP_DIR/cloudformation-playground.log"
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

echo "Running cloudformation-playground smoke check against $ENDPOINT"

bash "$ROOT_DIR/apps/cloudformation-playground/scripts/setup.sh" >/dev/null

CLOUDFORMATION_PLAYGROUND_PORT=3010 node "$ROOT_DIR/apps/cloudformation-playground/api/server.mjs" >"$SERVER_LOG" 2>&1 &
PID=$!

for _ in $(seq 1 20); do
  if curl -fsS "$APP_URL/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "$APP_URL/" >/dev/null

STACK_NAME="smoke-cfn-$(date +%s)"
BUCKET_NAME="smoke-cfn-bucket-$(date +%s)"

curl -fsS -X POST \
  -H "Content-Type: application/json" \
  --data "{\"stackName\":\"$STACK_NAME\",\"bucketName\":\"$BUCKET_NAME\"}" \
  "$APP_URL/api/stacks" >"$TMP_DIR/create.json"

STATUS=""
for _ in $(seq 1 20); do
  curl -fsS "$APP_URL/api/stacks/$STACK_NAME" >"$TMP_DIR/detail.json"
  STATUS="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.stackStatus || "")' "$TMP_DIR/detail.json")"
  if [ "$STATUS" = "CREATE_COMPLETE" ]; then
    break
  fi
  sleep 1
done

test "$STATUS" = "CREATE_COMPLETE"

curl -fsS "$APP_URL/api/stacks" >"$TMP_DIR/list.json"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!Array.isArray(data.items)||!data.items.find((item)=>item.stackName===process.argv[2])){process.exit(1)}' "$TMP_DIR/list.json" "$STACK_NAME"

run_aws s3api head-bucket --bucket "$BUCKET_NAME" >/dev/null

echo "cloudformation-playground smoke check passed."
