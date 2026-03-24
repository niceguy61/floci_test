import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "../web");
const repoRoot = path.resolve(__dirname, "../../..");
const awsLocalDir = path.join(repoRoot, ".aws-local");

const port = Number(process.env.IMAGE_GALLERY_PORT ?? 3001);
const endpoint = process.env.AWS_ENDPOINT ?? "http://localhost:4566";
const profile = process.env.AWS_PROFILE ?? "floci";
const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "test";
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "test";
const bucket = process.env.IMAGE_GALLERY_BUCKET ?? "image-gallery-bucket";
const table = process.env.IMAGE_GALLERY_TABLE ?? "image_metadata";
const maxOriginalBytes = Number(process.env.IMAGE_GALLERY_MAX_BYTES ?? 1024 * 1024);
const resizedMaxWidth = Number(process.env.IMAGE_GALLERY_RESIZED_MAX_WIDTH ?? 1280);
const thumbnailWidth = Number(process.env.IMAGE_GALLERY_THUMBNAIL_WIDTH ?? 320);

function json(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function notFound(res) {
  json(res, 404, { error: "not_found" });
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 15 * 1024 * 1024) {
      throw new Error("payload_too_large");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function runAws(args) {
  // 모든 S3/DynamoDB 명령이 로컬 floci와 격리된 자격증명을 쓰도록 강제한다.
  const finalArgs = ["--profile", profile, "--endpoint-url", endpoint, ...args];
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
    AWS_DEFAULT_REGION: region,
    AWS_CONFIG_FILE:
      process.env.AWS_CONFIG_FILE ?? path.join(awsLocalDir, "config"),
    AWS_SHARED_CREDENTIALS_FILE:
      process.env.AWS_SHARED_CREDENTIALS_FILE ?? path.join(awsLocalDir, "credentials")
  };

  return execFileAsync("aws", finalArgs, {
    env,
    maxBuffer: 20 * 1024 * 1024
  });
}

async function runAwsJson(args) {
  const { stdout } = await runAws(args);
  return stdout ? JSON.parse(stdout) : {};
}

function decodeItem(item) {
  // DynamoDB의 typed JSON을 UI가 바로 쓰기 쉬운 객체 형태로 한 번에 바꾼다.
  return {
    id: item.id?.S ?? "",
    title: item.title?.S ?? "",
    description: item.description?.S ?? "",
    filename: item.filename?.S ?? "",
    contentType: item.contentType?.S ?? "application/octet-stream",
    originalContentType: item.originalContentType?.S ?? item.contentType?.S ?? "application/octet-stream",
    originalS3Key: item.originalS3Key?.S ?? item.s3Key?.S ?? "",
    displayS3Key: item.displayS3Key?.S ?? item.s3Key?.S ?? "",
    thumbnailS3Key: item.thumbnailS3Key?.S ?? "",
    uploadedAt: item.uploadedAt?.S ?? "",
    originalBytes: Number(item.originalBytes?.N ?? "0"),
    displayBytes: Number(item.displayBytes?.N ?? "0"),
    thumbnailBytes: Number(item.thumbnailBytes?.N ?? "0"),
    wasResized: item.wasResized?.BOOL ?? false,
    imageUrl: `/api/images/${item.id?.S ?? ""}/file`,
    thumbnailUrl: `/api/images/${item.id?.S ?? ""}/thumbnail`,
    originalImageUrl: `/api/images/${item.id?.S ?? ""}/original`,
    s3ObjectUrl: `${endpoint}/${bucket}/${item.displayS3Key?.S ?? item.s3Key?.S ?? ""}`,
    s3ThumbnailUrl: item.thumbnailS3Key?.S
      ? `${endpoint}/${bucket}/${item.thumbnailS3Key.S}`
      : ""
  };
}

async function listImages() {
  const data = await runAwsJson([
    "dynamodb",
    "scan",
    "--table-name",
    table
  ]);

  const items = (data.Items ?? []).map(decodeItem).sort((left, right) => {
    return right.uploadedAt.localeCompare(left.uploadedAt);
  });

  return items;
}

async function getImage(id) {
  const data = await runAwsJson([
    "dynamodb",
    "get-item",
    "--table-name",
    table,
    "--key",
    JSON.stringify({ id: { S: id } })
  ]);

  if (!data.Item) {
    return null;
  }

  return decodeItem(data.Item);
}

async function uploadImage(payload) {
  // 원본은 보존하고, 필요하면 표시용 이미지를 줄이고, thumbnail은 항상 만든다.
  const id = randomUUID();
  const safeName = String(payload.filename ?? "upload.bin").replace(/[^a-zA-Z0-9._-]/g, "-");
  const originalContentType = String(payload.contentType ?? "application/octet-stream");
  const title = String(payload.title ?? "").trim();
  const description = String(payload.description ?? "").trim();
  const dataBase64 = String(payload.dataBase64 ?? "");

  if (!title || !safeName || !dataBase64) {
    throw new Error("invalid_payload");
  }

  const uploadedAt = new Date().toISOString();
  const originalS3Key = `${id}-original-${safeName}`;
  const displayS3Key = `${id}-display.webp`;
  const thumbnailS3Key = `${id}-thumbnail.webp`;
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "image-gallery-"));
  const filePath = path.join(tmpDir, safeName);
  const displayPath = path.join(tmpDir, `${id}-display.webp`);
  const thumbnailPath = path.join(tmpDir, `${id}-thumbnail.webp`);
  const originalBuffer = Buffer.from(dataBase64, "base64");
  const originalBytes = originalBuffer.length;
  let displayBytes = 0;
  let thumbnailBytes = 0;

  try {
    await writeFile(filePath, originalBuffer);

    const displaySource =
      originalBytes > maxOriginalBytes
        ? sharp(originalBuffer).rotate().resize({
            width: resizedMaxWidth,
            height: resizedMaxWidth,
            fit: "inside",
            withoutEnlargement: true
          })
        : sharp(originalBuffer).rotate();

    const displayResult = await displaySource
      .webp({ quality: 82 })
      .toFile(displayPath);
    displayBytes = displayResult.size;

    const thumbnailResult = await sharp(originalBuffer)
      .rotate()
      .resize({
        width: thumbnailWidth,
        height: thumbnailWidth,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: 78 })
      .toFile(thumbnailPath);
    thumbnailBytes = thumbnailResult.size;

    await runAws([
      "s3",
      "cp",
      filePath,
      `s3://${bucket}/${originalS3Key}`,
      "--content-type",
      originalContentType
    ]);

    await runAws([
      "s3",
      "cp",
      displayPath,
      `s3://${bucket}/${displayS3Key}`,
      "--content-type",
      "image/webp"
    ]);

    await runAws([
      "s3",
      "cp",
      thumbnailPath,
      `s3://${bucket}/${thumbnailS3Key}`,
      "--content-type",
      "image/webp"
    ]);

    await runAws([
      "dynamodb",
      "put-item",
      "--table-name",
      table,
      "--item",
      JSON.stringify({
        id: { S: id },
        title: { S: title },
        description: { S: description },
        filename: { S: safeName },
        contentType: { S: "image/webp" },
        originalContentType: { S: originalContentType },
        originalS3Key: { S: originalS3Key },
        displayS3Key: { S: displayS3Key },
        thumbnailS3Key: { S: thumbnailS3Key },
        originalBytes: { N: String(originalBytes) },
        displayBytes: { N: String(displayBytes) },
        thumbnailBytes: { N: String(thumbnailBytes) },
        wasResized: { BOOL: originalBytes > maxOriginalBytes },
        uploadedAt: { S: uploadedAt }
      })
    ]);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  return {
    id,
    title,
    description,
    filename: safeName,
    contentType: "image/webp",
    originalContentType,
    originalS3Key,
    displayS3Key,
    thumbnailS3Key,
    uploadedAt,
    originalBytes,
    displayBytes,
    thumbnailBytes,
    wasResized: originalBytes > maxOriginalBytes,
    imageUrl: `/api/images/${id}/file`,
    thumbnailUrl: `/api/images/${id}/thumbnail`,
    originalImageUrl: `/api/images/${id}/original`,
    s3ObjectUrl: `${endpoint}/${bucket}/${displayS3Key}`,
    s3ThumbnailUrl: `${endpoint}/${bucket}/${thumbnailS3Key}`
  };
}

async function sendStaticIndex(res) {
  const html = await readFile(path.join(webRoot, "index.html"), "utf8");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

async function sendS3Object(res, key, contentType, filename) {
  // bucket 공개/CORS 설정 없이 hands-on을 진행할 수 있게 앱 서버가 S3 객체를 프록시한다.
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "image-gallery-download-"));
  const outputPath = path.join(tmpDir, filename);

  try {
    await runAws([
      "s3api",
      "get-object",
      "--bucket",
      bucket,
      "--key",
      key,
      outputPath
    ]);

    await stat(outputPath);

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });

    const stream = createReadStream(outputPath);
    stream.on("close", async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });
    stream.on("error", async () => {
      await rm(tmpDir, { recursive: true, force: true });
      if (!res.headersSent) {
        json(res, 500, { error: "stream_failed" });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true });
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
    // 갤러리 UI와 이미지 API를 한 프로세스에 두어 흐름을 읽기 쉽게 만든다.

    if (req.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html")) {
      await sendStaticIndex(res);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      json(res, 200, {
        status: "ok",
        endpoint,
        profile,
        bucket,
        table
      });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/images") {
      const items = await listImages();
      json(res, 200, { items });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/images") {
      const payload = await readJsonBody(req);
      const image = await uploadImage(payload);
      json(res, 201, image);
      return;
    }

    const detailMatch = requestUrl.pathname.match(/^\/api\/images\/([^/]+)$/);
    if (req.method === "GET" && detailMatch) {
      const image = await getImage(detailMatch[1]);
      if (!image) {
        notFound(res);
        return;
      }
      json(res, 200, image);
      return;
    }

    const fileMatch = requestUrl.pathname.match(/^\/api\/images\/([^/]+)\/file$/);
    if (req.method === "GET" && fileMatch) {
      const image = await getImage(fileMatch[1]);
      if (!image) {
        notFound(res);
        return;
      }
      await sendS3Object(
        res,
        image.displayS3Key,
        image.contentType,
        `${image.id}-display.webp`
      );
      return;
    }

    const originalMatch = requestUrl.pathname.match(/^\/api\/images\/([^/]+)\/original$/);
    if (req.method === "GET" && originalMatch) {
      const image = await getImage(originalMatch[1]);
      if (!image) {
        notFound(res);
        return;
      }
      await sendS3Object(
        res,
        image.originalS3Key,
        image.originalContentType,
        image.filename || `${image.id}-original.bin`
      );
      return;
    }

    const thumbnailMatch = requestUrl.pathname.match(/^\/api\/images\/([^/]+)\/thumbnail$/);
    if (req.method === "GET" && thumbnailMatch) {
      const image = await getImage(thumbnailMatch[1]);
      if (!image) {
        notFound(res);
        return;
      }
      await sendS3Object(
        res,
        image.thumbnailS3Key,
        "image/webp",
        `${image.id}-thumbnail.webp`
      );
      return;
    }

    notFound(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const statusCode =
      message === "payload_too_large" ? 413 :
      message === "invalid_payload" ? 400 :
      500;
    json(res, statusCode, { error: message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`image-gallery server listening on http://127.0.0.1:${port}`);
  console.log(`floci endpoint: ${endpoint}`);
});
