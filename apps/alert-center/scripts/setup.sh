#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT_DIR/ops/floci-env.sh"

ENDPOINT="$AWS_ENDPOINT"
PROFILE="$AWS_PROFILE"
REGION="$AWS_DEFAULT_REGION"
ACCESS_KEY="$AWS_ACCESS_KEY_ID"
SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
TOPIC_NAME="${ALERT_CENTER_TOPIC_NAME:-alert-center-topic}"
QUEUE_A="${ALERT_CENTER_QUEUE_A:-alert-center-subscriber-a}"
QUEUE_B="${ALERT_CENTER_QUEUE_B:-alert-center-subscriber-b}"

run_aws() {
  AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
  AWS_DEFAULT_REGION="$REGION" \
  aws --profile "$PROFILE" --endpoint-url "$ENDPOINT" "$@"
}

set_queue_policy() {
  local queue_url="$1"
  local queue_arn="$2"
  local topic_arn="$3"
  local policy_file attr_file

  policy_file="$(mktemp)"
  attr_file="$(mktemp)"

  cat >"$policy_file" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAlertTopicPublish",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "SQS:SendMessage",
      "Resource": "$queue_arn",
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "$topic_arn"
        }
      }
    }
  ]
}
EOF

  node -e 'const fs=require("fs"); const policy=JSON.stringify(JSON.parse(fs.readFileSync(process.argv[1],"utf8"))); fs.writeFileSync(process.argv[2], JSON.stringify({Policy: policy}));' "$policy_file" "$attr_file"
  run_aws sqs set-queue-attributes --queue-url "$queue_url" --attributes "file://$attr_file" >/dev/null
  rm -f "$policy_file" "$attr_file"
}

bash "$ROOT_DIR/ops/create-aws-profile.sh" >/dev/null
bash "$ROOT_DIR/ops/verify-floci.sh" >/dev/null

TOPIC_ARN="$(run_aws sns create-topic --name "$TOPIC_NAME" --output text --query 'TopicArn')"
QUEUE_A_URL="$(run_aws sqs create-queue --queue-name "$QUEUE_A" --output text --query 'QueueUrl')"
QUEUE_B_URL="$(run_aws sqs create-queue --queue-name "$QUEUE_B" --output text --query 'QueueUrl')"

QUEUE_A_ARN="$(run_aws sqs get-queue-attributes --queue-url "$QUEUE_A_URL" --attribute-names QueueArn --output text --query 'Attributes.QueueArn')"
QUEUE_B_ARN="$(run_aws sqs get-queue-attributes --queue-url "$QUEUE_B_URL" --attribute-names QueueArn --output text --query 'Attributes.QueueArn')"

set_queue_policy "$QUEUE_A_URL" "$QUEUE_A_ARN" "$TOPIC_ARN"
set_queue_policy "$QUEUE_B_URL" "$QUEUE_B_ARN" "$TOPIC_ARN"

SUB_A="$(run_aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" --output text --query "Subscriptions[?Endpoint=='$QUEUE_A_ARN'].SubscriptionArn | [0]")"
if [ "$SUB_A" = "None" ] || [ -z "$SUB_A" ]; then
  run_aws sns subscribe --topic-arn "$TOPIC_ARN" --protocol sqs --notification-endpoint "$QUEUE_A_ARN" >/dev/null
fi

SUB_B="$(run_aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" --output text --query "Subscriptions[?Endpoint=='$QUEUE_B_ARN'].SubscriptionArn | [0]")"
if [ "$SUB_B" = "None" ] || [ -z "$SUB_B" ]; then
  run_aws sns subscribe --topic-arn "$TOPIC_ARN" --protocol sqs --notification-endpoint "$QUEUE_B_ARN" >/dev/null
fi

echo "alert-center resources are ready."
echo "endpoint: $ENDPOINT"
echo "topic arn: $TOPIC_ARN"
echo "subscriber A: $QUEUE_A_URL"
echo "subscriber B: $QUEUE_B_URL"
