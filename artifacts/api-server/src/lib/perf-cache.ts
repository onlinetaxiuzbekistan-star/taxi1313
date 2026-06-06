import { registerCache } from "./memory-guardian.js";
import { clog } from "./logger.js";
import type { Request, Response, NextFunction } from "express";

const RPS_WINDOW_MS = 60_000;
const RPS_BUCKET_MS = 1_000;
const MAX_BUCKETS = Math.ceil(RPS_WINDOW_MS / RPS_BUCKET_MS);
const MAX_ENDPOINT_KEYS = 200;

interface RpsBucket {
  ts: number;
  count: number;
}

const globalBuckets: RpsBucket[] = [];
const endpointBuckets = new Map<string, RpsBucket[]>();

let totalRequests = 0;
let cacheHits = 0;
let cacheMisses = 0;
let totalSlowQueryCount = 0;

function currentBucketTs(): number {
  return Math.floor(Date.now() / RPS_BUCKET_MS) * RPS_BUCKET_MS;
}

function addToBuckets(buckets: RpsBucket[]) {
  const ts = currentBucketTs();
  const last = buckets[buckets.length - 1];
  if (last && last.ts === ts) {
    last.count++;
  } else {
    buckets.push({ ts, count: 1 });
    if (buckets.length > MAX_BUCKETS) buckets.shift();
  }
}

function computeRps(buckets: RpsBucket[]): number {
  const now = Date.now();
  const cutoff = now - RPS_WINDOW_MS;
  let total = 0;
  for (const b of buckets) {
    if (b.ts >= cutoff) total += b.count;
  }
  return Math.round((total / (RPS_WINDOW_MS / 1000)) * 10) / 10;
}

function normalizePath(path: string): string {
  return path
    .replace(/\/\d+/g, "/:id")
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:uuid")
    .replace(/\/[0-9a-f]{24,}/gi, "/:hash");
}

export function trackRequest(endpoint?: string) {
  totalRequests++;
  addToBuckets(globalBuckets);
  if (endpoint) {
    if (endpointBuckets.size >= MAX_ENDPOINT_KEYS && !endpointBuckets.has(endpoint)) {
      return;
    }
    let ep = endpointBuckets.get(endpoint);
    if (!ep) {
      ep = [];
      endpointBuckets.set(endpoint, ep);
    }
    addToBuckets(ep);
  }
}

export function rpsMiddleware(req: Request, _res: Response, next: NextFunction) {
  const path = normalizePath(req.path);
  trackRequest(path);
  next();
}

interface CacheEntry {
  data: any;
  expiresAt: number;
  createdAt: number;
}

const responseCache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 5_000;

export function cachedEndpoint(ttlMs: number = DEFAULT_TTL_MS) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") return next();

    const key = `${req.originalUrl}`;
    const entry = responseCache.get(key);

    if (entry && entry.expiresAt > Date.now()) {
      cacheHits++;
      res.setHeader("X-Cache", "HIT");
      res.setHeader("X-Cache-Age", String(Math.round((Date.now() - entry.createdAt) / 1000)));
      return res.json(entry.data);
    }

    cacheMisses++;

    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        responseCache.set(key, {
          data: body,
          expiresAt: Date.now() + ttlMs,
          createdAt: Date.now(),
        });
      }
      res.setHeader("X-Cache", "MISS");
      return originalJson(body);
    };

    next();
  };
}

interface SlowQuery {
  query: string;
  durationMs: number;
  ts: number;
}

const slowQueries: SlowQuery[] = [];
// Log/track any query slower than 50ms (configurable via SLOW_QUERY_MS).
const SLOW_QUERY_THRESHOLD_MS = Number(process.env.SLOW_QUERY_MS) || 50;
const MAX_SLOW_QUERIES = 100;

export function logSlowQuery(query: string, durationMs: number) {
  if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
    totalSlowQueryCount++;
    slowQueries.push({
      query: query.substring(0, 200),
      durationMs: Math.round(durationMs * 10) / 10,
      ts: Date.now(),
    });
    if (slowQueries.length > MAX_SLOW_QUERIES) slowQueries.shift();
    clog.log(`[SLOW QUERY] ${Math.round(durationMs)}ms: ${query.substring(0, 100)}`);
  }
}

export function getSlowQueries(): SlowQuery[] {
  return slowQueries.slice(-20);
}

export function getPerfStats() {
  const topEndpoints: { path: string; rps: number }[] = [];
  for (const [path, buckets] of endpointBuckets) {
    topEndpoints.push({ path, rps: computeRps(buckets) });
  }
  topEndpoints.sort((a, b) => b.rps - a.rps);

  return {
    rps: computeRps(globalBuckets),
    totalRequests,
    topEndpoints: topEndpoints.slice(0, 10),
    cache: {
      entries: responseCache.size,
      hits: cacheHits,
      misses: cacheMisses,
      hitRate: cacheHits + cacheMisses > 0
        ? Math.round((cacheHits / (cacheHits + cacheMisses)) * 1000) / 10
        : 0,
    },
    slowQueries: {
      count: totalSlowQueryCount,
      recent: slowQueries.slice(-5),
    },
  };
}

registerCache(() => {
  const cleared = responseCache.size;
  responseCache.clear();
  endpointBuckets.clear();
  globalBuckets.length = 0;
  return { name: "perf-cache", cleared };
});

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    if (entry.expiresAt < now) responseCache.delete(key);
  }
  const cutoff = now - RPS_WINDOW_MS;
  for (const [path, buckets] of endpointBuckets) {
    while (buckets.length > 0 && buckets[0].ts < cutoff) buckets.shift();
    if (buckets.length === 0) endpointBuckets.delete(path);
  }
  while (globalBuckets.length > 0 && globalBuckets[0].ts < cutoff) globalBuckets.shift();
}, 30_000);
cleanupTimer.unref();

export function stopPerfCacheCleanup(): void {
  clearInterval(cleanupTimer);
}
