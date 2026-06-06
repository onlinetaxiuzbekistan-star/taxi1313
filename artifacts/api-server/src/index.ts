import { initSentry, captureError, Sentry } from "./lib/sentry.js";
import { startListingsCleanupScheduler, stopListingsCleanupScheduler } from "./lib/listings-cleanup.js";
initSentry();
import http from "http";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { setupWebSocket, forceLogoutDriver, closeWebSocket } from "./lib/websocket.js";
import { onForceLogout, setSessionCacheInvalidator } from "./routes/auth.js";
import { invalidateSessionCache } from "./middlewares/auth.js";
import { loadSettingsCache } from "./lib/settingsCache.js";
import { startPhotoScheduler, stopPhotoScheduler } from "./lib/photo-scheduler.js";
import { warmupModels } from "./lib/photo-ai-validator.js";
import { startMemoryGuardian, stopMemoryGuardian } from "./lib/memory-guardian.js";
import { seedDatabase } from "./lib/seed.js";
import { startAutoCancelScheduler, stopAutoCancelScheduler } from "./lib/order-auto-cancel.js";
import { startDispatchSweep, stopDispatchSweep } from "./lib/autodispatch.js";
import { startWorkers, stopWorkers } from "./lib/queues/workers.js";
import { stopIdempotencyCleanup } from "./lib/idempotency.js";
import { stopDriverCacheSync } from "./lib/driver-cache.js";
import { stopDriverQueueTimers } from "./lib/driver-queue.js";
import { stopPerfCacheCleanup } from "./lib/perf-cache.js";
import { stopRevenueAiCleanup } from "./lib/revenue-ai-prod.js";
import { pool, onPoolError } from "@workspace/db";
import { redis } from "./lib/redis.js";
import { config } from "./lib/config.js";

// An idle-client error from the pg pool would otherwise become an
// uncaughtException; capture it to Sentry with structured logging instead.
onPoolError((err) => {
  logger.error({ err }, "PostgreSQL pool error");
  captureError(err, { source: "pg_pool" });
});

function summarizeDatabaseUrl(url: string): string {
  const host = url.match(/@([^/?:]+)/)?.[1] || "unknown";
  const name = url.split("/").pop()?.split("?")[0] || "unknown";
  return `${host}/${name}`;
}

logger.info(
  {
    env: config.nodeEnv,
    db: config.databaseUrl ? summarizeDatabaseUrl(config.databaseUrl) : "NOT SET",
  },
  "Такси 1313 server starting",
);

const port = config.port;
if (!port) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const server = http.createServer(app);
setupWebSocket(server);

onForceLogout((driverId, reason) => {
  forceLogoutDriver(driverId, reason);
});

setSessionCacheInvalidator((driverId) => {
  invalidateSessionCache(driverId);
});

seedDatabase().then(() => {
  return loadSettingsCache();
}).then(() => {
  server.listen(port, (err?: Error) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening with WebSocket support");
    startPhotoScheduler();
    startAutoCancelScheduler();
    startListingsCleanupScheduler();
    startMemoryGuardian();
    startDispatchSweep();
    startWorkers();
    warmupModels().catch(() => {});
  });
}).catch((err) => {
  logger.warn({ err }, "Startup pre-load failed, starting anyway");
  server.listen(port, () => {
    logger.info({ port }, "Server listening (will retry on next request)");
    startPhotoScheduler();
    startAutoCancelScheduler();
    startListingsCleanupScheduler();
    startMemoryGuardian();
    startDispatchSweep();
    startWorkers();
    warmupModels().catch(() => {});
  });
});

// ───────────────────────── Graceful shutdown ─────────────────────────
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Graceful shutdown started");

  // Hard cap: must finish before systemd's TimeoutStopSec (30s) sends SIGKILL.
  const force = setTimeout(() => {
    logger.error("Graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 25_000);
  force.unref();

  try {
    // 1) Stop background schedulers so no new work/queries start mid-shutdown.
    stopPhotoScheduler();
    stopAutoCancelScheduler();
    stopListingsCleanupScheduler();
    stopMemoryGuardian();
    stopDispatchSweep(); // also clears the acked-offer prune timer

    // 1a) Stop module-scope interval timers so they don't fire DB/Redis work
    // during the drain window after the pool/redis begin closing.
    stopIdempotencyCleanup();
    stopDriverCacheSync();
    stopDriverQueueTimers();
    stopPerfCacheCleanup();
    stopRevenueAiCleanup();
    // (websocket call-timeout sweep is cleared inside closeWebSocket below)

    // 1b) Drain BullMQ workers/queue (finishes in-flight jobs, closes its own Redis conns).
    await stopWorkers();

    // 2) Stop accepting new HTTP connections; wait for in-flight requests to finish.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeIdleConnections?.();

    // 3) Close WebSocket clients (1001 going-away) and the WS server.
    await closeWebSocket();

    // 4) Drain the PostgreSQL pool (waits for active queries).
    await pool.end();

    // 5) Close Redis.
    try { await redis.quit(); } catch { redis.disconnect(); }

    clearTimeout(force);
    logger.info("Graceful shutdown complete");
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "Error during graceful shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });

// ───────────────────────── Process-level safety net ─────────────────────────
// Without these, an error outside the request lifecycle (timer callback, event
// emitter, stray promise) is invisible and may crash the process unreported.

// Unhandled rejection: log + capture, but keep serving — it's a logged defect,
// not necessarily a fatal state.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
  captureError(reason, { source: "unhandledRejection" });
});

// Uncaught exception: the process state is undefined — capture, flush to Sentry,
// then exit so systemd restarts us cleanly (avoids running further work on a
// corrupted state).
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — flushing and exiting");
  captureError(err, { source: "uncaughtException" });
  void Sentry.flush(2000).then(() => process.exit(1)).catch(() => process.exit(1));
});
