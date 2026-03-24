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

const port = Number(process.env.FEATURE_FLAGS_PORT ?? 3008);
const endpoint = process.env.AWS_ENDPOINT ?? "http://localhost:4566";
const profile = process.env.AWS_PROFILE ?? "floci";
const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "test";
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "test";
const prefix = process.env.FEATURE_FLAGS_PREFIX ?? "/app/flags";

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

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
    // 작은 대시보드와 Parameter Store API를 한 프로세스에서 제공해 이해를 단순화한다.

    if (req.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html")) {
      await sendIndex(res);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      json(res, 200, {
        status: "ok",
        endpoint,
        profile,
        prefix
      });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/flags") {
      json(res, 200, { items: await listFlags() });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/flags") {
      json(res, 201, await putFlag(await readJsonBody(req)));
      return;
    }

    const match = requestUrl.pathname.match(/^\/api\/flags\/([^/]+)$/);
    if (req.method === "GET" && match) {
      json(res, 200, await getFlag(decodeURIComponent(match[1])));
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    json(res, message === "invalid_payload" ? 400 : 500, { error: message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`feature-flags server listening on http://127.0.0.1:${port}`);
  console.log(`floci endpoint: ${endpoint}`);
});
