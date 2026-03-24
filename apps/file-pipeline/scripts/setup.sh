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

run_aws() {
  AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
  AWS_DEFAULT_REGION="$REGION" \
  aws --profile "$PROFILE" --endpoint-url "$ENDPOINT" "$@"
}

bash "$ROOT_DIR/ops/create-aws-profile.sh" >/dev/null
bash "$ROOT_DIR/ops/verify-floci.sh" >/dev/null

if ! run_aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  run_aws s3 mb "s3://$BUCKET" >/dev/null
fi

run_aws sqs create-queue --queue-name "$QUEUE" >/dev/null

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

echo "file-pipeline resources are ready."
echo "endpoint: $ENDPOINT"
echo "bucket: $BUCKET"
echo "queue: $QUEUE"
echo "table: $TABLE"
