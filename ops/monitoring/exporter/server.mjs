import http from "node:http";
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const host = process.env.FLOCI_EXPORTER_HOST ?? "0.0.0.0";
const port = Number(process.env.FLOCI_EXPORTER_PORT ?? 9464);
const endpoint = process.env.AWS_ENDPOINT ?? "http://localhost:4566";
const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "test";
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "test";
const refreshIntervalMs = Number(process.env.FLOCI_EXPORTER_REFRESH_MS ?? 30000);
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
    AWS_DEFAULT_REGION: region
  };

  const finalArgs = ["--endpoint-url", endpoint, ...args];
  const { stdout } = await execFileAsync("aws", finalArgs, {
    env,
    maxBuffer: 20 * 1024 * 1024,
    timeout: 5000
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
  const appChecks = await Promise.all(
    handsOnApps.map(async (app) => ({
      app,
      health: await httpCheck(`http://127.0.0.1:${app.port}/api/health`),
      metrics: await httpCheck(`http://127.0.0.1:${app.port}/metrics`)
    }))
  );
  for (const result of appChecks) {
    pushGauge(lines, "hands_on_app_up", result.health, { app: result.app.name, port: result.app.port });
    pushGauge(lines, "hands_on_app_metrics_up", result.metrics, { app: result.app.name, port: result.app.port });
  }

  try {
    const s3 = await runAwsJson(["s3api", "list-buckets"]);
    const buckets = s3.Buckets ?? [];
    lines.push("# HELP floci_resource_total Count of emulated AWS resources discovered through floci.");
    lines.push("# TYPE floci_resource_total gauge");
    pushGauge(lines, "floci_resource_total", buckets.length, { service: "s3", resource: "bucket" });
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
  } catch {}

  try {
    const rds = await runAwsJson(["rds", "describe-db-instances"]);
    const instances = rds.DBInstances ?? [];
    pushGauge(lines, "floci_resource_total", instances.length, { service: "rds", resource: "instance" });
    const checks = await Promise.all(
      instances.map(async (instance) => {
        const identifier = instance.DBInstanceIdentifier ?? "unknown";
        const tcpUp =
          instance.Endpoint?.Address && instance.Endpoint?.Port
            ? await tcpCheck(instance.Endpoint.Address, instance.Endpoint.Port)
            : 0;
        return { instance, identifier, tcpUp };
      })
    );
    for (const result of checks) {
      const instance = result.instance;
      const identifier = result.identifier;
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
          result.tcpUp,
          { service: "rds", name: identifier, port: instance.Endpoint.Port }
        );
      }
    }
  } catch {}

  try {
    const cache = await runAwsJson(["elasticache", "describe-replication-groups"]);
    const groups = cache.ReplicationGroups ?? [];
    pushGauge(lines, "floci_resource_total", groups.length, { service: "elasticache", resource: "replication_group" });
    const checks = await Promise.all(
      groups.map(async (group) => {
        const identifier = group.ReplicationGroupId ?? "unknown";
        const tcpUp =
          group.ConfigurationEndpoint?.Address && group.ConfigurationEndpoint?.Port
            ? await tcpCheck(group.ConfigurationEndpoint.Address, group.ConfigurationEndpoint.Port)
            : 0;
        return { group, identifier, tcpUp };
      })
    );
    for (const result of checks) {
      const group = result.group;
      const identifier = result.identifier;
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
          result.tcpUp,
          { service: "elasticache", name: identifier, port: group.ConfigurationEndpoint.Port }
        );
      }
    }
  } catch {}

  return `${lines.join("\n")}\n`;
}

let lastMetrics = "# HELP floci_exporter_collect_ok Whether the exporter has completed at least one collection.\n# TYPE floci_exporter_collect_ok gauge\nfloci_exporter_collect_ok 0\n";
let lastCollectionError = "";
let collecting = null;

async function refreshMetrics() {
  if (collecting) {
    return collecting;
  }

  collecting = (async () => {
    try {
      const metrics = await collectMetrics();
      lastMetrics = `${metrics}# HELP floci_exporter_collect_ok Whether the exporter has completed at least one collection.\n# TYPE floci_exporter_collect_ok gauge\nfloci_exporter_collect_ok 1\n`;
      lastCollectionError = "";
    } catch (error) {
      lastCollectionError = error instanceof Error ? error.message : "unknown_error";
      lastMetrics = `# HELP floci_exporter_collect_ok Whether the exporter has completed at least one collection.\n# TYPE floci_exporter_collect_ok gauge\nfloci_exporter_collect_ok 0\n# HELP floci_exporter_collect_error Whether the latest collection failed.\n# TYPE floci_exporter_collect_error gauge\nfloci_exporter_collect_error 1\n`;
    } finally {
      collecting = null;
    }
  })();

  return collecting;
}

const server = http.createServer(async (req, res) => {
  if ((req.url ?? "/") === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "ok", endpoint, lastCollectionError }));
    if (!collecting) {
      refreshMetrics().catch(() => {});
    }
    return;
  }

  if ((req.url ?? "/") !== "/metrics") {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  try {
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
    res.end(lastMetrics);
    if (!collecting) {
      refreshMetrics().catch(() => {});
    }
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "unknown_error" }));
  }
});

server.listen(port, host, () => {
  console.log(`floci exporter listening on http://${host}:${port}`);
  console.log(`floci endpoint: ${endpoint}`);
  setInterval(() => {
    refreshMetrics().catch(() => {});
  }, refreshIntervalMs).unref();
});
