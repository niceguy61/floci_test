import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readAuthRuntime } from "../auth/runtime.mjs";
import { createObservability } from "../../_shared/observability.mjs";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "../web");
const repoRoot = path.resolve(__dirname, "../../..");
const awsLocalDir = path.join(repoRoot, ".aws-local");

const port = Number(process.env.AUTH_PORTAL_PORT ?? 3003);
const endpoint = process.env.AWS_ENDPOINT ?? "http://localhost:4566";
const profile = process.env.AWS_PROFILE ?? "floci";
const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "test";
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "test";
const host = process.env.AUTH_PORTAL_HOST ?? "0.0.0.0";
const observability = createObservability({
  appName: "auth-portal",
  logFile: path.resolve(__dirname, "../.runtime/auth-portal.log")
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
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function runAws(args) {
  // 사용자의 실제 AWS 설정이 아니라 로컬 floci profile로만 인증 관련 명령을 보낸다.
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

async function sendIndex(res) {
  const html = await readFile(path.join(webRoot, "index.html"), "utf8");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

async function signup(payload) {
  // hands-on 흐름은 회원가입과 확인 단계를 분리해서 보여준다.
  const runtime = await readAuthRuntime();
  const username = String(payload.username ?? "").trim();
  const password = String(payload.password ?? "").trim();
  const email = String(payload.email ?? "").trim();

  if (!username || !password) {
    throw new Error("invalid_payload");
  }

  const args = [
    "cognito-idp",
    "sign-up",
    "--client-id",
    runtime.clientId,
    "--username",
    username,
    "--password",
    password
  ];

  if (email) {
    args.push("--user-attributes", `Name=email,Value=${email}`);
  }

  const data = await runAwsJson(args);
  observability.incrementDomainEvent("auth", "signup");
  observability.logEvent("info", "signup", { username });
  return {
    username,
    userConfirmed: Boolean(data.UserConfirmed)
  };
}

async function confirmUser(payload) {
  const runtime = await readAuthRuntime();
  const username = String(payload.username ?? "").trim();
  const code = String(payload.code ?? "123456").trim();
  if (!username) {
    throw new Error("invalid_payload");
  }

  await runAws([
    "cognito-idp",
    "confirm-sign-up",
    "--client-id",
    runtime.clientId,
    "--username",
    username,
    "--confirmation-code",
    code
  ]);
  observability.incrementDomainEvent("auth", "confirm");
  observability.logEvent("info", "confirm", { username });

  return { username, confirmed: true, code };
}

async function login(payload) {
  const runtime = await readAuthRuntime();
  const username = String(payload.username ?? "").trim();
  const password = String(payload.password ?? "").trim();

  if (!username || !password) {
    throw new Error("invalid_payload");
  }

  const data = await runAwsJson([
    "cognito-idp",
    "initiate-auth",
    "--client-id",
    runtime.clientId,
    "--auth-flow",
    "USER_PASSWORD_AUTH",
    "--auth-parameters",
    `USERNAME=${username},PASSWORD=${password}`
  ]);
  observability.incrementDomainEvent("auth", "login");
  observability.logEvent("info", "login", { username });

  return {
    accessToken: data.AuthenticationResult?.AccessToken ?? "",
    idToken: data.AuthenticationResult?.IdToken ?? "",
    refreshToken: data.AuthenticationResult?.RefreshToken ?? ""
  };
}

async function profileFromToken(token) {
  // 보호된 API가 access token을 사용하는 방식을 그대로 재현한다.
  const data = await runAwsJson([
    "cognito-idp",
    "get-user",
    "--access-token",
    token
  ]);

  const attributes = Object.fromEntries(
    (data.UserAttributes ?? []).map((attr) => [attr.Name, attr.Value])
  );

  return {
    username: data.Username,
    attributes
  };
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const route = /^\/api\/profile$/.test(requestUrl.pathname) ? "/api/profile" :
    /^\/api\/signup$/.test(requestUrl.pathname) ? "/api/signup" :
    /^\/api\/confirm$/.test(requestUrl.pathname) ? "/api/confirm" :
    /^\/api\/login$/.test(requestUrl.pathname) ? "/api/login" :
    requestUrl.pathname === observability.metricsPath ? observability.metricsPath :
    requestUrl.pathname;
  const started = process.hrtime.bigint();
  let statusCode = 500;
  try {
    const runtime = await readAuthRuntime();
    // 데모를 단순하게 유지하기 위해 UI 제공과 Cognito 호출 프록시를 한 서버가 맡는다.

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
      json(res, 200, observability.healthFields({
        status: "ok",
        endpoint,
        profile,
        userPoolId: runtime.userPoolId,
        clientId: runtime.clientId
      }));
      statusCode = 200;
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/signup") {
      json(res, 201, await signup(await readJsonBody(req)));
      statusCode = 201;
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/confirm") {
      json(res, 200, await confirmUser(await readJsonBody(req)));
      statusCode = 200;
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/login") {
      json(res, 200, await login(await readJsonBody(req)));
      statusCode = 200;
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/profile") {
      const authHeader = req.headers.authorization ?? "";
      const [, token] = authHeader.split(" ");
      if (!token) {
        json(res, 401, { error: "missing_token" });
        statusCode = 401;
        return;
      }
      json(res, 200, await profileFromToken(token));
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
  console.log(`auth-portal server listening on http://127.0.0.1:${port}`);
  console.log(`floci endpoint: ${endpoint}`);
  observability.logEvent("info", "server_started", { port, endpoint, metricsPath: observability.metricsPath, logFile: observability.logFile });
});
