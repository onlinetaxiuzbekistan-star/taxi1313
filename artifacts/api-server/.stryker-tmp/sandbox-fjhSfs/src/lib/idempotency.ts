// @ts-nocheck
import { db, idempotencyKeysTable } from "@workspace/db";
import { clog } from "./logger.js";
import { eq, lt } from "drizzle-orm";

const TTL_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL = 60 * 1000;

interface CacheEntry {
  status: number;
  body: any;
  rideVersion: number | null;
  ts: number;
}

const memCache = new Map<string, CacheEntry>();

let cleanupTimer: ReturnType<typeof setInterval> | null = setInterval(async () => {
  const cutoff = new Date(Date.now() - TTL_MS);
  try {
    await db.delete(idempotencyKeysTable).where(lt(idempotencyKeysTable.createdAt, cutoff));
  } catch {}
  const now = Date.now();
  for (const [k, v] of memCache) {
    if (now - v.ts > TTL_MS) memCache.delete(k);
  }
}, CLEANUP_INTERVAL);

export function stopIdempotencyCleanup(): void {
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
}

export function idempotencyKey(driverId: number, action: string, actionId: string): string {
  return `${driverId}:${action}:${actionId}`;
}

export async function getIdempotentResult(key: string): Promise<{ status: number; body: any; rideVersion: number | null; replayed: true } | null> {
  const mem = memCache.get(key);
  if (mem && Date.now() - mem.ts < TTL_MS) {
    return { status: mem.status, body: mem.body, rideVersion: mem.rideVersion, replayed: true };
  }

  try {
    const [row] = await db.select().from(idempotencyKeysTable).where(eq(idempotencyKeysTable.key, key));
    if (!row) return null;
    if (Date.now() - row.createdAt.getTime() > TTL_MS) return null;
    memCache.set(key, { status: row.status, body: row.response, rideVersion: row.rideVersion, ts: row.createdAt.getTime() });
    return { status: row.status, body: row.response, rideVersion: row.rideVersion, replayed: true };
  } catch {
    return null;
  }
}

import { registerCache } from "./memory-guardian.js";
registerCache(() => {
  const before = memCache.size;
  memCache.clear();
  return { name: "idempotency", cleared: before };
});

export async function storeIdempotentResult(key: string, driverId: number, action: string, status: number, body: any, rideVersion?: number | null): Promise<void> {
  const rv = rideVersion ?? null;
  memCache.set(key, { status, body, rideVersion: rv, ts: Date.now() });
  try {
    await db.insert(idempotencyKeysTable).values({
      key,
      driverId,
      action,
      status,
      response: body,
      rideVersion: rv,
    }).onConflictDoNothing();
  } catch (err) {
    clog.error("[IDEMPOTENCY] DB store failed:", (err as Error).message);
  }
}
