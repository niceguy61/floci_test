#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$ROOT_DIR/ops/floci-env.sh"

ENDPOINT="$AWS_ENDPOINT"
PROFILE="$AWS_PROFILE"
REGION="$AWS_DEFAULT_REGION"
ACCESS_KEY="$AWS_ACCESS_KEY_ID"
SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
BUCKET="${IMAGE_GALLERY_BUCKET:-image-gallery-bucket}"
TABLE="${IMAGE_GALLERY_TABLE:-image_metadata}"
APP_URL="${IMAGE_GALLERY_APP_URL:-http://127.0.0.1:3001}"
TMP_DIR="$(mktemp -d)"
SERVER_LOG="$TMP_DIR/image-gallery-server.log"
PID=""

cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" >/dev/null 2>&1; then
    kill "$PID" >/dev/null 2>&1 || true
    wait "$PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

echo "Running image-gallery smoke check against $ENDPOINT"

bash "$ROOT_DIR/ops/create-aws-profile.sh" >/dev/null
bash "$ROOT_DIR/ops/verify-floci.sh" >/dev/null
bash "$ROOT_DIR/apps/image-gallery/scripts/setup.sh" >/dev/null

AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
AWS_DEFAULT_REGION="$REGION" \
aws --profile "$PROFILE" --endpoint-url "$ENDPOINT" s3api head-bucket --bucket "$BUCKET" >/dev/null

AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
AWS_DEFAULT_REGION="$REGION" \
aws --profile "$PROFILE" --endpoint-url "$ENDPOINT" dynamodb describe-table --table-name "$TABLE" >/dev/null

IMAGE_GALLERY_PORT=3001 node "$ROOT_DIR/apps/image-gallery/api/server.mjs" >"$SERVER_LOG" 2>&1 &
PID=$!

for _ in $(seq 1 20); do
  if curl -fsS "$APP_URL/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "$APP_URL/" >/dev/null
curl -fsS "$APP_URL/api/health" >"$TMP_DIR/health.json"

node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(data.status!=="ok"){process.exit(1)}' "$TMP_DIR/health.json"

node - <<'NODE' "$TMP_DIR"
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const sharp = require("sharp");

const tmpDir = process.argv[2];
const width = 1200;
const height = 1200;
const channels = 3;
const raw = crypto.randomBytes(width * height * channels);
const outPath = path.join(tmpDir, "large.png");

sharp(raw, { raw: { width, height, channels } })
  .png()
  .toFile(outPath)
  .then(() => {
    const buffer = fs.readFileSync(outPath);
    const payload = {
      title: "Smoke Test Large Image",
      description: "Uploaded by smoke.sh",
      filename: "smoke-large.png",
      contentType: "image/png",
      dataBase64: buffer.toString("base64")
    };
    fs.writeFileSync(path.join(tmpDir, "upload.json"), JSON.stringify(payload, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
NODE

curl -fsS -X POST \
  -H "Content-Type: application/json" \
  --data @"$TMP_DIR/upload.json" \
  "$APP_URL/api/images" >"$TMP_DIR/upload-response.json"

IMAGE_ID="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!data.id){process.exit(1)} process.stdout.write(data.id)' "$TMP_DIR/upload-response.json")"

curl -fsS "$APP_URL/api/images" >"$TMP_DIR/list.json"
curl -fsS "$APP_URL/api/images/$IMAGE_ID" >"$TMP_DIR/detail.json"
curl -fsS "$APP_URL/api/images/$IMAGE_ID/file" >"$TMP_DIR/file.bin"
curl -fsS "$APP_URL/api/images/$IMAGE_ID/thumbnail" >"$TMP_DIR/thumb.bin"
curl -fsS "$APP_URL/api/images/$IMAGE_ID/original" >"$TMP_DIR/original.bin"

node -e 'const fs=require("fs"); const list=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!Array.isArray(list.items)||!list.items.find((item)=>item.id===process.argv[2])){process.exit(1)}' "$TMP_DIR/list.json" "$IMAGE_ID"
node -e 'const fs=require("fs"); const detail=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(detail.id!==process.argv[2]||detail.title!=="Smoke Test Large Image"||detail.wasResized!==true||!detail.thumbnailUrl||!detail.originalImageUrl){process.exit(1)} if(!(detail.originalBytes>1048576)){process.exit(1)} if(!(detail.displayBytes<detail.originalBytes)){process.exit(1)}' "$TMP_DIR/detail.json" "$IMAGE_ID"

test -s "$TMP_DIR/file.bin"
test -s "$TMP_DIR/thumb.bin"
test -s "$TMP_DIR/original.bin"

echo "image-gallery smoke check passed."
