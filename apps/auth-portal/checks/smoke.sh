#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT_DIR/ops/floci-env.sh"

ENDPOINT="$AWS_ENDPOINT"
PROFILE="$AWS_PROFILE"
APP_URL="${AUTH_PORTAL_APP_URL:-http://127.0.0.1:3003}"
TMP_DIR="$(mktemp -d)"
SERVER_LOG="$TMP_DIR/auth-server.log"
PID=""

cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" >/dev/null 2>&1; then
    kill "$PID" >/dev/null 2>&1 || true
    wait "$PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

echo "Running auth-portal smoke check against $ENDPOINT"

bash "$ROOT_DIR/apps/auth-portal/scripts/setup.sh" >/dev/null

AUTH_PORTAL_PORT=3003 node "$ROOT_DIR/apps/auth-portal/api/server.mjs" >"$SERVER_LOG" 2>&1 &
PID=$!

for _ in $(seq 1 20); do
  if curl -fsS "$APP_URL/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "$APP_URL/" >/dev/null
curl -fsS "$APP_URL/api/health" >"$TMP_DIR/health.json"
node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.status!=="ok" || !data.userPoolId || !data.clientId){process.exit(1)}' "$TMP_DIR/health.json"

USERNAME="smoke-user-$(date +%s)"
PASSWORD="SmokePass123!"
EMAIL="${USERNAME}@example.com"

cat >"$TMP_DIR/signup.json" <<EOF
{
  "username": "$USERNAME",
  "password": "$PASSWORD",
  "email": "$EMAIL"
}
EOF

curl -fsS -X POST \
  -H "Content-Type: application/json" \
  --data @"$TMP_DIR/signup.json" \
  "$APP_URL/api/signup" >"$TMP_DIR/signup-response.json"

curl -fsS -X POST \
  -H "Content-Type: application/json" \
  --data "{\"username\":\"$USERNAME\"}" \
  "$APP_URL/api/confirm" >"$TMP_DIR/confirm-response.json"

curl -fsS -X POST \
  -H "Content-Type: application/json" \
  --data "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" \
  "$APP_URL/api/login" >"$TMP_DIR/login-response.json"

TOKEN="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!data.accessToken){process.exit(1)} process.stdout.write(data.accessToken)' "$TMP_DIR/login-response.json")"

curl -fsS \
  -H "Authorization: Bearer $TOKEN" \
  "$APP_URL/api/profile" >"$TMP_DIR/profile.json"

node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.username!==process.argv[2]){process.exit(1)}' "$TMP_DIR/profile.json" "$USERNAME"

STATUS_CODE="$(curl -s -o /dev/null -w "%{http_code}" "$APP_URL/api/profile")"
test "$STATUS_CODE" = "401"

echo "auth-portal smoke check passed."
