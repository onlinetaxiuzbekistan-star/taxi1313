import { initSentry } from "./lib/sentry.js";
import { startListingsCleanupScheduler } from "./lib/listings-cleanup.js";
initSentry();
import http from "http";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { setupWebSocket, forceLogoutDriver } from "./lib/websocket.js";
import { onForceLogout, setSessionCacheInvalidator } from "./routes/auth.js";
import { invalidateSessionCache } from "./middlewares/auth.js";
import { loadSettingsCache } from "./lib/settingsCache.js";
import { startPhotoScheduler } from "./lib/photo-scheduler.js";
import { warmupModels } from "./lib/photo-ai-validator.js";
import { startMemoryGuardian } from "./lib/memory-guardian.js";
import { seedDatabase } from "./lib/seed.js";
import { startAutoCancelScheduler } from "./lib/order-auto-cancel.js";

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
    warmupModels().catch(() => {});
  });
});
