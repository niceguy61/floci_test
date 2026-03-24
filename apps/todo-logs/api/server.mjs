import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "../web");
const repoRoot = path.resolve(__dirname, "../../..");
const awsLocalDir = path.join(repoRoot, ".aws-local");

const port = Number(process.env.TODO_LOGS_PORT ?? 3004);
const endpoint = process.env.AWS_ENDPOINT ?? "http://localhost:4566";
const profile = process.env.AWS_PROFILE ?? "floci";
const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "test";
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "test";
const table = process.env.TODO_LOGS_TABLE_NAME ?? "todos";
const logGroup = process.env.TODO_LOGS_LOG_GROUP ?? "/floci/todo-logs";
const logStream = process.env.TODO_LOGS_LOG_STREAM ?? "todo-api";

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

function decodeItem(item) {
  return {
    id: item.id?.S ?? "",
    title: item.title?.S ?? "",
    completed: item.completed?.BOOL ?? false,
    createdAt: item.createdAt?.S ?? "",
    updatedAt: item.updatedAt?.S ?? ""
  };
}

async function listTodos() {
  const data = await runAwsJson(["dynamodb", "scan", "--table-name", table]);
  return (data.Items ?? []).map(decodeItem).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function getTodo(id) {
  const data = await runAwsJson([
    "dynamodb",
    "get-item",
    "--table-name",
    table,
    "--key",
    JSON.stringify({ id: { S: id } })
  ]);
  return data.Item ? decodeItem(data.Item) : null;
}

async function getSequenceToken() {
  const data = await runAwsJson([
    "logs",
    "describe-log-streams",
    "--log-group-name",
    logGroup,
    "--log-stream-name-prefix",
    logStream
  ]);

  const stream = (data.logStreams ?? []).find((item) => item.logStreamName === logStream);
  return stream?.uploadSequenceToken ?? null;
}

async function putLog(message) {
  const token = await getSequenceToken();
  const args = [
    "logs",
    "put-log-events",
    "--log-group-name",
    logGroup,
    "--log-stream-name",
    logStream,
    "--log-events",
    JSON.stringify([{ timestamp: Date.now(), message }])
  ];
  if (token) {
    args.push("--sequence-token", token);
  }
  await runAws(args);
}

async function createTodo(payload) {
  const title = String(payload.title ?? "").trim();
  if (!title) {
    throw new Error("invalid_payload");
  }

  const todo = {
    id: randomUUID(),
    title,
    completed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await runAws([
    "dynamodb",
    "put-item",
    "--table-name",
    table,
    "--item",
    JSON.stringify({
      id: { S: todo.id },
      title: { S: todo.title },
      completed: { BOOL: todo.completed },
      createdAt: { S: todo.createdAt },
      updatedAt: { S: todo.updatedAt }
    })
  ]);

  await putLog(`[TODO_CREATED] id=${todo.id} title=${todo.title}`);
  return todo;
}

async function toggleTodo(id) {
  const current = await getTodo(id);
  if (!current) {
    return null;
  }

  const updated = {
    ...current,
    completed: !current.completed,
    updatedAt: new Date().toISOString()
  };

  await runAws([
    "dynamodb",
    "put-item",
    "--table-name",
    table,
    "--item",
    JSON.stringify({
      id: { S: updated.id },
      title: { S: updated.title },
      completed: { BOOL: updated.completed },
      createdAt: { S: updated.createdAt },
      updatedAt: { S: updated.updatedAt }
    })
  ]);

  await putLog(`[TODO_TOGGLED] id=${updated.id} completed=${updated.completed}`);
  return updated;
}

async function listLogs() {
  const data = await runAwsJson([
    "logs",
    "get-log-events",
    "--log-group-name",
    logGroup,
    "--log-stream-name",
    logStream
  ]);

  return (data.events ?? []).map((event) => ({
    timestamp: event.timestamp,
    message: event.message
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
      json(res, 200, {
        status: "ok",
        endpoint,
        profile,
        table,
        logGroup,
        logStream
      });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/todos") {
      json(res, 200, { items: await listTodos() });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/todos") {
      json(res, 201, await createTodo(await readJsonBody(req)));
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/logs") {
      json(res, 200, { items: await listLogs() });
      return;
    }

    const match = requestUrl.pathname.match(/^\/api\/todos\/([^/]+)\/toggle$/);
    if (req.method === "POST" && match) {
      const item = await toggleTodo(match[1]);
      if (!item) {
        json(res, 404, { error: "not_found" });
        return;
      }
      json(res, 200, item);
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    json(res, message === "invalid_payload" ? 400 : 500, { error: message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`todo-logs server listening on http://127.0.0.1:${port}`);
  console.log(`floci endpoint: ${endpoint}`);
});
