import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createObservability } from "../../_shared/observability.mjs";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "../web");
const repoRoot = path.resolve(__dirname, "../../..");
const awsLocalDir = path.join(repoRoot, ".aws-local");

const port = Number(process.env.STREAM_INSPECTOR_PORT ?? 3009);
const endpoint = process.env.AWS_ENDPOINT ?? "http://localhost:4566";
const profile = process.env.AWS_PROFILE ?? "floci";
const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "test";
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "test";
const stream = process.env.STREAM_INSPECTOR_STREAM ?? "stream-inspector-stream";
const host = process.env.STREAM_INSPECTOR_HOST ?? "0.0.0.0";
const observability = createObservability({
  appName: "stream-inspector",
  logFile: path.resolve(__dirname, "../.runtime/stream-inspector.log")
});

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
  // 다른 hands-on과 같은 방식으로 Kinesis도 로컬 profile/endpoint를 사용한다.
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

async function getStreamInfo() {
  // stream 상태를 노출해 ACTIVE 상태와 읽기 가능 상태를 연결해서 이해하게 한다.
  const data = await runAwsJson(["kinesis", "describe-stream", "--stream-name", stream]);
  return {
    streamName: data.StreamDescription?.StreamName ?? stream,
    streamStatus: data.StreamDescription?.StreamStatus ?? "UNKNOWN",
    shardCount: data.StreamDescription?.Shards?.length ?? 0
  };
}

async function publishRecord(payload) {
  const partitionKey = String(payload.partitionKey ?? "").trim();
  const data = String(payload.data ?? "").trim();
  if (!partitionKey || !data) {
    throw new Error("invalid_payload");
  }

  const encoded = Buffer.from(data, "utf8").toString("base64");
  const result = await runAwsJson([
    "kinesis",
    "put-record",
    "--stream-name",
    stream,
    "--partition-key",
    partitionKey,
    "--data",
    encoded
  ]);

  observability.incrementDomainEvent("stream", "publish");
  observability.logEvent("info", "stream_record_published", { partitionKey, stream });

  return {
    partitionKey,
    sequenceNumber: result.SequenceNumber,
    shardId: result.ShardId
  };
}

async function listRecords() {
  // 매번 전체 흐름을 보기 쉽게 TRIM_HORIZON부터 읽어 최근 레코드를 보여준다.
  const desc = await runAwsJson(["kinesis", "describe-stream", "--stream-name", stream]);
  const shardId = desc.StreamDescription?.Shards?.[0]?.ShardId;
  if (!shardId) {
    return [];
  }

  const iteratorData = await runAwsJson([
    "kinesis",
    "get-shard-iterator",
    "--stream-name",
    stream,
    "--shard-id",
    shardId,
    "--shard-iterator-type",
    "TRIM_HORIZON"
  ]);

  const recordData = await runAwsJson([
    "kinesis",
    "get-records",
    "--shard-iterator",
    iteratorData.ShardIterator
  ]);

  return (recordData.Records ?? []).map((item) => ({
    partitionKey: item.PartitionKey,
    sequenceNumber: item.SequenceNumber,
    data: Buffer.from(item.Data, "base64").toString("utf8")
  }));
}

async function sendIndex(res) {
  const html = await readFile(path.join(webRoot, "index.html"), "utf8");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function normalizedRoute(method, pathname) {
  if (method === "GET" && pathname === observability.metricsPath) return observability.metricsPath;
  if (method === "GET" && pathname === "/api/stream") return "/api/stream";
  if (method === "GET" && pathname === "/api/records") return "/api/records";
  if (method === "POST" && pathname === "/api/records") return "/api/records";
  return pathname;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const route = normalizedRoute(req.method ?? "GET", requestUrl.pathname);
  const started = process.hrtime.bigint();
  let statusCode = 500;
  try {
    // 생산자/소비자 흐름을 가볍게 실험할 수 있게 정적 페이지와 API를 한 서버에 둔다.

    if (req.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html")) {
      await sendIndex(res);
      statusCode = 200;
      return;
    }

    if (observability.maybeHandleMetrics(req, res, requestUrl.pathname)) {
      statusCode = 200;
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      json(res, 200, observability.healthFields({ status: "ok", endpoint, profile, stream }));
      statusCode = 200;
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/stream") {
      json(res, 200, await getStreamInfo());
      statusCode = 200;
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/records") {
      json(res, 200, { items: await listRecords() });
      statusCode = 200;
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/records") {
      json(res, 201, await publishRecord(await readJsonBody(req)));
      statusCode = 201;
      return;
    }

    json(res, 404, { error: "not_found" });
    statusCode = 404;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    statusCode = message === "invalid_payload" ? 400 : 500;
    observability.logEvent("error", "request_failed", { route, method: req.method ?? "GET", error: message });
    json(res, statusCode, { error: message });
  } finally {
    observability.recordHttp({
      method: req.method ?? "GET",
      route,
      statusCode,
      durationMs: Number(process.hrtime.bigint() - started) / 1_000_000
    });
  }
});

server.listen(port, host, () => {
  console.log(`stream-inspector server listening on http://127.0.0.1:${port}`);
  console.log(`floci endpoint: ${endpoint}`);
  observability.logEvent("info", "server_started", { port, endpoint, metricsPath: observability.metricsPath, logFile: observability.logFile });
});
