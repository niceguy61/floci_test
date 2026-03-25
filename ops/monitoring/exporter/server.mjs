import http from "node:http";
import net from "node:net";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");
const awsLocalDir = path.join(rootDir, ".aws-local");

const host = process.env.FLOCI_EXPORTER_HOST ?? "0.0.0.0";
const port = Number(process.env.FLOCI_EXPORTER_PORT ?? 9464);
const endpoint = process.env.AWS_ENDPOINT ?? "http://localhost:4566";
const profile = process.env.AWS_PROFILE ?? "floci";
const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "test";
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "test";
const handsOnApps = [
  { name: "image-gallery", port: 3001 },
  { name: "order-processing", port: 3002 },
  { name: "auth-portal", port: 3003 },
  { name: "todo-logs", port: 3004 },
  { name: "alert-center", port: 3005 },
  { name: "file-pipeline", port: 3006 },
  { name: "secret-vault", port: 3007 },
  { name: "feature-flags", port: 3008 },
  { name: "stream-inspector", port: 3009 },
  { name: "cloudformation-playground", port: 3010 },
  { name: "product-catalog-cache", port: 3011 }
];

function metricLabels(labels) {
  const entries = Object.entries(labels ?? {});
  if (!entries.length) {
    return "";
  }
  return `{${entries
    .map(([key, value]) => `${key}="${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",")}}`;
}

async function runAwsJson(args) {
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
  const { stdout } = await execFileAsync("aws", finalArgs, {
    env,
    maxBuffer: 20 * 1024 * 1024
  });
  return stdout ? JSON.parse(stdout) : {};
}

async function httpCheck(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode < 500 ? 1 : 0);
    });
    request.on("error", () => resolve(0));
    request.setTimeout(2000, () => {
      request.destroy();
      resolve(0);
    });
  });
}

async function tcpCheck(hostname, targetPort) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: hostname, port: Number(targetPort) }, () => {
      socket.end();
      resolve(1);
    });
    socket.on("error", () => resolve(0));
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(0);
    });
  });
}

function pushGauge(lines, name, value, labels) {
  lines.push(`${name}${metricLabels(labels)} ${value}`);
}

async function collectMetrics() {
  const lines = [
    "# HELP floci_exporter_up floci service exporter process health.",
    "# TYPE floci_exporter_up gauge",
    "floci_exporter_up 1",
    "# HELP floci_endpoint_up floci control-plane endpoint reachability.",
    "# TYPE floci_endpoint_up gauge",
    "# HELP hands_on_app_up Hands-on app health endpoint reachability.",
    "# TYPE hands_on_app_up gauge",
    "# HELP hands_on_app_metrics_up Hands-on app metrics endpoint reachability.",
    "# TYPE hands_on_app_metrics_up gauge"
  ];

  pushGauge(lines, "floci_endpoint_up", await httpCheck(endpoint), {});
  for (const app of handsOnApps) {
    pushGauge(
      lines,
      "hands_on_app_up",
      await httpCheck(`http://127.0.0.1:${app.port}/api/health`),
      { app: app.name, port: app.port }
    );
    pushGauge(
      lines,
      "hands_on_app_metrics_up",
      await httpCheck(`http://127.0.0.1:${app.port}/metrics`),
      { app: app.name, port: app.port }
    );
  }

  try {
    const s3 = await runAwsJson(["s3api", "list-buckets"]);
    const buckets = s3.Buckets ?? [];
    lines.push("# HELP floci_resource_total Count of emulated AWS resources discovered through floci.");
    lines.push("# TYPE floci_resource_total gauge");
    pushGauge(lines, "floci_resource_total", buckets.length, { service: "s3", resource: "bucket" });
    lines.push("# HELP floci_s3_bucket_objects Count of objects currently stored in an emulated S3 bucket.");
    lines.push("# TYPE floci_s3_bucket_objects gauge");
    lines.push("# HELP floci_s3_bucket_bytes Total object size in bytes for an emulated S3 bucket.");
    lines.push("# TYPE floci_s3_bucket_bytes gauge");
    for (const bucket of buckets) {
      const bucketName = bucket.Name;
      if (!bucketName) {
        continue;
      }
      try {
        const objects = await runAwsJson(["s3api", "list-objects-v2", "--bucket", bucketName]);
        const contents = objects.Contents ?? [];
        pushGauge(lines, "floci_s3_bucket_objects", contents.length, { bucket: bucketName });
        pushGauge(
          lines,
          "floci_s3_bucket_bytes",
          contents.reduce((sum, item) => sum + Number(item.Size ?? 0), 0),
          { bucket: bucketName }
        );
      } catch {}
    }
  } catch {}

  try {
    const dynamo = await runAwsJson(["dynamodb", "list-tables"]);
    const tables = dynamo.TableNames ?? [];
    pushGauge(lines, "floci_resource_total", tables.length, { service: "dynamodb", resource: "table" });
    for (const table of tables) {
      try {
        const scan = await runAwsJson(["dynamodb", "scan", "--table-name", table, "--select", "COUNT"]);
        pushGauge(lines, "floci_dynamodb_table_items", scan.Count ?? 0, { table });
      } catch {}
    }
  } catch {}

  try {
    const sqs = await runAwsJson(["sqs", "list-queues"]);
    const queueUrls = sqs.QueueUrls ?? [];
    pushGauge(lines, "floci_resource_total", queueUrls.length, { service: "sqs", resource: "queue" });
    for (const queueUrl of queueUrls) {
      const name = queueUrl.split("/").pop() ?? queueUrl;
      try {
        const attrs = await runAwsJson([
          "sqs",
          "get-queue-attributes",
          "--queue-url",
          queueUrl,
          "--attribute-names",
          "ApproximateNumberOfMessages",
          "ApproximateNumberOfMessagesNotVisible",
          "ApproximateNumberOfMessagesDelayed"
        ]);
        const data = attrs.Attributes ?? {};
        pushGauge(lines, "floci_sqs_messages", Number(data.ApproximateNumberOfMessages ?? 0), {
          queue: name,
          kind: "visible"
        });
        pushGauge(lines, "floci_sqs_messages", Number(data.ApproximateNumberOfMessagesNotVisible ?? 0), {
          queue: name,
          kind: "inflight"
        });
        pushGauge(lines, "floci_sqs_messages", Number(data.ApproximateNumberOfMessagesDelayed ?? 0), {
          queue: name,
          kind: "delayed"
        });
      } catch {}
    }
  } catch {}

  try {
    const sns = await runAwsJson(["sns", "list-topics"]);
    pushGauge(lines, "floci_resource_total", (sns.Topics ?? []).length, { service: "sns", resource: "topic" });
  } catch {}

  try {
    const ssm = await runAwsJson(["ssm", "describe-parameters"]);
    pushGauge(lines, "floci_resource_total", (ssm.Parameters ?? []).length, { service: "ssm", resource: "parameter" });
  } catch {}

  try {
    const secrets = await runAwsJson(["secretsmanager", "list-secrets"]);
    pushGauge(lines, "floci_resource_total", (secrets.SecretList ?? []).length, { service: "secretsmanager", resource: "secret" });
  } catch {}

  try {
    const cognito = await runAwsJson(["cognito-idp", "list-user-pools", "--max-results", "60"]);
    const pools = cognito.UserPools ?? [];
    pushGauge(lines, "floci_resource_total", pools.length, { service: "cognito-idp", resource: "user_pool" });
    lines.push("# HELP floci_cognito_users Count of users in an emulated Cognito user pool.");
    lines.push("# TYPE floci_cognito_users gauge");
    for (const pool of pools) {
      const userPoolId = pool.Id;
      if (!userPoolId) {
        continue;
      }
      try {
        const users = await runAwsJson(["cognito-idp", "list-users", "--user-pool-id", userPoolId]);
        pushGauge(lines, "floci_cognito_users", (users.Users ?? []).length, {
          user_pool_id: userPoolId,
          user_pool_name: pool.Name ?? userPoolId
        });
      } catch {}
    }
  } catch {}

  try {
    const streams = await runAwsJson(["kinesis", "list-streams"]);
    const names = streams.StreamNames ?? [];
    pushGauge(lines, "floci_resource_total", names.length, { service: "kinesis", resource: "stream" });
    for (const streamName of names) {
      try {
        const detail = await runAwsJson(["kinesis", "describe-stream", "--stream-name", streamName]);
        const shards = detail.StreamDescription?.Shards?.length ?? 0;
        pushGauge(lines, "floci_kinesis_shards", shards, { stream: streamName });
      } catch {}
    }
  } catch {}

  try {
    const stacks = await runAwsJson(["cloudformation", "list-stacks"]);
    const summaries = stacks.StackSummaries ?? [];
    pushGauge(lines, "floci_resource_total", summaries.length, { service: "cloudformation", resource: "stack" });
    const byStatus = new Map();
    for (const stack of summaries) {
      byStatus.set(stack.StackStatus, (byStatus.get(stack.StackStatus) ?? 0) + 1);
    }
    for (const [status, count] of byStatus.entries()) {
      pushGauge(lines, "floci_cloudformation_stacks", count, { status });
    }
  } catch {}

  try {
    const groups = await runAwsJson(["logs", "describe-log-groups"]);
    const logGroups = groups.logGroups ?? [];
    pushGauge(lines, "floci_resource_total", logGroups.length, { service: "cloudwatchlogs", resource: "log_group" });
    lines.push("# HELP floci_cloudwatch_log_streams Count of streams in an emulated CloudWatch Logs group.");
    lines.push("# TYPE floci_cloudwatch_log_streams gauge");
    lines.push("# HELP floci_cloudwatch_log_events Count of log events in an emulated CloudWatch Logs stream.");
    lines.push("# TYPE floci_cloudwatch_log_events gauge");
    for (const group of logGroups) {
      const groupName = group.logGroupName;
      if (!groupName) {
        continue;
      }
      try {
        const streams = await runAwsJson([
          "logs",
          "describe-log-streams",
          "--log-group-name",
          groupName
        ]);
        const logStreams = streams.logStreams ?? [];
        pushGauge(lines, "floci_cloudwatch_log_streams", logStreams.length, { log_group: groupName });
        for (const stream of logStreams) {
          const streamName = stream.logStreamName;
          if (!streamName) {
            continue;
          }
          try {
            const events = await runAwsJson([
              "logs",
              "get-log-events",
              "--log-group-name",
              groupName,
              "--log-stream-name",
              streamName
            ]);
            pushGauge(lines, "floci_cloudwatch_log_events", (events.events ?? []).length, {
              log_group: groupName,
              log_stream: streamName
            });
          } catch {}
        }
      } catch {}
    }
  } catch {}

  try {
    const rds = await runAwsJson(["rds", "describe-db-instances"]);
    const instances = rds.DBInstances ?? [];
    pushGauge(lines, "floci_resource_total", instances.length, { service: "rds", resource: "instance" });
    for (const instance of instances) {
      const identifier = instance.DBInstanceIdentifier ?? "unknown";
      pushGauge(lines, "floci_rds_instance_status", 1, {
        instance: identifier,
        status: instance.DBInstanceStatus ?? "UNKNOWN",
        engine: instance.Engine ?? "unknown"
      });
      if (instance.Endpoint?.Port) {
        pushGauge(lines, "floci_rds_endpoint_port", Number(instance.Endpoint.Port), { instance: identifier });
      }
      if (instance.Endpoint?.Address && instance.Endpoint?.Port) {
        pushGauge(
          lines,
          "floci_proxy_tcp_up",
          await tcpCheck(instance.Endpoint.Address, instance.Endpoint.Port),
          { service: "rds", name: identifier, port: instance.Endpoint.Port }
        );
      }
    }
  } catch {}

  try {
    const cache = await runAwsJson(["elasticache", "describe-replication-groups"]);
    const groups = cache.ReplicationGroups ?? [];
    pushGauge(lines, "floci_resource_total", groups.length, { service: "elasticache", resource: "replication_group" });
    for (const group of groups) {
      const identifier = group.ReplicationGroupId ?? "unknown";
      pushGauge(lines, "floci_elasticache_replication_group_status", 1, {
        replication_group: identifier,
        status: group.Status ?? "unknown"
      });
      if (group.ConfigurationEndpoint?.Port) {
        pushGauge(lines, "floci_elasticache_endpoint_port", Number(group.ConfigurationEndpoint.Port), {
          replication_group: identifier
        });
      }
      if (group.ConfigurationEndpoint?.Address && group.ConfigurationEndpoint?.Port) {
        pushGauge(
          lines,
          "floci_proxy_tcp_up",
          await tcpCheck(group.ConfigurationEndpoint.Address, group.ConfigurationEndpoint.Port),
          { service: "elasticache", name: identifier, port: group.ConfigurationEndpoint.Port }
        );
      }
    }
  } catch {}

  return `${lines.join("\n")}\n`;
}

const server = http.createServer(async (req, res) => {
  if ((req.url ?? "/") === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "ok", endpoint, profile }));
    return;
  }

  if ((req.url ?? "/") !== "/metrics") {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  try {
    const metrics = await collectMetrics();
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
    res.end(metrics);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "unknown_error" }));
  }
});

server.listen(port, host, () => {
  console.log(`floci exporter listening on http://${host}:${port}`);
  console.log(`floci endpoint: ${endpoint}`);
});
