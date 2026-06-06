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
import { warmupPhotoWorker, stopPhotoWorker } from "./lib/photo-ai-runner.js";
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

/**
 * One structured line capturing the full effective runtime configuration at
 * boot — versions, port, and which optional integrations are actually wired.
 * No secrets are logged (only booleans / summaries), so it's safe in prod and
 * invaluable for "what config is this instance actually running?" debugging.
 */
function logStartupSummary(): void {
  logger.info(
    {
      app: "taxi-1313-api",
      version: config.appVersion,
      env: config.nodeEnv,
      node: process.version,
      pid: process.pid,
      port,
      database: config.databaseUrl ? summarizeDatabaseUrl(config.databaseUrl) : "NOT SET",
      redis: config.redisUrl ? "configured" : "NOT SET",
      gc: typeof global.gc === "function" ? "exposed" : "unavailable (add --expose-gc)",
      integrations: {
        sentry: config.sentry.dsn ? "enabled" : "disabled",
        webPush: config.vapid.publicKey && config.vapid.privateKey ? "configured" : "disabled",
        telegram: config.telegram.botToken ? "configured" : "disabled",
        trustProxy: config.trustProxy,
        simulation: config.simulationEnabled,
      },
    },
    "Startup configuration summary",
  );
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
    logStartupSummary();
    startPhotoScheduler();
    startAutoCancelScheduler();
    startListingsCleanupScheduler();
    startMemoryGuardian();
    startDispatchSweep();
    startWorkers();
    warmupPhotoWorker().catch(() => {});
  });
}).catch((err) => {
  logger.warn({ err }, "Startup pre-load failed, starting anyway");
  server.listen(port, () => {
    logger.info({ port }, "Server listening (will retry on next request)");
    logStartupSummary();
    startPhotoScheduler();
    startAutoCancelScheduler();
    startListingsCleanupScheduler();
    startMemoryGuardian();
    startDispatchSweep();
    startWorkers();
    warmupPhotoWorker().catch(() => {});
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

    // Per-step timing so a slow drain step is visible in the logs.
    const step = async (name: string, fn: () => Promise<void> | void) => {
      const t0 = Date.now();
      try {
        await fn();
        logger.info({ step: name, ms: Date.now() - t0 }, "shutdown step done");
      } catch (e) {
        logger.error({ step: name, ms: Date.now() - t0, err: e }, "shutdown step failed");
      }
    };

    // 1b) Drain BullMQ workers/queue (finishes in-flight jobs, closes its own Redis conns).
    await step("bullmq", () => stopWorkers());

    // 1c) Terminate the photo-AI worker thread (holds TF/OCR models).
    await step("photo-worker", () => stopPhotoWorker());

    // 2) Close WebSocket clients FIRST (1001 going-away). This MUST happen before
    // server.close(): server.close() waits for every open connection to end, and
    // drivers hold persistent WS upgrades — closing them after would block the
    // drain until the force-timeout (the cause of the shutdown hangs).
    await step("websocket", () => closeWebSocket());

    // 3) Stop accepting new HTTP connections; drain in-flight requests, then drop
    // any lingering keep-alive sockets so close() can't hang.
    await step("http", () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections?.();
      // give in-flight requests a moment, then force-drop remaining keep-alives
      setTimeout(() => server.closeAllConnections?.(), 3000).unref();
    }));

    // 4) Drain the PostgreSQL pool (waits for active queries).
    await step("postgres", () => pool.end());

    // 5) Close Redis.
    await step("redis", async () => { try { await redis.quit(); } catch { redis.disconnect(); } });

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
