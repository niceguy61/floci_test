import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

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
  return {
    id: item.id?.S ?? "",
    title: item.title?.S ?? "",
    description: item.description?.S ?? "",
    filename: item.filename?.S ?? "",
    contentType: item.contentType?.S ?? "application/octet-stream",
    s3Key: item.s3Key?.S ?? "",
    uploadedAt: item.uploadedAt?.S ?? "",
    imageUrl: `/api/images/${item.id?.S ?? ""}/file`
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
  const id = randomUUID();
  const safeName = String(payload.filename ?? "upload.bin").replace(/[^a-zA-Z0-9._-]/g, "-");
  const contentType = String(payload.contentType ?? "application/octet-stream");
  const title = String(payload.title ?? "").trim();
  const description = String(payload.description ?? "").trim();
  const dataBase64 = String(payload.dataBase64 ?? "");

  if (!title || !safeName || !dataBase64) {
    throw new Error("invalid_payload");
  }

  const uploadedAt = new Date().toISOString();
  const s3Key = `${id}-${safeName}`;
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "image-gallery-"));
  const filePath = path.join(tmpDir, safeName);

  try {
    await writeFile(filePath, Buffer.from(dataBase64, "base64"));

    await runAws([
      "s3",
      "cp",
      filePath,
      `s3://${bucket}/${s3Key}`,
      "--content-type",
      contentType
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
        contentType: { S: contentType },
        s3Key: { S: s3Key },
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
    contentType,
    s3Key,
    uploadedAt,
    imageUrl: `/api/images/${id}/file`
  };
}

async function sendStaticIndex(res) {
  const html = await readFile(path.join(webRoot, "index.html"), "utf8");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

async function sendImageFile(res, image) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "image-gallery-download-"));
  const outputPath = path.join(tmpDir, image.filename || `${image.id}.bin`);

  try {
    await runAws([
      "s3api",
      "get-object",
      "--bucket",
      bucket,
      "--key",
      image.s3Key,
      outputPath
    ]);

    await stat(outputPath);

    res.writeHead(200, {
      "Content-Type": image.contentType,
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
      await sendImageFile(res, image);
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
