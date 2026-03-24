#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="${AWS_ENDPOINT:-http://localhost:4566}"
PROFILE="${AWS_PROFILE:-floci}"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
ACCESS_KEY="${AWS_ACCESS_KEY_ID:-test}"
SECRET_KEY="${AWS_SECRET_ACCESS_KEY:-test}"

echo "Verifying floci endpoint: $ENDPOINT"

AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
AWS_DEFAULT_REGION="$REGION" \
aws --profile "$PROFILE" --endpoint-url "$ENDPOINT" sts get-caller-identity >/dev/null

echo "Base floci verification passed."
# TODO: add app-specific resource checks here.
