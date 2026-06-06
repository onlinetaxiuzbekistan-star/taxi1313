import { initSentry } from "./lib/sentry.js";
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
import { pool } from "@workspace/db";
import { redis } from "./lib/redis.js";

function summarizeDatabaseUrl(url: string): string {
  const host = url.match(/@([^/?:]+)/)?.[1] || "unknown";
  const name = url.split("/").pop()?.split("?")[0] || "unknown";
  return `${host}/${name}`;
}

console.log("=== Такси 1313 Server Starting ===");
console.log("ENV:", process.env.NODE_ENV || "not set");
console.log(
  "DB:",
  process.env.DATABASE_URL
    ? `configured (${summarizeDatabaseUrl(process.env.DATABASE_URL)})`
    : "WARNING: DATABASE_URL not set!",
);
console.log("===============================");

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
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
    stopDispatchSweep();

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
