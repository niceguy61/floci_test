import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";

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
const bucket = process.env.FILE_PIPELINE_BUCKET ?? "file-pipeline-bucket";
const queue = process.env.FILE_PIPELINE_QUEUE ?? "file-pipeline-queue";
const table = process.env.FILE_PIPELINE_TABLE ?? "file_pipeline_jobs";
const pollMs = Number(process.env.FILE_PIPELINE_WORKER_POLL_MS ?? 1500);

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
  const data = await runAwsJson(["sqs", "get-queue-url", "--queue-name", queue]);
  return data.QueueUrl;
}

function decodeItem(item) {
  return {
    id: item.id?.S ?? "",
    filename: item.filename?.S ?? "",
    description: item.description?.S ?? "",
    contentType: item.contentType?.S ?? "",
    s3Key: item.s3Key?.S ?? "",
    status: item.status?.S ?? "",
    processedBytes: Number(item.processedBytes?.N ?? "0"),
    createdAt: item.createdAt?.S ?? "",
    updatedAt: item.updatedAt?.S ?? ""
  };
}

async function getJob(id) {
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

async function putJob(job) {
  await runAws([
    "dynamodb",
    "put-item",
    "--table-name",
    table,
    "--item",
    JSON.stringify({
      id: { S: job.id },
      filename: { S: job.filename },
      description: { S: job.description },
      contentType: { S: job.contentType },
      s3Key: { S: job.s3Key },
      status: { S: job.status },
      processedBytes: { N: String(job.processedBytes) },
      createdAt: { S: job.createdAt },
      updatedAt: { S: job.updatedAt }
    })
  ]);
}

async function processMessage(queueUrl, message) {
  const body = JSON.parse(message.Body ?? "{}");
  const job = await getJob(body.jobId);
  if (!job) {
    await runAws(["sqs", "delete-message", "--queue-url", queueUrl, "--receipt-handle", message.ReceiptHandle]);
    return;
  }

  const processing = {
    ...job,
    status: "PROCESSING",
    updatedAt: new Date().toISOString()
  };
  await putJob(processing);

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "file-pipeline-download-"));
  const outputPath = path.join(tmpDir, processing.filename || `${processing.id}.bin`);

  try {
    await runAws([
      "s3api",
      "get-object",
      "--bucket",
      bucket,
      "--key",
      processing.s3Key,
      outputPath
    ]);

    const info = await stat(outputPath);

    const completed = {
      ...processing,
      status: "COMPLETED",
      processedBytes: info.size,
      updatedAt: new Date().toISOString()
    };
    await putJob(completed);
    await runAws(["sqs", "delete-message", "--queue-url", queueUrl, "--receipt-handle", message.ReceiptHandle]);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const queueUrl = await getQueueUrl();
  console.log(`file-pipeline worker started`);
  console.log(`queue: ${queueUrl}`);

  while (true) {
    try {
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
      if (message) {
        await processMessage(queueUrl, message);
      }
    } catch (error) {
      console.error("file_pipeline_worker_error", error);
    }
    await sleep(pollMs);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
