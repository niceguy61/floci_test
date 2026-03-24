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

run_aws() {
  AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
  AWS_DEFAULT_REGION="$REGION" \
  aws --profile "$PROFILE" --endpoint-url "$ENDPOINT" "$@"
}

bash "$ROOT_DIR/ops/create-aws-profile.sh" >/dev/null
bash "$ROOT_DIR/ops/verify-floci.sh" >/dev/null

run_aws ssm put-parameter --name "$PREFIX/new-ui" --type String --value "false" --overwrite >/dev/null
run_aws ssm put-parameter --name "$PREFIX/checkout-v2" --type String --value "true" --overwrite >/dev/null
run_aws ssm put-parameter --name "$PREFIX/max-items" --type String --value "20" --overwrite >/dev/null

echo "feature-flags resources are ready."
echo "endpoint: $ENDPOINT"
echo "prefix: $PREFIX"
