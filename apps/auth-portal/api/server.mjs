import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readAuthRuntime } from "../auth/runtime.mjs";

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

  return {
    accessToken: data.AuthenticationResult?.AccessToken ?? "",
    idToken: data.AuthenticationResult?.IdToken ?? "",
    refreshToken: data.AuthenticationResult?.RefreshToken ?? ""
  };
}

async function profileFromToken(token) {
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
  try {
    const runtime = await readAuthRuntime();
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (req.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html")) {
      await sendIndex(res);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      json(res, 200, {
        status: "ok",
        endpoint,
        profile,
        userPoolId: runtime.userPoolId,
        clientId: runtime.clientId
      });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/signup") {
      json(res, 201, await signup(await readJsonBody(req)));
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/confirm") {
      json(res, 200, await confirmUser(await readJsonBody(req)));
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/login") {
      json(res, 200, await login(await readJsonBody(req)));
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/profile") {
      const authHeader = req.headers.authorization ?? "";
      const [, token] = authHeader.split(" ");
      if (!token) {
        json(res, 401, { error: "missing_token" });
        return;
      }
      json(res, 200, await profileFromToken(token));
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    json(res, message === "invalid_payload" ? 400 : 500, { error: message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`auth-portal server listening on http://127.0.0.1:${port}`);
  console.log(`floci endpoint: ${endpoint}`);
});
