#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT_DIR/ops/floci-env.sh"

ENDPOINT="$AWS_ENDPOINT"
PROFILE="$AWS_PROFILE"
REGION="$AWS_DEFAULT_REGION"
ACCESS_KEY="$AWS_ACCESS_KEY_ID"
SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
ORDER_QUEUE="${ORDER_QUEUE_NAME:-order-processing-queue}"
EVENT_QUEUE="${EVENT_QUEUE_NAME:-order-processing-events}"
TOPIC_NAME="${ORDER_TOPIC_NAME:-order-processing-topic}"
TABLE="${ORDER_TABLE_NAME:-orders}"

run_aws() {
  AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
  AWS_DEFAULT_REGION="$REGION" \
  aws --profile "$PROFILE" --endpoint-url "$ENDPOINT" "$@"
}

bash "$ROOT_DIR/ops/create-aws-profile.sh" >/dev/null
bash "$ROOT_DIR/ops/verify-floci.sh" >/dev/null

ORDER_QUEUE_URL="$(run_aws sqs create-queue --queue-name "$ORDER_QUEUE" --output text --query 'QueueUrl')"
EVENT_QUEUE_URL="$(run_aws sqs create-queue --queue-name "$EVENT_QUEUE" --output text --query 'QueueUrl')"
TOPIC_ARN="$(run_aws sns create-topic --name "$TOPIC_NAME" --output text --query 'TopicArn')"
EVENT_QUEUE_ARN="$(run_aws sqs get-queue-attributes --queue-url "$EVENT_QUEUE_URL" --attribute-names QueueArn --output text --query 'Attributes.QueueArn')"

POLICY_FILE="$(mktemp)"
ATTR_FILE="$(mktemp)"
cat >"$POLICY_FILE" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowOrderTopicPublish",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "SQS:SendMessage",
      "Resource": "$EVENT_QUEUE_ARN",
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "$TOPIC_ARN"
        }
      }
    }
  ]
}
EOF

node -e 'const fs=require("fs"); const policy=JSON.stringify(JSON.parse(fs.readFileSync(process.argv[1],"utf8"))); fs.writeFileSync(process.argv[2], JSON.stringify({Policy: policy}));' "$POLICY_FILE" "$ATTR_FILE"
run_aws sqs set-queue-attributes --queue-url "$EVENT_QUEUE_URL" --attributes "file://$ATTR_FILE" >/dev/null
rm -f "$POLICY_FILE" "$ATTR_FILE"

SUB_ARN="$(run_aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" --output text --query "Subscriptions[?Endpoint=='$EVENT_QUEUE_ARN'].SubscriptionArn | [0]")"
if [ "$SUB_ARN" = "None" ] || [ -z "$SUB_ARN" ]; then
  run_aws sns subscribe --topic-arn "$TOPIC_ARN" --protocol sqs --notification-endpoint "$EVENT_QUEUE_ARN" >/dev/null
fi

if ! run_aws dynamodb describe-table --table-name "$TABLE" >/dev/null 2>&1; then
  if ! run_aws dynamodb create-table \
    --table-name "$TABLE" \
    --attribute-definitions AttributeName=id,AttributeType=S \
    --key-schema AttributeName=id,KeyType=HASH \
    --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 >/dev/null 2>&1; then
    run_aws dynamodb describe-table --table-name "$TABLE" >/dev/null
  fi
fi

for _ in $(seq 1 20); do
  if run_aws dynamodb describe-table --table-name "$TABLE" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "order-processing resources are ready."
echo "endpoint: $ENDPOINT"
echo "order queue: $ORDER_QUEUE_URL"
echo "event queue: $EVENT_QUEUE_URL"
echo "topic arn: $TOPIC_ARN"
echo "table: $TABLE"
