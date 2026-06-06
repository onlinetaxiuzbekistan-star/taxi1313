import { Router, type IRouter, type Request, type Response } from "express";
import os from "os";
import fs from "fs";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { authMiddleware, requireRole } from "../middlewares/auth.js";
import { getWsStats } from "../lib/websocket.js";
import { getPerfStats, getSlowQueries } from "../lib/perf-cache.js";
import { getQueueMetrics } from "../lib/driver-queue.js";

const router: IRouter = Router();

const loadRateLimit = new Map<string, number>();
const LOAD_RATE_LIMIT_MS = 2000;

function rateLimit(req: Request, res: Response): boolean {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const now = Date.now();
  const last = loadRateLimit.get(ip) || 0;
  if (now - last < LOAD_RATE_LIMIT_MS) {
    res.status(429).json({ error: "Too many requests" });
    return false;
  }
  loadRateLimit.set(ip, now);
  if (loadRateLimit.size > 1000) {
    const entries = [...loadRateLimit.entries()];
    for (const [k, v] of entries) {
      if (now - v > 60000) loadRateLimit.delete(k);
    }
  }
  return true;
}

function readMeminfo(): {
  total: number;
  realUsed: number;
  cache: number;
  free: number;
  buffers: number;
  cached: number;
  usedPercent: number;
  cachePercent: number;
  freePercent: number;
} {
  let totalMem = os.totalmem();
  let freeMem = os.freemem();
  let buffers = 0;
  let cached = 0;
  let realUsed = totalMem - freeMem;

  try {
    const meminfo = fs.readFileSync("/proc/meminfo", "utf-8");
    const lines = meminfo.split("\n");
    const parse = (key: string): number => {
      const line = lines.find(l => l.startsWith(key + ":"));
      if (!line) return 0;
      const match = line.match(/(\d+)/);
      return match ? parseInt(match[1]) * 1024 : 0;
    };
    totalMem = parse("MemTotal") || totalMem;
    freeMem = parse("MemFree") || freeMem;
    buffers = parse("Buffers");
    const sReclaimable = parse("SReclaimable");
    const shmem = parse("Shmem");
    cached = parse("Cached") + sReclaimable - shmem;
    if (cached < 0) cached = parse("Cached");
    realUsed = totalMem - freeMem - buffers - cached;
    if (realUsed < 0) realUsed = totalMem - freeMem;
  } catch {}

  const usedPercent = totalMem > 0 ? Math.round((realUsed / totalMem) * 1000) / 10 : 0;
  const cachePercent = totalMem > 0 ? Math.round(((buffers + cached) / totalMem) * 1000) / 10 : 0;
  const freePercent = totalMem > 0 ? Math.round((freeMem / totalMem) * 1000) / 10 : 0;

  return {
    total: totalMem,
    realUsed,
    cache: buffers + cached,
    free: freeMem,
    buffers,
    cached,
    usedPercent,
    cachePercent,
    freePercent,
  };
}

router.get("/load", async (req, res) => {
  if (!rateLimit(req, res)) return;
  try {
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;
    const cpuPct = Math.min(100, Math.round((loadAvg[0] / cpuCount) * 100 * 10) / 10);
    const mem = process.memoryUsage();
    const ram = readMeminfo();
    const wsStats = getWsStats();
    const perfStats = getPerfStats();

    let pgStats = { activeConnections: 0, dbSizeMB: 0, cacheHitRatio: 0 };
    try {
      const connResult = await db.execute(sql`SELECT count(*)::int as cnt FROM pg_stat_activity WHERE state = 'active'`);
      const connRows = (connResult as any).rows ?? connResult;
      pgStats.activeConnections = Number(connRows?.[0]?.cnt ?? 0);

      const sizeResult = await db.execute(sql`SELECT pg_database_size(current_database())::bigint as sz`);
      const sizeRows = (sizeResult as any).rows ?? sizeResult;
      pgStats.dbSizeMB = Math.round(Number(sizeRows?.[0]?.sz ?? 0) / 1024 / 1024 * 10) / 10;

      const cacheResult = await db.execute(sql`
        SELECT CASE WHEN sum(blks_hit) > 0
          THEN round(sum(blks_hit)::numeric / (sum(blks_hit) + sum(blks_read)) * 100, 1)
          ELSE 0 END as ratio
        FROM pg_stat_database WHERE datname = current_database()
      `);
      const cacheRows = (cacheResult as any).rows ?? cacheResult;
      pgStats.cacheHitRatio = Number(cacheRows?.[0]?.ratio ?? 0);
    } catch {}

    res.json({
      cpu: cpuPct,
      cpuCores: cpuCount,
      loadAvg: loadAvg.map(v => Math.round(v * 100) / 100),
      memory: {
        total: ram.total,
        realUsed: ram.realUsed,
        cache: ram.cache,
        free: ram.free,
        usedPercent: ram.usedPercent,
        cachePercent: ram.cachePercent,
        freePercent: ram.freePercent,
        totalMB: Math.round(ram.total / 1024 / 1024),
        freeMB: Math.round(ram.free / 1024 / 1024),
        usedPct: ram.usedPercent,
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
        rssMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
      },
      activeUsers: wsStats.authenticatedClients,
      activeDrivers: wsStats.driverSessions,
      rps: perfStats.rps,
      dbPool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
      postgres: pgStats,
      cache: perfStats.cache,
      uptime: Math.round(process.uptime()),
      timestamp: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to collect load data" });
  }
});

router.use(authMiddleware, requireRole("dispatcher", "admin"));

router.get("/perf-stats", async (_req, res) => {
  const stats = getPerfStats();
  const slowQs = getSlowQueries();
  const poolStats = {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };

  let pgStats = { activeConnections: 0, dbSizeMB: 0, cacheHitRatio: 0, deadTuples: 0 };
  try {
    const connResult = await db.execute(sql`SELECT count(*)::int as cnt FROM pg_stat_activity WHERE state = 'active'`);
    const connRows = (connResult as any).rows ?? connResult;
    pgStats.activeConnections = Number(connRows?.[0]?.cnt ?? 0);

    const sizeResult = await db.execute(sql`SELECT pg_database_size(current_database())::bigint as sz`);
    const sizeRows = (sizeResult as any).rows ?? sizeResult;
    pgStats.dbSizeMB = Math.round(Number(sizeRows?.[0]?.sz ?? 0) / 1024 / 1024 * 10) / 10;

    const cacheResult = await db.execute(sql`
      SELECT CASE WHEN sum(blks_hit) > 0
        THEN round(sum(blks_hit)::numeric / (sum(blks_hit) + sum(blks_read)) * 100, 1)
        ELSE 0 END as ratio
      FROM pg_stat_database WHERE datname = current_database()
    `);
    const cacheRows = (cacheResult as any).rows ?? cacheResult;
    pgStats.cacheHitRatio = Number(cacheRows?.[0]?.ratio ?? 0);

    const deadResult = await db.execute(sql`SELECT coalesce(sum(n_dead_tup), 0)::int as dead FROM pg_stat_user_tables`);
    const deadRows = (deadResult as any).rows ?? deadResult;
    pgStats.deadTuples = Number(deadRows?.[0]?.dead ?? 0);
  } catch {}

  res.json({
    ...stats,
    slowQueries: { count: slowQs.length, recent: slowQs },
    dbPool: poolStats,
    postgres: pgStats,
    timestamp: Date.now(),
  });
});

router.get("/health", async (_req, res) => {
  try {
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;
    const cpuLoad = Math.min(100, Math.round((loadAvg[0] / cpuCount) * 100 * 10) / 10);
    const ram = readMeminfo();

    let diskInfo = { total: 0, used: 0, free: 0 };
    try {
      const dfOutput = fs.readFileSync("/proc/mounts", "utf-8");
      void dfOutput;
      const { execSync } = await import("child_process");
      const stdout = execSync("df -B1 / | tail -1", { encoding: "utf-8", timeout: 3000 });
      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 4) {
        diskInfo = {
          total: parseInt(parts[1]) || 0,
          used: parseInt(parts[2]) || 0,
          free: parseInt(parts[3]) || 0,
        };
      }
    } catch {}

    let dbStatus: "ok" | "error" = "error";
    try {
      await db.execute(sql`SELECT 1`);
      dbStatus = "ok";
    } catch {}

    const uptimeSeconds = os.uptime();

    const wsStats = getWsStats();
    const poolStats = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };

    res.json({
      cpu: {
        load: cpuLoad,
        cores: cpuCount,
        loadAvg: loadAvg.map(v => Math.round(v * 100) / 100),
      },
      memory: {
        total: ram.total,
        realUsed: ram.realUsed,
        cache: ram.cache,
        free: ram.free,
        buffers: ram.buffers,
        cached: ram.cached,
        usedPercent: ram.usedPercent,
        cachePercent: ram.cachePercent,
        freePercent: ram.freePercent,
      },
      disk: diskInfo,
      uptime: uptimeSeconds,
      services: {
        api: "ok" as const,
        websocket: "ok" as const,
        database: dbStatus,
      },
      websocket: wsStats,
      dbPool: poolStats,
      timestamp: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to collect system health" });
  }
});

router.get("/memory", async (_req, res) => {
  const mem = process.memoryUsage();
  const ram = readMeminfo();

  const rssAlertActive = mem.rss / 1024 / 1024 > 400;
  const heapPct = mem.heapTotal > 0 ? Math.round((mem.heapUsed / mem.heapTotal) * 1000) / 10 : 0;
  const heapAlertActive = heapPct > 80;

  res.json({
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    rss: mem.rss,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
    rssMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
    externalMB: Math.round(mem.external / 1024 / 1024 * 10) / 10,
    heapPct,
    alerts: {
      rss: rssAlertActive ? `RSS ${Math.round(mem.rss / 1024 / 1024)}MB > 400MB limit` : null,
      heap: heapAlertActive ? `Heap at ${heapPct}% > 80% threshold` : null,
    },
    system: {
      total: ram.total,
      realUsed: ram.realUsed,
      cache: ram.cache,
      free: ram.free,
      usedPercent: ram.usedPercent,
    },
  });
});

router.get("/performance", async (_req, res) => {
  const mem = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  const loopStart = performance.now();
  await new Promise(resolve => setImmediate(resolve));
  const eventLoopDelayMs = Math.round((performance.now() - loopStart) * 100) / 100;

  const activeHandles = (process as any)._getActiveHandles?.()?.length ?? -1;
  const activeRequests = (process as any)._getActiveRequests?.()?.length ?? -1;

  const wsStats = getWsStats();
  const poolStats = {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };

  const rssAlertActive = mem.rss / 1024 / 1024 > 400;
  const heapPct = mem.heapTotal > 0 ? Math.round((mem.heapUsed / mem.heapTotal) * 1000) / 10 : 0;
  const heapAlertActive = heapPct > 80;

  res.json({
    memory: {
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
      rssMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
      externalMB: Math.round(mem.external / 1024 / 1024 * 10) / 10,
      arrayBuffersMB: Math.round(mem.arrayBuffers / 1024 / 1024 * 10) / 10,
    },
    cpu: {
      userMicros: cpuUsage.user,
      systemMicros: cpuUsage.system,
    },
    eventLoopDelayMs,
    activeHandles,
    activeRequests,
    websocket: wsStats,
    dbPool: poolStats,
    uptime: process.uptime(),
    nodeVersion: process.version,
    pid: process.pid,
    maxOldSpaceMB: 512,
    alerts: {
      rss: rssAlertActive ? `RSS ${Math.round(mem.rss / 1024 / 1024)}MB exceeds 400MB` : null,
      heap: heapAlertActive ? `Heap ${heapPct}% exceeds 80%` : null,
    },
  });
});

router.get("/processes", async (_req, res) => {
  try {
    const { execSync } = await import("child_process");
    const stdout = execSync("ps -eo pid,comm,rss,%cpu --sort=-rss | head -30", { encoding: "utf-8", timeout: 3000 });
    const lines = stdout.trim().split("\n").slice(1);

    const raw: { pid: number; name: string; rssKB: number; cpu: number }[] = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const pid = parseInt(parts[0]);
      const name = parts[1];
      const rssKB = parseInt(parts[2]) || 0;
      const cpu = parseFloat(parts[3]) || 0;
      if (isNaN(pid)) continue;
      raw.push({ pid, name, rssKB, cpu });
    }

    const totalMemKB = os.totalmem() / 1024;

    const groups: Record<string, { cpu: number; rssKB: number; count: number }> = {
      node: { cpu: 0, rssKB: 0, count: 0 },
      postgres: { cpu: 0, rssKB: 0, count: 0 },
      system: { cpu: 0, rssKB: 0, count: 0 },
    };

    for (const p of raw) {
      const lower = p.name.toLowerCase();
      let group = "system";
      if (lower.includes("node") || lower.includes("esbuild") || lower.includes("tsx")) group = "node";
      else if (lower.includes("postgres") || lower.includes("pg_")) group = "postgres";
      groups[group].cpu += p.cpu;
      groups[group].rssKB += p.rssKB;
      groups[group].count++;
    }

    const nodeMem = process.memoryUsage();

    const top10 = raw.slice(0, 10).map(p => ({
      pid: p.pid,
      name: p.name,
      cpu: Math.round(p.cpu * 10) / 10,
      memory: totalMemKB > 0 ? Math.round((p.rssKB / totalMemKB) * 1000) / 10 : 0,
      rssMB: Math.round(p.rssKB / 1024 * 10) / 10,
      heapUsedMB: p.pid === process.pid ? Math.round(nodeMem.heapUsed / 1024 / 1024 * 10) / 10 : null,
    }));

    const ram = readMeminfo();

    const groupSummary = Object.entries(groups).map(([name, g]) => ({
      name,
      cpu: Math.round(g.cpu * 10) / 10,
      memory: totalMemKB > 0 ? Math.round((g.rssKB / totalMemKB) * 1000) / 10 : 0,
      rssMB: Math.round(g.rssKB / 1024 * 10) / 10,
      count: g.count,
    }));

    res.json({
      top: top10,
      groups: groupSummary,
      cache: {
        cached: ram.cached,
        buffers: ram.buffers,
        sReclaimable: 0,
        shmem: 0,
      },
      nodeProcess: {
        pid: process.pid,
        rssMB: Math.round(nodeMem.rss / 1024 / 1024 * 10) / 10,
        heapUsedMB: Math.round(nodeMem.heapUsed / 1024 / 1024 * 10) / 10,
        heapTotalMB: Math.round(nodeMem.heapTotal / 1024 / 1024 * 10) / 10,
        externalMB: Math.round(nodeMem.external / 1024 / 1024 * 10) / 10,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to collect process info" });
  }
});

router.get("/queue", async (_req, res) => {
  try {
    const m = getQueueMetrics();
    res.json(m);
  } catch (err) {
    res.status(500).json({ error: "Failed to get queue metrics" });
  }
});

export default router;
