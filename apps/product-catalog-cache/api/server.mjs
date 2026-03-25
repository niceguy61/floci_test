import http from "node:http";
import net from "node:net";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { appendFile, mkdir, readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "../web");
const repoRoot = path.resolve(__dirname, "../../..");
const awsLocalDir = path.join(repoRoot, ".aws-local");
const runtimeFile = path.resolve(__dirname, "../.runtime/product-catalog-cache.json");

const port = Number(process.env.PRODUCT_CATALOG_CACHE_PORT ?? 3011);
const endpoint = process.env.AWS_ENDPOINT ?? "http://localhost:4566";
const profile = process.env.AWS_PROFILE ?? "floci";
const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "test";
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "test";
const cacheTtlSeconds = Number(process.env.PRODUCT_CATALOG_CACHE_TTL_SECONDS ?? 30);
const metricsPath = process.env.PRODUCT_CATALOG_CACHE_METRICS_PATH ?? "/metrics";
const logFile = process.env.PRODUCT_CATALOG_CACHE_LOG_FILE ?? path.resolve(__dirname, "../.runtime/product-catalog-cache.log");
const host = process.env.PRODUCT_CATALOG_CACHE_HOST ?? "0.0.0.0";
const startedAt = Date.now();
const histogramBucketsMs = [5, 10, 25, 50, 100, 250, 500, 1000, 2500];

class IncompleteRespError extends Error {}

const requestCounter = new Map();
const requestDurationHistogram = new Map();
const cacheLookupCounter = new Map();
const cacheInvalidationCounter = new Map();
const logReady = mkdir(path.dirname(logFile), { recursive: true });

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

function labelKey(labels) {
  return Object.entries(labels)
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
}

function formatLabels(labels) {
  const parts = Object.entries(labels).map(
    ([key, value]) => `${key}="${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
  );
  return parts.length ? `{${parts.join(",")}}` : "";
}

function incrementCounter(store, labels, amount = 1) {
  const key = labelKey(labels);
  const current = store.get(key) ?? { labels: { ...labels }, value: 0 };
  current.value += amount;
  store.set(key, current);
}

function observeHistogram(store, labels, value) {
  const key = labelKey(labels);
  const current =
    store.get(key) ??
    {
      labels: { ...labels },
      buckets: histogramBucketsMs.map(() => 0),
      count: 0,
      sum: 0
    };

  histogramBucketsMs.forEach((bucket, index) => {
    if (value <= bucket) {
      current.buckets[index] += 1;
    }
  });

  current.count += 1;
  current.sum += value;
  store.set(key, current);
}

function renderMetrics() {
  const lines = [
    "# HELP product_catalog_up Product catalog API process health.",
    "# TYPE product_catalog_up gauge",
    "product_catalog_up 1",
    "# HELP product_catalog_uptime_seconds Product catalog API uptime in seconds.",
    "# TYPE product_catalog_uptime_seconds gauge",
    `product_catalog_uptime_seconds ${(Date.now() - startedAt) / 1000}`,
    "# HELP product_catalog_requests_total Total HTTP requests handled by the product catalog API.",
    "# TYPE product_catalog_requests_total counter",
    "# HELP hands_on_up Hands-on app process health.",
    "# TYPE hands_on_up gauge",
    `hands_on_up${formatLabels({ app: "product-catalog-cache" })} 1`,
    "# HELP hands_on_uptime_seconds Hands-on app uptime in seconds.",
    "# TYPE hands_on_uptime_seconds gauge",
    `hands_on_uptime_seconds${formatLabels({ app: "product-catalog-cache" })} ${(Date.now() - startedAt) / 1000}`,
    "# HELP hands_on_http_requests_total Total HTTP requests handled by a hands-on app.",
    "# TYPE hands_on_http_requests_total counter"
  ];

  for (const metric of requestCounter.values()) {
    lines.push(`product_catalog_requests_total${formatLabels(metric.labels)} ${metric.value}`);
    lines.push(
      `hands_on_http_requests_total${formatLabels({
        app: "product-catalog-cache",
        ...metric.labels
      })} ${metric.value}`
    );
  }

  lines.push(
    "# HELP product_catalog_request_duration_ms HTTP request duration histogram in milliseconds.",
    "# TYPE product_catalog_request_duration_ms histogram",
    "# HELP hands_on_http_request_duration_ms HTTP request duration histogram in milliseconds.",
    "# TYPE hands_on_http_request_duration_ms histogram"
  );

  for (const metric of requestDurationHistogram.values()) {
    histogramBucketsMs.forEach((bucket, index) => {
      lines.push(
        `product_catalog_request_duration_ms_bucket${formatLabels({
          ...metric.labels,
          le: bucket
        })} ${metric.buckets[index]}`
      );
      lines.push(
        `hands_on_http_request_duration_ms_bucket${formatLabels({
          app: "product-catalog-cache",
          ...metric.labels,
          le: bucket
        })} ${metric.buckets[index]}`
      );
    });
    lines.push(
      `product_catalog_request_duration_ms_bucket${formatLabels({
        ...metric.labels,
        le: "+Inf"
      })} ${metric.count}`
    );
    lines.push(
      `hands_on_http_request_duration_ms_bucket${formatLabels({
        app: "product-catalog-cache",
        ...metric.labels,
        le: "+Inf"
      })} ${metric.count}`
    );
    lines.push(`product_catalog_request_duration_ms_sum${formatLabels(metric.labels)} ${metric.sum}`);
    lines.push(`product_catalog_request_duration_ms_count${formatLabels(metric.labels)} ${metric.count}`);
    lines.push(
      `hands_on_http_request_duration_ms_sum${formatLabels({
        app: "product-catalog-cache",
        ...metric.labels
      })} ${metric.sum}`
    );
    lines.push(
      `hands_on_http_request_duration_ms_count${formatLabels({
        app: "product-catalog-cache",
        ...metric.labels
      })} ${metric.count}`
    );
  }

  lines.push(
    "# HELP product_catalog_cache_lookups_total Cache lookup result counts for list/detail queries.",
    "# TYPE product_catalog_cache_lookups_total counter",
    "# HELP hands_on_domain_events_total Domain-level events emitted by a hands-on app.",
    "# TYPE hands_on_domain_events_total counter"
  );

  for (const metric of cacheLookupCounter.values()) {
    lines.push(`product_catalog_cache_lookups_total${formatLabels(metric.labels)} ${metric.value}`);
    lines.push(
      `hands_on_domain_events_total${formatLabels({
        app: "product-catalog-cache",
        domain: "cache_lookup",
        action: `${metric.labels.kind}_${metric.labels.result}`
      })} ${metric.value}`
    );
  }

  lines.push(
    "# HELP product_catalog_cache_invalidations_total Cache invalidations triggered by writes.",
    "# TYPE product_catalog_cache_invalidations_total counter"
  );

  for (const metric of cacheInvalidationCounter.values()) {
    lines.push(`product_catalog_cache_invalidations_total${formatLabels(metric.labels)} ${metric.value}`);
    lines.push(
      `hands_on_domain_events_total${formatLabels({
        app: "product-catalog-cache",
        domain: "cache_invalidation",
        action: metric.labels.reason
      })} ${metric.value}`
    );
  }

  return `${lines.join("\n")}\n`;
}

function logEvent(level, event, fields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    app: "product-catalog-cache",
    event,
    ...fields
  });
  console.log(line);
  logReady.then(() => appendFile(logFile, `${line}\n`)).catch(() => {});
}

function normalizedRoute(method, pathname) {
  if (method === "GET" && pathname === metricsPath) {
    return metricsPath;
  }
  if (method === "GET" && pathname === "/api/products") {
    return "/api/products";
  }
  if (method === "POST" && pathname === "/api/products") {
    return "/api/products";
  }
  if (/^\/api\/products\/[^/]+$/.test(pathname)) {
    return "/api/products/:sku";
  }
  return pathname;
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

async function readRuntime() {
  return JSON.parse(await readFile(runtimeFile, "utf8"));
}

async function runPsql(runtime, sql) {
  const args = [
    "-h",
    runtime.rds.host,
    "-p",
    String(runtime.rds.port),
    "-U",
    runtime.rds.username,
    "-d",
    runtime.rds.database,
    "-v",
    "ON_ERROR_STOP=1",
    "-Atqc",
    sql
  ];

  const env = {
    ...process.env,
    PGPASSWORD: runtime.rds.password
  };

  const { stdout } = await execFileAsync("psql", args, {
    env,
    maxBuffer: 20 * 1024 * 1024
  });

  return stdout.trim();
}

async function runPsqlJson(runtime, sql) {
  const stdout = await runPsql(runtime, sql);
  return stdout ? JSON.parse(stdout) : null;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalizeProduct(item) {
  return {
    sku: String(item.sku ?? ""),
    name: String(item.name ?? ""),
    description: String(item.description ?? ""),
    priceCents: Number(item.priceCents ?? 0),
    updatedAt: String(item.updatedAt ?? "")
  };
}

function encodeRedisCommand(parts) {
  const segments = [`*${parts.length}\r\n`];
  for (const part of parts) {
    const value = String(part);
    segments.push(`$${Buffer.byteLength(value, "utf8")}\r\n${value}\r\n`);
  }
  return segments.join("");
}

function readRespLine(buffer, start) {
  const end = buffer.indexOf("\r\n", start);
  if (end === -1) {
    throw new IncompleteRespError("resp_line_incomplete");
  }
  return [buffer.slice(start, end), end + 2];
}

function parseRedisResp(buffer, start = 0) {
  if (start >= buffer.length) {
    throw new IncompleteRespError("resp_prefix_missing");
  }

  const prefix = buffer[start];

  if (prefix === 43 || prefix === 45 || prefix === 58) {
    const [line, next] = readRespLine(buffer, start + 1);
    if (prefix === 45) {
      throw new Error(line.toString("utf8"));
    }
    if (prefix === 58) {
      return [Number(line.toString("utf8")), next];
    }
    return [line.toString("utf8"), next];
  }

  if (prefix === 36) {
    const [line, next] = readRespLine(buffer, start + 1);
    const length = Number(line.toString("utf8"));
    if (length === -1) {
      return [null, next];
    }
    const end = next + length;
    if (buffer.length < end + 2) {
      throw new IncompleteRespError("resp_bulk_incomplete");
    }
    return [buffer.slice(next, end).toString("utf8"), end + 2];
  }

  if (prefix === 42) {
    const [line, next] = readRespLine(buffer, start + 1);
    const length = Number(line.toString("utf8"));
    if (length === -1) {
      return [null, next];
    }
    const values = [];
    let offset = next;
    for (let index = 0; index < length; index += 1) {
      const [value, newOffset] = parseRedisResp(buffer, offset);
      values.push(value);
      offset = newOffset;
    }
    return [values, offset];
  }

  throw new Error(`unsupported_resp_prefix:${String.fromCharCode(prefix)}`);
}

async function redisCommand(runtime, parts) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(
      {
        host: runtime.cache.host,
        port: Number(runtime.cache.port)
      },
      () => {
        socket.write(encodeRedisCommand(parts));
      }
    );

    const chunks = [];
    socket.setTimeout(3000);

    socket.on("data", (chunk) => {
      chunks.push(chunk);
      try {
        const [value] = parseRedisResp(Buffer.concat(chunks));
        socket.end();
        resolve(value);
      } catch (error) {
        if (!(error instanceof IncompleteRespError)) {
          socket.destroy();
          reject(error);
        }
      }
    });

    socket.on("timeout", () => {
      socket.destroy(new Error("redis_timeout"));
    });

    socket.on("error", (error) => {
      reject(error);
    });

    socket.on("end", () => {
      if (!chunks.length) {
        reject(new Error("redis_empty_response"));
      }
    });
  });
}

async function cacheGetJson(runtime, key) {
  const value = await redisCommand(runtime, ["GET", key]);
  return value ? JSON.parse(value) : null;
}

async function cacheSetJson(runtime, key, value) {
  await redisCommand(runtime, ["SET", key, JSON.stringify(value), "EX", String(cacheTtlSeconds)]);
}

async function cacheFlush(runtime) {
  await redisCommand(runtime, ["FLUSHDB"]);
}

function listCacheKey(query) {
  return `product-catalog:list:${encodeURIComponent(query)}`;
}

function detailCacheKey(sku) {
  return `product-catalog:detail:${encodeURIComponent(sku)}`;
}

async function searchProducts(runtime, query) {
  const sql = `
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text
    FROM (
      SELECT
        sku,
        name,
        description,
        price_cents AS "priceCents",
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
      FROM products
      WHERE (
        ${sqlString(query)} = ''
        OR sku ILIKE '%' || ${sqlString(query)} || '%'
        OR name ILIKE '%' || ${sqlString(query)} || '%'
        OR description ILIKE '%' || ${sqlString(query)} || '%'
      )
      ORDER BY updated_at DESC
      LIMIT 20
    ) t;
  `;

  const items = await runPsqlJson(runtime, sql);
  return Array.isArray(items) ? items.map(normalizeProduct) : [];
}

async function getProduct(runtime, sku) {
  const sql = `
    SELECT COALESCE(row_to_json(t)::text, '')
    FROM (
      SELECT
        sku,
        name,
        description,
        price_cents AS "priceCents",
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
      FROM products
      WHERE sku = ${sqlString(sku)}
    ) t;
  `;

  const item = await runPsqlJson(runtime, sql);
  return item ? normalizeProduct(item) : null;
}

async function upsertProduct(runtime, payload) {
  const sku = String(payload.sku ?? "").trim();
  const name = String(payload.name ?? "").trim();
  const description = String(payload.description ?? "").trim();
  const priceCents = Number(payload.priceCents ?? NaN);

  if (!sku || !name || !Number.isInteger(priceCents) || priceCents < 0) {
    throw new Error("invalid_payload");
  }

  const sql = `
    WITH upserted AS (
      INSERT INTO products (sku, name, description, price_cents)
      VALUES (${sqlString(sku)}, ${sqlString(name)}, ${sqlString(description)}, ${priceCents})
      ON CONFLICT (sku) DO UPDATE
      SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        price_cents = EXCLUDED.price_cents,
        updated_at = now()
      RETURNING
        sku,
        name,
        description,
        price_cents AS "priceCents",
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
    )
    SELECT row_to_json(upserted)::text
    FROM upserted;
  `;

  const item = await runPsqlJson(runtime, sql);
  await cacheFlush(runtime);
  incrementCounter(cacheInvalidationCounter, { reason: "product_write" });
  logEvent("info", "cache_invalidation", { reason: "product_write", sku });
  return normalizeProduct(item);
}

async function listProductsWithCache(runtime, query) {
  const key = listCacheKey(query);
  const cached = await cacheGetJson(runtime, key).catch(() => null);
  if (cached) {
    incrementCounter(cacheLookupCounter, { kind: "list", result: "hit" });
    logEvent("info", "cache_lookup", { kind: "list", result: "hit", cacheKey: key });
    return { items: cached.items.map(normalizeProduct), source: "cache", cacheKey: key };
  }

  incrementCounter(cacheLookupCounter, { kind: "list", result: "miss" });
  logEvent("info", "cache_lookup", { kind: "list", result: "miss", cacheKey: key });
  const items = await searchProducts(runtime, query);
  await cacheSetJson(runtime, key, { items }).catch(() => {});
  return { items, source: "db", cacheKey: key };
}

async function getProductWithCache(runtime, sku) {
  const key = detailCacheKey(sku);
  const cached = await cacheGetJson(runtime, key).catch(() => null);
  if (cached) {
    incrementCounter(cacheLookupCounter, { kind: "detail", result: "hit" });
    logEvent("info", "cache_lookup", { kind: "detail", result: "hit", cacheKey: key, sku });
    return { item: normalizeProduct(cached.item), source: "cache", cacheKey: key };
  }

  incrementCounter(cacheLookupCounter, { kind: "detail", result: "miss" });
  logEvent("info", "cache_lookup", { kind: "detail", result: "miss", cacheKey: key, sku });
  const item = await getProduct(runtime, sku);
  if (!item) {
    return null;
  }

  await cacheSetJson(runtime, key, { item }).catch(() => {});
  return { item, source: "db", cacheKey: key };
}

async function sendIndex(res) {
  const html = await readFile(path.join(webRoot, "index.html"), "utf8");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const route = normalizedRoute(req.method ?? "GET", requestUrl.pathname);
  const started = process.hrtime.bigint();
  let statusCode = 500;

  try {
    const runtime = await readRuntime();

    if (req.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html")) {
      await sendIndex(res);
      statusCode = 200;
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === metricsPath) {
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(renderMetrics());
      statusCode = 200;
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      json(res, 200, {
        status: "ok",
        endpoint,
        profile,
        cacheTtlSeconds,
        metricsPath,
        logFile,
        rds: runtime.rds,
        cache: runtime.cache
      });
      statusCode = 200;
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/products") {
      const query = requestUrl.searchParams.get("q")?.trim() ?? "";
      json(res, 200, await listProductsWithCache(runtime, query));
      statusCode = 200;
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/products") {
      json(res, 201, await upsertProduct(runtime, await readJsonBody(req)));
      statusCode = 201;
      return;
    }

    const match = requestUrl.pathname.match(/^\/api\/products\/([^/]+)$/);
    if (req.method === "GET" && match) {
      const result = await getProductWithCache(runtime, decodeURIComponent(match[1]));
      if (!result) {
        json(res, 404, { error: "not_found" });
        statusCode = 404;
        return;
      }
      json(res, 200, result);
      statusCode = 200;
      return;
    }

    json(res, 404, { error: "not_found" });
    statusCode = 404;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    statusCode = message === "invalid_payload" ? 400 : 500;
    logEvent("error", "request_failed", {
      method: req.method ?? "GET",
      route,
      error: message
    });
    json(res, statusCode, { error: message });
  } finally {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    incrementCounter(requestCounter, {
      route,
      method: req.method ?? "GET",
      status: String(statusCode)
    });
    observeHistogram(requestDurationHistogram, {
      route,
      method: req.method ?? "GET"
    }, durationMs);
    if (route !== metricsPath) {
      logEvent("info", "http_request", {
        method: req.method ?? "GET",
        route,
        status: statusCode,
        durationMs: Number(durationMs.toFixed(2))
      });
    }
  }
});

server.listen(port, host, () => {
  console.log(`product-catalog-cache server listening on http://127.0.0.1:${port}`);
  console.log(`floci endpoint: ${endpoint}`);
  logEvent("info", "server_started", {
    port,
    endpoint,
    metricsPath,
    logFile
  });
});
