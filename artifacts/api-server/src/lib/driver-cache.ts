import { db, usersTable, driverGroupsTable } from "@workspace/db";
import { clog } from "./logger.js";
import { eq, and, inArray } from "drizzle-orm";
import { redis } from "./redis.js";

const DRIVER_GPS_KEY = "taxi:driver:gps:";
const DRIVER_GPS_TTL = 300;

export interface CachedDriver {
  id: number;
  lat: number;
  lng: number;
  status: "online" | "offline" | "busy";
  groupId: number | null;
  groupLevel: number;
  rating: number;
  acceptedOrders: number;
  cancelledOrders: number;
  consecutiveIgnores: number;
  balance: number;
  seats: number;
  lastActive: number;
  name: string | null;
  phone: string | null;
  activityScore: number;
  city?: string | null;
}

const driverCache = new Map<number, CachedDriver>();
const groupLevelCache = new Map<number, number>();
let lastFullSync = 0;
const FULL_SYNC_INTERVAL_MS = 30_000;

export function getDriverCache(): Map<number, CachedDriver> {
  return driverCache;
}

export function getCachedDriver(driverId: number): CachedDriver | undefined {
  return driverCache.get(driverId);
}

export function updateDriverLocation(driverId: number, lat: number, lng: number) {
  const d = driverCache.get(driverId);
  if (d) {
    d.lat = lat;
    d.lng = lng;
    d.lastActive = Date.now();
  }
  redis.setex(DRIVER_GPS_KEY + driverId, DRIVER_GPS_TTL, JSON.stringify({ lat, lng, ts: Date.now() })).catch(() => {});
}

export function updateDriverStatus(driverId: number, status: "online" | "offline" | "busy") {
  const d = driverCache.get(driverId);
  if (d) {
    d.status = status;
    d.lastActive = Date.now();
    if (status === "offline") {
      driverCache.delete(driverId);
      redis.del(DRIVER_GPS_KEY + driverId).catch(() => {});
    }
  }
}

export function removeDriver(driverId: number) {
  driverCache.delete(driverId);
  redis.del(DRIVER_GPS_KEY + driverId).catch(() => {});
}

export function getOnlineDrivers(): CachedDriver[] {
  return Array.from(driverCache.values()).filter(
    d => d.status === "online" || d.status === "busy"
  );
}

export function getGroupLevel(groupId: number | null): number {
  if (!groupId) return 1;
  return groupLevelCache.get(groupId) ?? 1;
}

export async function restoreDriverGPSFromRedis(): Promise<void> {
  try {
    const keys = await redis.keys(DRIVER_GPS_KEY + "*");
    let restored = 0;
    for (const key of keys) {
      const val = await redis.get(key);
      if (!val) continue;
      const driverId = parseInt(key.replace(DRIVER_GPS_KEY, ""), 10);
      const data = JSON.parse(val);
      const d = driverCache.get(driverId);
      if (d && (!d.lat || !d.lng)) {
        d.lat = data.lat;
        d.lng = data.lng;
        d.lastActive = data.ts || Date.now();
        restored++;
      }
    }
    if (restored > 0) {
      clog.log(`[DRIVER CACHE] Restored ${restored} GPS positions from Redis`);
    }
  } catch (err) {
    clog.error("[DRIVER CACHE] Redis GPS restore failed:", (err as Error).message);
  }
}

export async function syncDriverCache(): Promise<void> {
  const now = Date.now();
  if (now - lastFullSync < FULL_SYNC_INTERVAL_MS) return;
  lastFullSync = now;

  try {
    const groups = await db.select().from(driverGroupsTable);
    groupLevelCache.clear();
    for (const g of groups) {
      groupLevelCache.set(g.id, g.level);
    }

    const drivers = await db
      .select({
        id: usersTable.id,
        lat: usersTable.lat,
        lng: usersTable.lng,
        status: usersTable.status,
        groupId: usersTable.groupId,
        rating: usersTable.rating,
        acceptedOrders: usersTable.acceptedOrders,
        cancelledOrders: usersTable.cancelledOrders,
        consecutiveIgnores: usersTable.consecutiveIgnores,
        balance: usersTable.balance,
        seats: usersTable.seats,
        lastLocationUpdate: usersTable.lastLocationUpdate,
        name: usersTable.name,
        phone: usersTable.phone,
        activityScore: usersTable.activityScore,
      })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, "driver"),
          inArray(usersTable.status, ["online", "busy"])
        )
      );

    const currentIds = new Set<number>();
    for (const d of drivers) {
      currentIds.add(d.id);
      const existing = driverCache.get(d.id);
      driverCache.set(d.id, {
        id: d.id,
        lat: existing?.lat ?? (d.lat ? Number(d.lat) : 0),
        lng: existing?.lng ?? (d.lng ? Number(d.lng) : 0),
        status: d.status as "online" | "busy",
        groupId: d.groupId,
        groupLevel: d.groupId ? (groupLevelCache.get(d.groupId) ?? 1) : 1,
        rating: d.rating ?? 5.0,
        acceptedOrders: d.acceptedOrders ?? 0,
        cancelledOrders: d.cancelledOrders ?? 0,
        consecutiveIgnores: d.consecutiveIgnores ?? 0,
        balance: parseFloat(d.balance?.toString() || "0"),
        seats: d.seats || 4,
        lastActive: existing?.lastActive ?? (d.lastLocationUpdate ? new Date(d.lastLocationUpdate).getTime() : Date.now()),
        name: d.name,
        phone: d.phone,
        activityScore: d.activityScore ?? 50,
      });
    }

    for (const [id] of driverCache) {
      if (!currentIds.has(id)) {
        driverCache.delete(id);
      }
    }

    clog.log(`[DRIVER CACHE] synced ${driverCache.size} online/busy drivers, ${groupLevelCache.size} groups`);

    await restoreDriverGPSFromRedis();

    try {
      const { enqueueDriver, removeFromQueue, getFullQueue } = await import("./driver-queue.js");
      const queueIds = new Set(getFullQueue().map(e => e.driverId));
      for (const id of currentIds) {
        if (!queueIds.has(id)) {
          enqueueDriver(id);
        }
      }
      for (const id of queueIds) {
        if (!currentIds.has(id)) {
          removeFromQueue(id);
        }
      }
    } catch {}
  } catch (err) {
    clog.error("[DRIVER CACHE] sync failed:", (err as Error).message);
  }
}

syncDriverCache();
let syncTimer: ReturnType<typeof setInterval> | null = setInterval(syncDriverCache, FULL_SYNC_INTERVAL_MS);

export function stopDriverCacheSync(): void {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
}
