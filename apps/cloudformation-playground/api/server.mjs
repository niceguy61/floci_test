import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { createObservability } from "../../_shared/observability.mjs";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "../web");
const repoRoot = path.resolve(__dirname, "../../..");
const awsLocalDir = path.join(repoRoot, ".aws-local");

const port = Number(process.env.CLOUDFORMATION_PLAYGROUND_PORT ?? 3010);
const endpoint = process.env.AWS_ENDPOINT ?? "http://localhost:4566";
const profile = process.env.AWS_PROFILE ?? "floci";
const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "test";
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "test";
const host = process.env.CLOUDFORMATION_PLAYGROUND_HOST ?? "0.0.0.0";
const observability = createObservability({
  appName: "cloudformation-playground",
  logFile: path.resolve(__dirname, "../.runtime/cloudformation-playground.log")
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
  // CloudFormation 호출이 항상 로컬 floci endpoint를 보도록 감싼다.
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

async function listStacks() {
  const data = await runAwsJson(["cloudformation", "list-stacks"]);
  return (data.StackSummaries ?? []).map((item) => ({
    stackName: item.StackName,
    stackStatus: item.StackStatus,
    stackId: item.StackId
  }));
}

async function getStack(name) {
  const data = await runAwsJson(["cloudformation", "describe-stacks", "--stack-name", name]);
  const stack = data.Stacks?.[0];
  return {
    stackName: stack?.StackName ?? name,
    stackStatus: stack?.StackStatus ?? "UNKNOWN",
    stackId: stack?.StackId ?? ""
  };
}

async function createStack(payload) {
  // 사용자가 스택 동작에 집중하도록 가장 작은 템플릿을 즉석에서 만든다.
  const stackName = String(payload.stackName ?? "").trim();
  const bucketName = String(payload.bucketName ?? "").trim();
  if (!stackName || !bucketName) {
    throw new Error("invalid_payload");
  }

  const template = `AWSTemplateFormatVersion: "2010-09-09"\nResources:\n  DemoBucket:\n    Type: AWS::S3::Bucket\n    Properties:\n      BucketName: ${bucketName}\n`;
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "floci-cfn-"));
  const templatePath = path.join(tmpDir, "template.yaml");

  try {
    await writeFile(templatePath, template, "utf8");
    await runAws([
      "cloudformation",
      "create-stack",
      "--stack-name",
      stackName,
      "--template-body",
      `file://${templatePath}`
    ]);
    observability.incrementDomainEvent("stack", "create");
    observability.logEvent("info", "stack_created", { stackName, bucketName });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  return {
    stackName,
    bucketName
  };
}

async function sendIndex(res) {
  const html = await readFile(path.join(webRoot, "index.html"), "utf8");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function normalizedRoute(method, pathname) {
  if (method === "GET" && pathname === observability.metricsPath) return observability.metricsPath;
  if (method === "GET" && pathname === "/api/stacks") return "/api/stacks";
  if (method === "POST" && pathname === "/api/stacks") return "/api/stacks";
  if (/^\/api\/stacks\/[^/]+$/.test(pathname)) return "/api/stacks/:name";
  return pathname;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const route = normalizedRoute(req.method ?? "GET", requestUrl.pathname);
  const started = process.hrtime.bigint();
  let statusCode = 500;
  try {
    // IaC 데모를 쉽게 실행할 수 있게 정적 UI와 stack API를 한 서버에 둔다.

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
      json(res, 200, observability.healthFields({ status: "ok", endpoint, profile }));
      statusCode = 200;
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/stacks") {
      json(res, 200, { items: await listStacks() });
      statusCode = 200;
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/stacks") {
      json(res, 201, await createStack(await readJsonBody(req)));
      statusCode = 201;
      return;
    }

    const match = requestUrl.pathname.match(/^\/api\/stacks\/([^/]+)$/);
    if (req.method === "GET" && match) {
      json(res, 200, await getStack(decodeURIComponent(match[1])));
      statusCode = 200;
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
  console.log(`cloudformation-playground server listening on http://127.0.0.1:${port}`);
  console.log(`floci endpoint: ${endpoint}`);
  observability.logEvent("info", "server_started", { port, endpoint, metricsPath: observability.metricsPath, logFile: observability.logFile });
});
