import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 200, 3000);
  },
  lazyConnect: false,
});

redis.on("connect", () => console.log("[REDIS] Connected"));
redis.on("error", (err) => console.error("[REDIS] Error:", err.message));

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
