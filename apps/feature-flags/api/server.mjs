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

const port = Number(process.env.FEATURE_FLAGS_PORT ?? 3008);
const endpoint = process.env.AWS_ENDPOINT ?? "http://localhost:4566";
const profile = process.env.AWS_PROFILE ?? "floci";
const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "test";
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "test";
const prefix = process.env.FEATURE_FLAGS_PREFIX ?? "/app/flags";
const host = process.env.FEATURE_FLAGS_HOST ?? "0.0.0.0";
const observability = createObservability({
  appName: "feature-flags",
  logFile: path.resolve(__dirname, "../.runtime/feature-flags.log")
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
  // Parameter Store 명령은 모두 격리된 로컬 AWS 설정을 통해 보낸다.
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

async function listFlags() {
  // 한 앱의 플래그만 보이도록 path prefix를 고정한다.
  const data = await runAwsJson([
    "ssm",
    "get-parameters-by-path",
    "--path",
    prefix,
    "--recursive"
  ]);

  return (data.Parameters ?? []).map((item) => ({
    name: item.Name.replace(`${prefix}/`, ""),
    fullName: item.Name,
    value: item.Value,
    type: item.Type
  }));
}

async function getFlag(name) {
  const data = await runAwsJson([
    "ssm",
    "get-parameter",
    "--name",
    `${prefix}/${name}`
  ]);

  return {
    name,
    value: data.Parameter?.Value ?? "",
    type: data.Parameter?.Type ?? "String"
  };
}

async function putFlag(payload) {
  // feature flag는 같은 이름으로 값을 바꾸는 경우가 많아서 overwrite를 허용한다.
  const name = String(payload.name ?? "").trim();
  const value = String(payload.value ?? "").trim();
  if (!name) {
    throw new Error("invalid_payload");
  }

  await runAws([
    "ssm",
    "put-parameter",
    "--name",
    `${prefix}/${name}`,
    "--type",
    "String",
    "--value",
    value,
    "--overwrite"
  ]);

  observability.incrementDomainEvent("feature_flag", "write");
  observability.logEvent("info", "feature_flag_write", {
    name,
    value
  });

  return {
    name,
    value,
    type: "String"
  };
}

async function sendIndex(res) {
  const html = await readFile(path.join(webRoot, "index.html"), "utf8");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function normalizedRoute(method, pathname) {
  if (method === "GET" && pathname === observability.metricsPath) {
    return observability.metricsPath;
  }
  if (method === "GET" && pathname === "/api/flags") {
    return "/api/flags";
  }
  if (method === "POST" && pathname === "/api/flags") {
    return "/api/flags";
  }
  if (/^\/api\/flags\/[^/]+$/.test(pathname)) {
    return "/api/flags/:name";
  }
  return pathname;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const route = normalizedRoute(req.method ?? "GET", requestUrl.pathname);
  const started = process.hrtime.bigint();
  let statusCode = 500;

  try {
    // 작은 대시보드와 Parameter Store API를 한 프로세스에서 제공해 이해를 단순화한다.

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
      json(res, 200, observability.healthFields({ status: "ok", endpoint, profile, prefix }));
      statusCode = 200;
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/flags") {
      json(res, 200, { items: await listFlags() });
      statusCode = 200;
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/flags") {
      json(res, 201, await putFlag(await readJsonBody(req)));
      statusCode = 201;
      return;
    }

    const match = requestUrl.pathname.match(/^\/api\/flags\/([^/]+)$/);
    if (req.method === "GET" && match) {
      json(res, 200, await getFlag(decodeURIComponent(match[1])));
      statusCode = 200;
      return;
    }

    json(res, 404, { error: "not_found" });
    statusCode = 404;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    statusCode = message === "invalid_payload" ? 400 : 500;
    observability.logEvent("error", "request_failed", {
      route,
      method: req.method ?? "GET",
      error: message
    });
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
  console.log(`feature-flags server listening on http://127.0.0.1:${port}`);
  console.log(`floci endpoint: ${endpoint}`);
  observability.logEvent("info", "server_started", {
    port,
    endpoint,
    metricsPath: observability.metricsPath,
    logFile: observability.logFile
  });
});
