import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";

const histogramBucketsMs = [5, 10, 25, 50, 100, 250, 500, 1000, 2500];

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

export function createObservability({ appName, metricsPath = "/metrics", logFile }) {
  const startedAt = Date.now();
  const requestCounter = new Map();
  const requestDurationHistogram = new Map();
  const domainEventCounter = new Map();
  const logReady = mkdir(path.dirname(logFile), { recursive: true });

  function incrementCounter(store, labels, amount = 1) {
    const key = labelKey(labels);
    const current = store.get(key) ?? { labels: { ...labels }, value: 0 };
    current.value += amount;
    store.set(key, current);
  }

  function observeHistogram(labels, value) {
    const key = labelKey(labels);
    const current =
      requestDurationHistogram.get(key) ??
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
    requestDurationHistogram.set(key, current);
  }

  function logEvent(level, event, fields = {}) {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      app: appName,
      event,
      ...fields
    });
    console.log(line);
    logReady.then(() => appendFile(logFile, `${line}\n`)).catch(() => {});
  }

  function incrementDomainEvent(domain, action, amount = 1) {
    incrementCounter(domainEventCounter, { app: appName, domain, action }, amount);
  }

  function recordHttp({ method, route, statusCode, durationMs }) {
    incrementCounter(requestCounter, {
      app: appName,
      route,
      method,
      status: String(statusCode)
    });

    observeHistogram(
      {
        app: appName,
        route,
        method
      },
      durationMs
    );

    if (route !== metricsPath) {
      logEvent("info", "http_request", {
        method,
        route,
        status: statusCode,
        durationMs: Number(durationMs.toFixed(2))
      });
    }
  }

  function renderMetrics() {
    const lines = [
      "# HELP hands_on_up Hands-on app process health.",
      "# TYPE hands_on_up gauge",
      `hands_on_up${formatLabels({ app: appName })} 1`,
      "# HELP hands_on_uptime_seconds Hands-on app uptime in seconds.",
      "# TYPE hands_on_uptime_seconds gauge",
      `hands_on_uptime_seconds${formatLabels({ app: appName })} ${(Date.now() - startedAt) / 1000}`,
      "# HELP hands_on_http_requests_total Total HTTP requests handled by a hands-on app.",
      "# TYPE hands_on_http_requests_total counter"
    ];

    for (const metric of requestCounter.values()) {
      lines.push(`hands_on_http_requests_total${formatLabels(metric.labels)} ${metric.value}`);
    }

    lines.push(
      "# HELP hands_on_http_request_duration_ms HTTP request duration histogram in milliseconds.",
      "# TYPE hands_on_http_request_duration_ms histogram"
    );

    for (const metric of requestDurationHistogram.values()) {
      histogramBucketsMs.forEach((bucket, index) => {
        lines.push(
          `hands_on_http_request_duration_ms_bucket${formatLabels({
            ...metric.labels,
            le: bucket
          })} ${metric.buckets[index]}`
        );
      });
      lines.push(
        `hands_on_http_request_duration_ms_bucket${formatLabels({
          ...metric.labels,
          le: "+Inf"
        })} ${metric.count}`
      );
      lines.push(`hands_on_http_request_duration_ms_sum${formatLabels(metric.labels)} ${metric.sum}`);
      lines.push(`hands_on_http_request_duration_ms_count${formatLabels(metric.labels)} ${metric.count}`);
    }

    lines.push(
      "# HELP hands_on_domain_events_total Domain-level events emitted by a hands-on app.",
      "# TYPE hands_on_domain_events_total counter"
    );

    for (const metric of domainEventCounter.values()) {
      lines.push(`hands_on_domain_events_total${formatLabels(metric.labels)} ${metric.value}`);
    }

    return `${lines.join("\n")}\n`;
  }

  function maybeHandleMetrics(req, res, pathname) {
    if (req.method === "GET" && pathname === metricsPath) {
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(renderMetrics());
      return true;
    }
    return false;
  }

  function healthFields(extra = {}) {
    return {
      app: appName,
      metricsPath,
      logFile,
      ...extra
    };
  }

  return {
    metricsPath,
    logFile,
    logEvent,
    incrementDomainEvent,
    recordHttp,
    maybeHandleMetrics,
    healthFields
  };
}
