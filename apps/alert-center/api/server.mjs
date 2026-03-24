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

const port = Number(process.env.ALERT_CENTER_PORT ?? 3005);
const endpoint = process.env.AWS_ENDPOINT ?? "http://localhost:4566";
const profile = process.env.AWS_PROFILE ?? "floci";
const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "test";
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "test";
const topicName = process.env.ALERT_CENTER_TOPIC_NAME ?? "alert-center-topic";
const queueA = process.env.ALERT_CENTER_QUEUE_A ?? "alert-center-subscriber-a";
const queueB = process.env.ALERT_CENTER_QUEUE_B ?? "alert-center-subscriber-b";

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
  // 모든 hands-on이 같은 로컬 endpoint/profile을 쓰도록 AWS CLI 호출을 감싼다.
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

async function getTopicArn() {
  const data = await runAwsJson(["sns", "create-topic", "--name", topicName]);
  return data.TopicArn;
}

async function getQueueUrl(name) {
  const data = await runAwsJson(["sqs", "get-queue-url", "--queue-name", name]);
  return data.QueueUrl;
}

async function publishAlert(payload) {
  // 알림은 한 번만 발행하고, 실제 fan-out은 SNS가 두 구독 큐로 나눠서 처리한다.
  const title = String(payload.title ?? "").trim();
  const body = String(payload.body ?? "").trim();
  if (!title || !body) {
    throw new Error("invalid_payload");
  }

  const topicArn = await getTopicArn();
  const message = JSON.stringify({ title, body, publishedAt: new Date().toISOString() });
  const result = await runAwsJson([
    "sns",
    "publish",
    "--topic-arn",
    topicArn,
    "--message",
    message
  ]);

  return {
    messageId: result.MessageId,
    title,
    body
  };
}

async function receiveQueueMessages(queueName) {
  // UI에서 반복 조회할 수 있게 메시지를 삭제하지 않고 조회만 한다.
  const queueUrl = await getQueueUrl(queueName);
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
    try {
      const body = JSON.parse(message.Body ?? "{}");
      const parsed = body.Message ? JSON.parse(body.Message) : body;
      return {
        messageId: message.MessageId,
        message: JSON.stringify(parsed)
      };
    } catch {
      return {
        messageId: message.MessageId,
        message: message.Body ?? ""
      };
    }
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
    // hands-on을 단일 프로세스로 이해할 수 있게 정적 UI와 API를 한 서버에 묶는다.

    if (req.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html")) {
      await sendIndex(res);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      json(res, 200, {
        status: "ok",
        endpoint,
        profile,
        topicName,
        queueA,
        queueB
      });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/topic") {
      json(res, 200, { topicArn: await getTopicArn(), topicName });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/publish") {
      json(res, 201, await publishAlert(await readJsonBody(req)));
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/subscribers") {
      json(res, 200, {
        subscriberA: await receiveQueueMessages(queueA),
        subscriberB: await receiveQueueMessages(queueB)
      });
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    json(res, message === "invalid_payload" ? 400 : 500, { error: message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`alert-center server listening on http://127.0.0.1:${port}`);
  console.log(`floci endpoint: ${endpoint}`);
});
