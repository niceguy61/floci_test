#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT_DIR/ops/floci-env.sh"

ENDPOINT="$AWS_ENDPOINT"
PROFILE="$AWS_PROFILE"
REGION="$AWS_DEFAULT_REGION"
ACCESS_KEY="$AWS_ACCESS_KEY_ID"
SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
PREFIX="${FEATURE_FLAGS_PREFIX:-/app/flags}"
APP_URL="${FEATURE_FLAGS_APP_URL:-http://127.0.0.1:3008}"
TMP_DIR="$(mktemp -d)"
SERVER_LOG="$TMP_DIR/feature-flags.log"
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

echo "Running feature-flags smoke check against $ENDPOINT"

bash "$ROOT_DIR/apps/feature-flags/scripts/setup.sh" >/dev/null

FEATURE_FLAGS_PORT=3008 node "$ROOT_DIR/apps/feature-flags/api/server.mjs" >"$SERVER_LOG" 2>&1 &
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
  --data '{"name":"beta-banner","value":"enabled"}' \
  "$APP_URL/api/flags" >"$TMP_DIR/create.json"

curl -fsS "$APP_URL/api/flags" >"$TMP_DIR/list.json"
curl -fsS "$APP_URL/api/flags/beta-banner" >"$TMP_DIR/detail.json"

node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!Array.isArray(data.items)||!data.items.find((item)=>item.name==="beta-banner"&&item.value==="enabled")){process.exit(1)}' "$TMP_DIR/list.json"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.name!=="beta-banner"||data.value!=="enabled"){process.exit(1)}' "$TMP_DIR/detail.json"

run_aws ssm get-parameter --name "$PREFIX/beta-banner" >/dev/null

echo "feature-flags smoke check passed."
