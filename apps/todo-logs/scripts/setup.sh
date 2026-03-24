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

run_aws() {
  AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
  AWS_DEFAULT_REGION="$REGION" \
  aws --profile "$PROFILE" --endpoint-url "$ENDPOINT" "$@"
}

bash "$ROOT_DIR/ops/create-aws-profile.sh" >/dev/null
bash "$ROOT_DIR/ops/verify-floci.sh" >/dev/null

if ! run_aws dynamodb describe-table --table-name "$TABLE" >/dev/null 2>&1; then
  run_aws dynamodb create-table \
    --table-name "$TABLE" \
    --attribute-definitions AttributeName=id,AttributeType=S \
    --key-schema AttributeName=id,KeyType=HASH \
    --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 >/dev/null 2>&1 || true
fi

for _ in $(seq 1 20); do
  if run_aws dynamodb describe-table --table-name "$TABLE" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

run_aws logs create-log-group --log-group-name "$LOG_GROUP" >/dev/null 2>&1 || true
run_aws logs create-log-stream --log-group-name "$LOG_GROUP" --log-stream-name "$LOG_STREAM" >/dev/null 2>&1 || true

echo "todo-logs resources are ready."
echo "endpoint: $ENDPOINT"
echo "table: $TABLE"
echo "log group: $LOG_GROUP"
echo "log stream: $LOG_STREAM"
