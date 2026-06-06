import type { RedisOptions } from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// BullMQ uses blocking Redis commands (BRPOPLPUSH etc.) on the worker side,
// which require `maxRetriesPerRequest: null`. We hand BullMQ connection
// *options* (not a shared instance) so each Queue/Worker owns and cleanly
// closes its own connection on .close() during graceful shutdown.
function parseConnectionOptions(url: string): RedisOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.pathname && u.pathname.length > 1 ? { db: Number(u.pathname.slice(1)) } : {}),
    ...(u.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      return Math.min(times * 200, 3000);
    },
  };
}

export const bullConnection: RedisOptions = parseConnectionOptions(REDIS_URL);
