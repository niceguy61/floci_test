#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/ops/floci-env.sh"

AWS_DIR="$(dirname "$AWS_CONFIG_FILE")"
CONFIG_FILE="$AWS_CONFIG_FILE"
CREDENTIALS_FILE="$AWS_SHARED_CREDENTIALS_FILE"
PROFILE_NAME="${AWS_PROFILE_NAME:-$AWS_PROFILE}"
REGION="$AWS_DEFAULT_REGION"
ACCESS_KEY="$AWS_ACCESS_KEY_ID"
SECRET_KEY="$AWS_SECRET_ACCESS_KEY"

mkdir -p "$AWS_DIR"
touch "$CONFIG_FILE" "$CREDENTIALS_FILE"

cat >"$CONFIG_FILE" <<EOF
[profile ${PROFILE_NAME}]
region = ${REGION}
output = json
EOF

cat >"$CREDENTIALS_FILE" <<EOF
[${PROFILE_NAME}]
aws_access_key_id = ${ACCESS_KEY}
aws_secret_access_key = ${SECRET_KEY}
EOF

echo "AWS profile '${PROFILE_NAME}' is ready in $AWS_DIR."
