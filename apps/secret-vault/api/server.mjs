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
const runtimeFile = path.resolve(__dirname, "../.runtime/secret-vault.json");

const port = Number(process.env.SECRET_VAULT_PORT ?? 3007);
const endpoint = process.env.AWS_ENDPOINT ?? "http://localhost:4566";
const profile = process.env.AWS_PROFILE ?? "floci";
const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "test";
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "test";

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
  // 비밀과 KMS 호출은 절대로 실제 AWS를 치지 않도록 로컬 profile만 사용한다.
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

async function readRuntime() {
  return JSON.parse(await readFile(runtimeFile, "utf8"));
}

async function listSecrets() {
  // 목록에서는 값을 숨기고, 상세 조회에서만 실제 secret 값을 보여준다.
  const data = await runAwsJson(["secretsmanager", "list-secrets"]);
  return (data.SecretList ?? []).map((item) => ({
    name: item.Name,
    description: item.Description ?? "",
    arn: item.ARN,
    masked: "********"
  }));
}

async function getSecret(name) {
  const meta = await runAwsJson(["secretsmanager", "describe-secret", "--secret-id", name]);
  const value = await runAwsJson(["secretsmanager", "get-secret-value", "--secret-id", name]);
  return {
    name: meta.Name,
    description: meta.Description ?? "",
    arn: meta.ARN,
    value: value.SecretString ?? ""
  };
}

async function createSecret(payload) {
  // 공통 데모 KMS 키를 참조해 Secrets Manager에 비밀을 저장한다.
  const runtime = await readRuntime();
  const name = String(payload.name ?? "").trim();
  const description = String(payload.description ?? "").trim();
  const value = String(payload.value ?? "").trim();

  if (!name || !value) {
    throw new Error("invalid_payload");
  }

  await runAws([
    "secretsmanager",
    "create-secret",
    "--name",
    name,
    "--description",
    description,
    "--secret-string",
    value,
    "--kms-key-id",
    runtime.keyAlias
  ]);

  return {
    name,
    description,
    masked: "********"
  };
}

async function sendIndex(res) {
  const html = await readFile(path.join(webRoot, "index.html"), "utf8");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  try {
    const runtime = await readRuntime();
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
    // 저장/목록/상세 조회 흐름을 한눈에 보이게 하려고 UI와 API를 함께 제공한다.

    if (req.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html")) {
      await sendIndex(res);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      json(res, 200, {
        status: "ok",
        endpoint,
        profile,
        keyAlias: runtime.keyAlias,
        keyArn: runtime.keyArn
      });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/secrets") {
      json(res, 200, { items: await listSecrets() });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/secrets") {
      json(res, 201, await createSecret(await readJsonBody(req)));
      return;
    }

    const match = requestUrl.pathname.match(/^\/api\/secrets\/([^/]+)$/);
    if (req.method === "GET" && match) {
      json(res, 200, await getSecret(decodeURIComponent(match[1])));
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    json(res, message === "invalid_payload" ? 400 : 500, { error: message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`secret-vault server listening on http://127.0.0.1:${port}`);
  console.log(`floci endpoint: ${endpoint}`);
});
