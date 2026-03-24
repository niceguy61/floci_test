import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const awsLocalDir = path.join(repoRoot, ".aws-local");

const endpoint = process.env.AWS_ENDPOINT ?? "http://localhost:4566";
const profile = process.env.AWS_PROFILE ?? "floci";
const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "test";
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "test";
const orderQueue = process.env.ORDER_QUEUE_NAME ?? "order-processing-queue";
const topicName = process.env.ORDER_TOPIC_NAME ?? "order-processing-topic";
const table = process.env.ORDER_TABLE_NAME ?? "orders";
const pollMs = Number(process.env.ORDER_PROCESSING_WORKER_POLL_MS ?? 1500);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function getQueueUrl() {
  const data = await runAwsJson(["sqs", "get-queue-url", "--queue-name", orderQueue]);
  return data.QueueUrl;
}

async function getTopicArn() {
  const data = await runAwsJson(["sns", "create-topic", "--name", topicName]);
  return data.TopicArn;
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

  if (!data.Item) {
    return null;
  }

  return {
    id: data.Item.id?.S ?? "",
    customerName: data.Item.customerName?.S ?? "",
    itemName: data.Item.itemName?.S ?? "",
    quantity: Number(data.Item.quantity?.N ?? "0"),
    status: data.Item.status?.S ?? "",
    createdAt: data.Item.createdAt?.S ?? "",
    updatedAt: data.Item.updatedAt?.S ?? ""
  };
}

async function updateOrder(order, status) {
  const updatedAt = new Date().toISOString();
  await runAws([
    "dynamodb",
    "put-item",
    "--table-name",
    table,
    "--item",
    JSON.stringify({
      id: { S: order.id },
      customerName: { S: order.customerName },
      itemName: { S: order.itemName },
      quantity: { N: String(order.quantity) },
      status: { S: status },
      createdAt: { S: order.createdAt },
      updatedAt: { S: updatedAt }
    })
  ]);

  return { ...order, status, updatedAt };
}

async function publishStatus(order, topicArn, status) {
  await runAws([
    "sns",
    "publish",
    "--topic-arn",
    topicArn,
    "--message",
    JSON.stringify({
      orderId: order.id,
      customerName: order.customerName,
      itemName: order.itemName,
      quantity: order.quantity,
      status
    })
  ]);
}

async function processOne(queueUrl, topicArn) {
  const data = await runAwsJson([
    "sqs",
    "receive-message",
    "--queue-url",
    queueUrl,
    "--max-number-of-messages",
    "1",
    "--visibility-timeout",
    "10",
    "--wait-time-seconds",
    "1"
  ]);

  const message = data.Messages?.[0];
  if (!message) {
    return false;
  }

  const receiptHandle = message.ReceiptHandle;
  const body = JSON.parse(message.Body ?? "{}");
  const orderId = body.orderId;
  const order = await getOrder(orderId);

  if (!order) {
    await runAws(["sqs", "delete-message", "--queue-url", queueUrl, "--receipt-handle", receiptHandle]);
    return true;
  }

  const processingOrder = await updateOrder(order, "PROCESSING");
  await publishStatus(processingOrder, topicArn, "PROCESSING");
  await sleep(400);
  const completedOrder = await updateOrder(processingOrder, "COMPLETED");
  await publishStatus(completedOrder, topicArn, "COMPLETED");
  await runAws(["sqs", "delete-message", "--queue-url", queueUrl, "--receipt-handle", receiptHandle]);
  return true;
}

async function main() {
  const queueUrl = await getQueueUrl();
  const topicArn = await getTopicArn();

  console.log(`order-processing worker started`);
  console.log(`queue: ${queueUrl}`);
  console.log(`topic: ${topicArn}`);

  while (true) {
    try {
      await processOne(queueUrl, topicArn);
    } catch (error) {
      console.error("worker_error", error);
    }
    await sleep(pollMs);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
