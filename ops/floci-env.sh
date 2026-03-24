#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AWS_LOCAL_DIR="${AWS_LOCAL_DIR:-$ROOT_DIR/.aws-local}"

export AWS_ENDPOINT="${AWS_ENDPOINT:-http://localhost:4566}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_PROFILE="${AWS_PROFILE:-floci}"
export AWS_CONFIG_FILE="${AWS_CONFIG_FILE:-$AWS_LOCAL_DIR/config}"
export AWS_SHARED_CREDENTIALS_FILE="${AWS_SHARED_CREDENTIALS_FILE:-$AWS_LOCAL_DIR/credentials}"
