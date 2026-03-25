#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT_DIR/ops/floci-env.sh"

ENDPOINT="$AWS_ENDPOINT"
PROFILE="$AWS_PROFILE"
REGION="$AWS_DEFAULT_REGION"
ACCESS_KEY="$AWS_ACCESS_KEY_ID"
SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
RDS_ID="${PRODUCT_CATALOG_CACHE_DB_INSTANCE_ID:-product-catalog-db}"
CACHE_ID="${PRODUCT_CATALOG_CACHE_REPLICATION_GROUP_ID:-product-catalog-cache}"
DB_USER="${PRODUCT_CATALOG_CACHE_DB_USER:-catalog}"
DB_PASSWORD="${PRODUCT_CATALOG_CACHE_DB_PASSWORD:-catalog123}"
DB_NAME="${PRODUCT_CATALOG_CACHE_DB_NAME:-postgres}"
RUNTIME_DIR="$ROOT_DIR/apps/product-catalog-cache/.runtime"
RUNTIME_FILE="$RUNTIME_DIR/product-catalog-cache.json"

run_aws() {
  AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
  AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
  AWS_DEFAULT_REGION="$REGION" \
  aws --profile "$PROFILE" --endpoint-url "$ENDPOINT" "$@"
}

has_rds_instance() {
  [ "$(run_aws rds describe-db-instances --db-instance-identifier "$RDS_ID" --query 'length(DBInstances)' --output text 2>/dev/null || echo 0)" != "0" ]
}

has_cache_group() {
  [ "$(run_aws elasticache describe-replication-groups --replication-group-id "$CACHE_ID" --query 'length(ReplicationGroups)' --output text 2>/dev/null || echo 0)" != "0" ]
}

mkdir -p "$RUNTIME_DIR"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for product-catalog-cache." >&2
  echo "Install postgresql-client (Ubuntu) or libpq/Postgres.app tools (macOS)." >&2
  exit 1
fi

bash "$ROOT_DIR/ops/create-aws-profile.sh" >/dev/null
bash "$ROOT_DIR/ops/verify-floci.sh" >/dev/null

if ! has_rds_instance; then
  run_aws rds create-db-instance \
    --db-instance-identifier "$RDS_ID" \
    --db-instance-class db.t3.micro \
    --engine postgres \
    --master-username "$DB_USER" \
    --master-user-password "$DB_PASSWORD" >/dev/null
fi

if ! has_cache_group; then
  run_aws elasticache create-replication-group \
    --replication-group-id "$CACHE_ID" \
    --replication-group-description "Product catalog cache" >/dev/null
fi

RDS_HOST=""
RDS_PORT=""

for _ in $(seq 1 40); do
  RDS_HOST="$(run_aws rds describe-db-instances --db-instance-identifier "$RDS_ID" --query 'DBInstances[0].Endpoint.Address' --output text 2>/dev/null || true)"
  RDS_PORT="$(run_aws rds describe-db-instances --db-instance-identifier "$RDS_ID" --query 'DBInstances[0].Endpoint.Port' --output text 2>/dev/null || true)"
  if [ -n "$RDS_HOST" ] && [ "$RDS_HOST" != "None" ] && [ -n "$RDS_PORT" ] && [ "$RDS_PORT" != "None" ]; then
    break
  fi
  sleep 1
done

if [ -z "$RDS_HOST" ] || [ "$RDS_HOST" = "None" ] || [ -z "$RDS_PORT" ] || [ "$RDS_PORT" = "None" ]; then
  echo "RDS endpoint is not ready for $RDS_ID" >&2
  exit 1
fi

CACHE_HOST=""
CACHE_PORT=""

for _ in $(seq 1 40); do
  CACHE_HOST="$(run_aws elasticache describe-replication-groups --replication-group-id "$CACHE_ID" --query 'ReplicationGroups[0].ConfigurationEndpoint.Address' --output text 2>/dev/null || true)"
  CACHE_PORT="$(run_aws elasticache describe-replication-groups --replication-group-id "$CACHE_ID" --query 'ReplicationGroups[0].ConfigurationEndpoint.Port' --output text 2>/dev/null || true)"
  if [ -n "$CACHE_HOST" ] && [ "$CACHE_HOST" != "None" ] && [ -n "$CACHE_PORT" ] && [ "$CACHE_PORT" != "None" ]; then
    break
  fi
  sleep 1
done

if [ -z "$CACHE_HOST" ] || [ "$CACHE_HOST" = "None" ] || [ -z "$CACHE_PORT" ] || [ "$CACHE_PORT" = "None" ]; then
  echo "ElastiCache endpoint is not ready for $CACHE_ID" >&2
  exit 1
fi

for _ in $(seq 1 40); do
  if PGPASSWORD="$DB_PASSWORD" psql -h "$RDS_HOST" -p "$RDS_PORT" -U "$DB_USER" -d "$DB_NAME" -Atqc "select 1" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! PGPASSWORD="$DB_PASSWORD" psql -h "$RDS_HOST" -p "$RDS_PORT" -U "$DB_USER" -d "$DB_NAME" -Atqc "select 1" >/dev/null 2>&1; then
  echo "RDS data plane is not reachable for $RDS_ID" >&2
  exit 1
fi

PGPASSWORD="$DB_PASSWORD" psql -h "$RDS_HOST" -p "$RDS_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS products (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO products (sku, name, description, price_cents)
VALUES
  ('sku-hoodie', 'Cache Hoodie', 'RDS 원본에서 읽고 ElastiCache에 저장하는 대표 상품', 59000),
  ('sku-mug', 'Ops Mug', '관측성과 운영 메모를 함께 적기 좋은 데모 머그컵', 17000),
  ('sku-keyboard', 'Focus Keyboard', '반복 조회가 많은 상품 검색 예제를 위한 샘플 아이템', 129000)
ON CONFLICT (sku) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_cents = EXCLUDED.price_cents,
  updated_at = now();
SQL

if exec 3<>"/dev/tcp/$CACHE_HOST/$CACHE_PORT"; then
  printf '*1\r\n$7\r\nFLUSHDB\r\n' >&3
  timeout 2 cat <&3 >/dev/null 2>&1 || true
  exec 3<&-
  exec 3>&-
fi

node -e 'const fs=require("fs"); const file=process.argv[1]; const payload={endpoint: process.argv[2], profile: process.argv[3], region: process.argv[4], rds: {identifier: process.argv[5], host: process.argv[6], port: Number(process.argv[7]), username: process.argv[8], password: process.argv[9], database: process.argv[10]}, cache: {identifier: process.argv[11], host: process.argv[12], port: Number(process.argv[13])}}; fs.writeFileSync(file, JSON.stringify(payload, null, 2));' \
  "$RUNTIME_FILE" \
  "$ENDPOINT" \
  "$PROFILE" \
  "$REGION" \
  "$RDS_ID" \
  "$RDS_HOST" \
  "$RDS_PORT" \
  "$DB_USER" \
  "$DB_PASSWORD" \
  "$DB_NAME" \
  "$CACHE_ID" \
  "$CACHE_HOST" \
  "$CACHE_PORT"

echo "product-catalog-cache resources are ready."
echo "rds: $RDS_ID ($RDS_HOST:$RDS_PORT)"
echo "elasticache: $CACHE_ID ($CACHE_HOST:$CACHE_PORT)"
