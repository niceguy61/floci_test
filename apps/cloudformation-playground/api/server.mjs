import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";

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

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (req.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html")) {
      await sendIndex(res);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      json(res, 200, { status: "ok", endpoint, profile });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/stacks") {
      json(res, 200, { items: await listStacks() });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/stacks") {
      json(res, 201, await createStack(await readJsonBody(req)));
      return;
    }

    const match = requestUrl.pathname.match(/^\/api\/stacks\/([^/]+)$/);
    if (req.method === "GET" && match) {
      json(res, 200, await getStack(decodeURIComponent(match[1])));
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    json(res, message === "invalid_payload" ? 400 : 500, { error: message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`cloudformation-playground server listening on http://127.0.0.1:${port}`);
  console.log(`floci endpoint: ${endpoint}`);
});
