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

run_aws() {
  AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
  AWS_DEFAULT_REGION="$REGION" \
  aws --profile "$PROFILE" --endpoint-url "$ENDPOINT" "$@"
}

bash "$ROOT_DIR/ops/create-aws-profile.sh" >/dev/null
bash "$ROOT_DIR/ops/verify-floci.sh" >/dev/null

if ! run_aws kinesis describe-stream --stream-name "$STREAM" >/dev/null 2>&1; then
  run_aws kinesis create-stream --stream-name "$STREAM" --shard-count 1 >/dev/null
fi

for _ in $(seq 1 20); do
  STATUS="$(run_aws kinesis describe-stream --stream-name "$STREAM" --query 'StreamDescription.StreamStatus' --output text 2>/dev/null || true)"
  if [ "$STATUS" = "ACTIVE" ]; then
    break
  fi
  sleep 1
done

echo "stream-inspector resources are ready."
echo "endpoint: $ENDPOINT"
echo "stream: $STREAM"
