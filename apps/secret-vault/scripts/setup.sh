#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT_DIR/ops/floci-env.sh"

ENDPOINT="$AWS_ENDPOINT"
PROFILE="$AWS_PROFILE"
REGION="$AWS_DEFAULT_REGION"
ACCESS_KEY="$AWS_ACCESS_KEY_ID"
SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
KEY_ALIAS="${SECRET_VAULT_KEY_ALIAS:-alias/secret-vault-key}"
RUNTIME_DIR="$ROOT_DIR/apps/secret-vault/.runtime"
RUNTIME_FILE="$RUNTIME_DIR/secret-vault.json"

run_aws() {
  AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
  AWS_DEFAULT_REGION="$REGION" \
  aws --profile "$PROFILE" --endpoint-url "$ENDPOINT" "$@"
}

mkdir -p "$RUNTIME_DIR"

bash "$ROOT_DIR/ops/create-aws-profile.sh" >/dev/null
bash "$ROOT_DIR/ops/verify-floci.sh" >/dev/null

if ! run_aws kms describe-key --key-id "$KEY_ALIAS" >/dev/null 2>&1; then
  KEY_ID="$(run_aws kms create-key --description "secret-vault key" --output text --query 'KeyMetadata.KeyId')"
  run_aws kms create-alias --alias-name "$KEY_ALIAS" --target-key-id "$KEY_ID" >/dev/null
fi

KEY_ARN="$(run_aws kms describe-key --key-id "$KEY_ALIAS" --output text --query 'KeyMetadata.Arn')"

node -e 'const fs=require("fs"); const file=process.argv[1]; const payload={endpoint: process.argv[2], profile: process.argv[3], region: process.argv[4], keyAlias: process.argv[5], keyArn: process.argv[6]}; fs.writeFileSync(file, JSON.stringify(payload, null, 2));' "$RUNTIME_FILE" "$ENDPOINT" "$PROFILE" "$REGION" "$KEY_ALIAS" "$KEY_ARN"

echo "secret-vault resources are ready."
echo "endpoint: $ENDPOINT"
echo "key alias: $KEY_ALIAS"
echo "key arn: $KEY_ARN"
