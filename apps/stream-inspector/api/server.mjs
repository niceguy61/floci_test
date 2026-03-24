import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

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

  return {
    partitionKey,
    sequenceNumber: result.SequenceNumber,
    shardId: result.ShardId
  };
}

async function listRecords() {
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

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (req.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html")) {
      await sendIndex(res);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      json(res, 200, { status: "ok", endpoint, profile, stream });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/stream") {
      json(res, 200, await getStreamInfo());
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/records") {
      json(res, 200, { items: await listRecords() });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/records") {
      json(res, 201, await publishRecord(await readJsonBody(req)));
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    json(res, message === "invalid_payload" ? 400 : 500, { error: message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`stream-inspector server listening on http://127.0.0.1:${port}`);
  console.log(`floci endpoint: ${endpoint}`);
});
