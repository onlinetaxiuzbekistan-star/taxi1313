import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { redis } from "../lib/redis.js";
import { getDriverCache } from "../lib/driver-cache.js";
import { getWsStats } from "../lib/websocket.js";
import { config } from "../lib/config.js";
import { timingSafeEqualStr } from "../lib/secure-compare.js";
import os from "os";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/health-deep", async (req, res) => {
  const healthToken = config.internalHealthToken;
  if (healthToken) {
    const provided =
      (typeof req.query.token === "string" && req.query.token) ||
      (req.headers["x-internal-health-token"] as string | undefined) ||
      "";
    if (!timingSafeEqualStr(provided, healthToken)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
  }

  const start = Date.now();
  const checks: Record<string, { status: string; latency?: number; error?: string; details?: any }> = {};
  let allOk = true;

  try {
    const pgStart = Date.now();
    const result = await db.execute(sql`SELECT 1 as ok`);
    checks.postgresql = { status: "ok", latency: Date.now() - pgStart };
  } catch (err) {
    checks.postgresql = { status: "error", error: (err as Error).message };
    allOk = false;
  }

  try {
    const rStart = Date.now();
    const pong = await redis.ping();
    checks.redis = { status: pong === "PONG" ? "ok" : "error", latency: Date.now() - rStart };
  } catch (err) {
    checks.redis = { status: "error", error: (err as Error).message };
    allOk = false;
  }

  try {
    const wsStats = getWsStats();
    checks.websocket = { status: "ok", details: wsStats };
  } catch (err) {
    checks.websocket = { status: "error", error: (err as Error).message };
  }

  const driverCache = getDriverCache();
  checks.driver_cache = { status: "ok", details: { online_drivers: driverCache.size } };

  const totalConnections = (pool as any).totalCount ?? 0;
  const idleConnections = (pool as any).idleCount ?? 0;
  const waitingClients = (pool as any).waitingCount ?? 0;
  checks.pg_pool = {
    status: waitingClients > 10 ? "warning" : "ok",
    details: { total: totalConnections, idle: idleConnections, waiting: waitingClients }
  };

  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const loadAvg = os.loadavg();

  res.status(allOk ? 200 : 503).json({
    status: allOk ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.round(uptime),
    response_time_ms: Date.now() - start,
    memory: {
      heap_used_mb: Math.round(mem.heapUsed / 1048576),
      heap_total_mb: Math.round(mem.heapTotal / 1048576),
      rss_mb: Math.round(mem.rss / 1048576),
      external_mb: Math.round(mem.external / 1048576),
    },
    cpu_load: loadAvg.map(l => Math.round(l * 100) / 100),
    checks,
  });
});

export default router;
