import Redis from "ioredis";
import { clog } from "./logger.js";
import { config } from "./config.js";

const REDIS_URL = config.redisUrl;

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 200, 3000);
  },
  lazyConnect: false,
});

redis.on("connect", () => clog.log("[REDIS] Connected"));
redis.on("error", (err) => clog.error("[REDIS] Error:", err.message));

export async function getRedisJson<T>(key: string): Promise<T | null> {
  const val = await redis.get(key);
  return val ? JSON.parse(val) : null;
}

export async function setRedisJson(key: string, data: unknown, ttlSec?: number): Promise<void> {
  const json = JSON.stringify(data);
  if (ttlSec) {
    await redis.setex(key, ttlSec, json);
  } else {
    await redis.set(key, json);
  }
}
