#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT_DIR/ops/floci-env.sh"

ENDPOINT="$AWS_ENDPOINT"
PROFILE="$AWS_PROFILE"
REGION="$AWS_DEFAULT_REGION"
ACCESS_KEY="$AWS_ACCESS_KEY_ID"
SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
POOL_NAME="${AUTH_PORTAL_POOL_NAME:-auth-portal-users}"
CLIENT_NAME="${AUTH_PORTAL_CLIENT_NAME:-auth-portal-web}"
RUNTIME_DIR="$ROOT_DIR/apps/auth-portal/.runtime"
RUNTIME_FILE="$RUNTIME_DIR/cognito.json"
USER_POOL_ID=""
CLIENT_ID=""

run_aws() {
  AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
  AWS_DEFAULT_REGION="$REGION" \
  aws --profile "$PROFILE" --endpoint-url "$ENDPOINT" "$@"
}

mkdir -p "$RUNTIME_DIR"

bash "$ROOT_DIR/ops/create-aws-profile.sh" >/dev/null
bash "$ROOT_DIR/ops/verify-floci.sh" >/dev/null

if [ -f "$RUNTIME_FILE" ]; then
  USER_POOL_ID="$(node -e 'const fs=require("fs"); const file=process.argv[1]; const data=JSON.parse(fs.readFileSync(file,"utf8")); process.stdout.write(data.userPoolId || "")' "$RUNTIME_FILE")"
  CLIENT_ID="$(node -e 'const fs=require("fs"); const file=process.argv[1]; const data=JSON.parse(fs.readFileSync(file,"utf8")); process.stdout.write(data.clientId || "")' "$RUNTIME_FILE")"
fi

if [ -n "$USER_POOL_ID" ] && ! run_aws cognito-idp describe-user-pool --user-pool-id "$USER_POOL_ID" >/dev/null 2>&1; then
  USER_POOL_ID=""
  CLIENT_ID=""
fi

if [ -z "$USER_POOL_ID" ]; then
  USER_POOL_ID="$(run_aws cognito-idp create-user-pool --pool-name "$POOL_NAME" --output text --query 'UserPool.Id')"
fi

if [ -n "$CLIENT_ID" ] && ! run_aws cognito-idp describe-user-pool-client --user-pool-id "$USER_POOL_ID" --client-id "$CLIENT_ID" >/dev/null 2>&1; then
  CLIENT_ID=""
fi

if [ -z "$CLIENT_ID" ]; then
  CLIENT_ID="$(run_aws cognito-idp create-user-pool-client \
    --user-pool-id "$USER_POOL_ID" \
    --client-name "$CLIENT_NAME" \
    --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_SRP_AUTH \
    --no-generate-secret \
    --output text \
    --query 'UserPoolClient.ClientId')"
fi

node -e 'const fs=require("fs"); const file=process.argv[1]; const payload={userPoolId: process.argv[2], clientId: process.argv[3], endpoint: process.argv[4], profile: process.argv[5], region: process.argv[6]}; fs.writeFileSync(file, JSON.stringify(payload, null, 2));' "$RUNTIME_FILE" "$USER_POOL_ID" "$CLIENT_ID" "$ENDPOINT" "$PROFILE" "$REGION"

echo "auth-portal resources are ready."
echo "endpoint: $ENDPOINT"
echo "userPoolId: $USER_POOL_ID"
echo "clientId: $CLIENT_ID"
