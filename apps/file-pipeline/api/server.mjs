import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "../web");
const repoRoot = path.resolve(__dirname, "../../..");
const awsLocalDir = path.join(repoRoot, ".aws-local");

const port = Number(process.env.FILE_PIPELINE_PORT ?? 3006);
const endpoint = process.env.AWS_ENDPOINT ?? "http://localhost:4566";
const profile = process.env.AWS_PROFILE ?? "floci";
const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "test";
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "test";
const bucket = process.env.FILE_PIPELINE_BUCKET ?? "file-pipeline-bucket";
const queue = process.env.FILE_PIPELINE_QUEUE ?? "file-pipeline-queue";
const table = process.env.FILE_PIPELINE_TABLE ?? "file_pipeline_jobs";

function json(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function runAws(args) {
  // 하나의 요청 흐름 안에서 S3, SQS, DynamoDB가 모두 같은 로컬 설정을 쓰게 한다.
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
    AWS_DEFAULT_REGION: region,
    AWS_CONFIG_FILE: process.env.AWS_CONFIG_FILE ?? path.join(awsLocalDir, "config"),
    AWS_SHARED_CREDENTIALS_FILE:
      process.env.AWS_SHARED_CREDENTIALS_FILE ?? path.join(awsLocalDir, "credentials")
  };
  const finalArgs = ["--profile", profile, "--endpoint-url", endpoint, ...args];
  return execFileAsync("aws", finalArgs, { env, maxBuffer: 20 * 1024 * 1024 });
}

async function runAwsJson(args) {
  const { stdout } = await runAws(args);
  return stdout ? JSON.parse(stdout) : {};
}

function decodeItem(item) {
  return {
    id: item.id?.S ?? "",
    filename: item.filename?.S ?? "",
    description: item.description?.S ?? "",
    contentType: item.contentType?.S ?? "",
    s3Key: item.s3Key?.S ?? "",
    status: item.status?.S ?? "",
    processedBytes: Number(item.processedBytes?.N ?? "0"),
    createdAt: item.createdAt?.S ?? "",
    updatedAt: item.updatedAt?.S ?? ""
  };
}

async function getQueueUrl() {
  const data = await runAwsJson(["sqs", "get-queue-url", "--queue-name", queue]);
  return data.QueueUrl;
}

async function listFiles() {
  const data = await runAwsJson(["dynamodb", "scan", "--table-name", table]);
  return (data.Items ?? []).map(decodeItem).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function uploadFile(payload) {
  // API는 파일 저장, 메타데이터 기록, 백그라운드 처리 enqueue까지만 담당한다.
  const filename = String(payload.filename ?? "").trim();
  const description = String(payload.description ?? "").trim();
  const contentType = String(payload.contentType ?? "application/octet-stream");
  const dataBase64 = String(payload.dataBase64 ?? "");

  if (!filename || !dataBase64) {
    throw new Error("invalid_payload");
  }

  const id = randomUUID();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
  const s3Key = `${id}-${safeName}`;
  const now = new Date().toISOString();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "file-pipeline-"));
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
        filename: { S: safeName },
        description: { S: description },
        contentType: { S: contentType },
        s3Key: { S: s3Key },
        status: { S: "QUEUED" },
        processedBytes: { N: "0" },
        createdAt: { S: now },
        updatedAt: { S: now }
      })
    ]);

    const queueUrl = await getQueueUrl();
    await runAws([
      "sqs",
      "send-message",
      "--queue-url",
      queueUrl,
      "--message-body",
      JSON.stringify({ jobId: id })
    ]);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  return {
    id,
    filename: safeName,
    description,
    contentType,
    s3Key,
    status: "QUEUED",
    processedBytes: 0,
    createdAt: now,
    updatedAt: now
  };
}

async function sendIndex(res) {
  const html = await readFile(path.join(webRoot, "index.html"), "utf8");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
    // 파일 처리 흐름을 따라가기 쉽게 UI와 API를 한 서버에서 제공한다.

    if (req.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html")) {
      await sendIndex(res);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      json(res, 200, { status: "ok", endpoint, profile, bucket, queue, table });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/files") {
      json(res, 200, { items: await listFiles() });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/files") {
      json(res, 201, await uploadFile(await readJsonBody(req)));
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    json(res, message === "invalid_payload" ? 400 : 500, { error: message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`file-pipeline server listening on http://127.0.0.1:${port}`);
  console.log(`floci endpoint: ${endpoint}`);
});
