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

const port = Number(process.env.ORDER_PROCESSING_PORT ?? 3002);
const endpoint = process.env.AWS_ENDPOINT ?? "http://localhost:4566";
const profile = process.env.AWS_PROFILE ?? "floci";
const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "test";
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "test";
const orderQueue = process.env.ORDER_QUEUE_NAME ?? "order-processing-queue";
const eventQueue = process.env.EVENT_QUEUE_NAME ?? "order-processing-events";
const table = process.env.ORDER_TABLE_NAME ?? "orders";

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

function decodeItem(item) {
  return {
    id: item.id?.S ?? "",
    customerName: item.customerName?.S ?? "",
    itemName: item.itemName?.S ?? "",
    quantity: Number(item.quantity?.N ?? "0"),
    status: item.status?.S ?? "",
    createdAt: item.createdAt?.S ?? "",
    updatedAt: item.updatedAt?.S ?? ""
  };
}

async function listOrders() {
  const data = await runAwsJson(["dynamodb", "scan", "--table-name", table]);
  return (data.Items ?? []).map(decodeItem).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function getOrder(id) {
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

async function createOrder(payload) {
  const customerName = String(payload.customerName ?? "").trim();
  const itemName = String(payload.itemName ?? "").trim();
  const quantity = Number(payload.quantity ?? 1);

  if (!customerName || !itemName || Number.isNaN(quantity) || quantity < 1) {
    throw new Error("invalid_payload");
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();

  await runAws([
    "dynamodb",
    "put-item",
    "--table-name",
    table,
    "--item",
    JSON.stringify({
      id: { S: id },
      customerName: { S: customerName },
      itemName: { S: itemName },
      quantity: { N: String(quantity) },
      status: { S: "PENDING" },
      createdAt: { S: createdAt },
      updatedAt: { S: createdAt }
    })
  ]);

  const queueUrl = (
    await runAwsJson(["sqs", "get-queue-url", "--queue-name", orderQueue])
  ).QueueUrl;

  await runAws([
    "sqs",
    "send-message",
    "--queue-url",
    queueUrl,
    "--message-body",
    JSON.stringify({ orderId: id })
  ]);

  return {
    id,
    customerName,
    itemName,
    quantity,
    status: "PENDING",
    createdAt,
    updatedAt: createdAt
  };
}

async function listEvents() {
  const queueUrl = (
    await runAwsJson(["sqs", "get-queue-url", "--queue-name", eventQueue])
  ).QueueUrl;

  const data = await runAwsJson([
    "sqs",
    "receive-message",
    "--queue-url",
    queueUrl,
    "--max-number-of-messages",
    "10",
    "--visibility-timeout",
    "0",
    "--wait-time-seconds",
    "0"
  ]);

  return (data.Messages ?? []).map((message) => {
    let payload = message.Body ?? "";
    try {
      const body = JSON.parse(message.Body ?? "{}");
      payload = body.Message ?? message.Body ?? "";
    } catch {
      payload = message.Body ?? "";
    }

    return {
      messageId: message.MessageId,
      message: payload
    };
  });
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
        orderQueue,
        eventQueue,
        table
      });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/orders") {
      json(res, 200, { items: await listOrders() });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/orders") {
      json(res, 201, await createOrder(await readJsonBody(req)));
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/events") {
      json(res, 200, { items: await listEvents() });
      return;
    }

    const match = requestUrl.pathname.match(/^\/api\/orders\/([^/]+)$/);
    if (req.method === "GET" && match) {
      const order = await getOrder(match[1]);
      if (!order) {
        json(res, 404, { error: "not_found" });
        return;
      }
      json(res, 200, order);
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    json(res, message === "invalid_payload" ? 400 : 500, { error: message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`order-processing server listening on http://127.0.0.1:${port}`);
  console.log(`floci endpoint: ${endpoint}`);
});
