#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT_DIR/ops/floci-env.sh"

ENDPOINT="$AWS_ENDPOINT"
PROFILE="$AWS_PROFILE"
REGION="$AWS_DEFAULT_REGION"
ACCESS_KEY="$AWS_ACCESS_KEY_ID"
SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
APP_URL="${SECRET_VAULT_APP_URL:-http://127.0.0.1:3007}"
TMP_DIR="$(mktemp -d)"
SERVER_LOG="$TMP_DIR/secret-vault.log"
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

echo "Running secret-vault smoke check against $ENDPOINT"

bash "$ROOT_DIR/apps/secret-vault/scripts/setup.sh" >/dev/null

SECRET_VAULT_PORT=3007 node "$ROOT_DIR/apps/secret-vault/api/server.mjs" >"$SERVER_LOG" 2>&1 &
PID=$!

for _ in $(seq 1 20); do
  if curl -fsS "$APP_URL/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "$APP_URL/" >/dev/null
curl -fsS "$APP_URL/api/health" >"$TMP_DIR/health.json"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.status!=="ok" || !data.keyAlias){process.exit(1)}' "$TMP_DIR/health.json"

SECRET_NAME="smoke-secret-$(date +%s)"

curl -fsS -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$SECRET_NAME\",\"description\":\"Smoke secret\",\"value\":\"super-secret-value\"}" \
  "$APP_URL/api/secrets" >"$TMP_DIR/create.json"

curl -fsS "$APP_URL/api/secrets" >"$TMP_DIR/list.json"
curl -fsS "$APP_URL/api/secrets/$SECRET_NAME" >"$TMP_DIR/detail.json"

node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!Array.isArray(data.items)||!data.items.find((item)=>item.name===process.argv[2])){process.exit(1)}' "$TMP_DIR/list.json" "$SECRET_NAME"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.name!==process.argv[2]||data.value!=="super-secret-value"){process.exit(1)}' "$TMP_DIR/detail.json" "$SECRET_NAME"

run_aws kms list-keys >/dev/null
run_aws secretsmanager describe-secret --secret-id "$SECRET_NAME" >/dev/null

echo "secret-vault smoke check passed."
