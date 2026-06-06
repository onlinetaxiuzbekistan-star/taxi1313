/**
 * Prometheus metrics (RED: Rate, Errors, Duration) + business failure counters.
 * Scrape at GET /metrics. Use metricsMiddleware for per-request RED metrics and
 * the record* helpers for domain failures.
 */
import client from "prom-client";
import type { Request, Response, NextFunction } from "express";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

// RED: a histogram gives request count (rate), status_code label (errors), and
// the latency distribution (duration) in one metric.
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [registry],
});

// Business failure counters.
const dispatchFailures = new client.Counter({
  name: "dispatch_failures_total",
  help: "Total ride-dispatch failures",
  registers: [registry],
});
const paymentFailures = new client.Counter({
  name: "payment_failures_total",
  help: "Total payment failures",
  labelNames: ["stage"] as const,
  registers: [registry],
});
const smsFailures = new client.Counter({
  name: "sms_failures_total",
  help: "Total SMS send failures",
  registers: [registry],
});

export function recordDispatchFailure(): void {
  dispatchFailures.inc();
}
export function recordPaymentFailure(stage = "unknown"): void {
  paymentFailures.inc({ stage });
}
export function recordSmsFailure(): void {
  smsFailures.inc();
}

/** Per-request RED instrumentation. Route label is kept low-cardinality. */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    const route = (req.baseUrl || "") + (req.route?.path || "") || req.path.split("?")[0] || "unmatched";
    end({ method: req.method, route, status_code: String(res.statusCode) });
  });
  next();
}

export async function metricsEndpoint(_req: Request, res: Response): Promise<void> {
  res.setHeader("Content-Type", registry.contentType);
  res.end(await registry.metrics());
}
