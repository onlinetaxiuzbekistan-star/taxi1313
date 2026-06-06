import { isUserOnline } from "./websocket.js";
import { getCachedDriver, type CachedDriver } from "./driver-cache.js";
import { registerCache } from "./memory-guardian.js";
import { db, ridesTable, ridePassengersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

interface QueueEntry {
  driverId: number;
  joinedAt: number;
  lastOfferedAt: number;
  skippedCount: number;
}

const queue: QueueEntry[] = [];

const metrics = {
  totalEnqueued: 0,
  totalDequeued: 0,
  totalSkipped: 0,
  totalRotated: 0,
  totalAssigned: 0,
  avgAssignTimeMs: 0,
  assignTimes: [] as number[],
};

registerCache(() => {
  const count = metrics.assignTimes.length;
  metrics.assignTimes = [];
  return { name: "driver-queue-metrics", cleared: count };
});

export function enqueueDriver(driverId: number) {
  const idx = queue.findIndex(e => e.driverId === driverId);
  if (idx !== -1) return;
  queue.push({
    driverId,
    joinedAt: Date.now(),
    lastOfferedAt: 0,
    skippedCount: 0,
  });
  metrics.totalEnqueued++;
  console.log(`[QUEUE] driver ${driverId} added to queue (pos=${queue.length}), total=${queue.length}`);
}

export function removeFromQueue(driverId: number) {
  const idx = queue.findIndex(e => e.driverId === driverId);
  if (idx !== -1) {
    queue.splice(idx, 1);
    metrics.totalDequeued++;
    console.log(`[QUEUE] driver ${driverId} removed from queue, total=${queue.length}`);
  }
}

export function moveToEnd(driverId: number) {
  const idx = queue.findIndex(e => e.driverId === driverId);
  if (idx === -1) return;
  const [entry] = queue.splice(idx, 1);
  entry.skippedCount++;
  entry.lastOfferedAt = Date.now();
  queue.push(entry);
  metrics.totalRotated++;
  console.log(`[QUEUE] driver ${driverId} rotated to end (skips=${entry.skippedCount}), total=${queue.length}`);
}

export function markAssigned(driverId: number, assignTimeMs: number) {
  removeFromQueue(driverId);
  metrics.totalAssigned++;
  metrics.assignTimes.push(assignTimeMs);
  if (metrics.assignTimes.length > 200) metrics.assignTimes = metrics.assignTimes.slice(-200);
  const sum = metrics.assignTimes.reduce((a, b) => a + b, 0);
  metrics.avgAssignTimeMs = Math.round(sum / metrics.assignTimes.length);
  console.log(`[QUEUE] driver ${driverId} assigned (time=${assignTimeMs}ms, avg=${metrics.avgAssignTimeMs}ms)`);
}

export function returnToQueue(driverId: number) {
  removeFromQueue(driverId);
  queue.push({
    driverId,
    joinedAt: Date.now(),
    lastOfferedAt: 0,
    skippedCount: 0,
  });
  console.log(`[QUEUE] driver ${driverId} returned to queue end (ride complete), total=${queue.length}`);
}

export function getQueuePosition(driverId: number): number {
  const idx = queue.findIndex(e => e.driverId === driverId);
  return idx === -1 ? -1 : idx + 1;
}

export function getQueueSize(): number {
  return queue.length;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface QueueCandidate {
  driver: CachedDriver;
  queuePosition: number;
  distanceKm: number;
  freeSeats: number;
  score: number;
}

const driverOccupiedSeats = new Map<number, number>();

export async function refreshOccupiedSeats(): Promise<void> {
  try {
    const activeRides = await db
      .select({
        driverId: ridesTable.driverId,
        rideId: ridesTable.id,
      })
      .from(ridesTable)
      .where(
        and(
          sql`${ridesTable.driverId} IS NOT NULL`,
          sql`${ridesTable.status} IN ('accepted', 'in_progress')`,
        )
      );

    const driverRideIds = new Map<number, number[]>();
    for (const r of activeRides) {
      if (!r.driverId) continue;
      const arr = driverRideIds.get(r.driverId) || [];
      arr.push(r.rideId);
      driverRideIds.set(r.driverId, arr);
    }

    driverOccupiedSeats.clear();

    for (const [driverId, rideIds] of driverRideIds) {
      let totalOccupied = 0;
      for (const rideId of rideIds) {
        const passengers = await db
          .select({ cnt: sql<number>`count(*)::int` })
          .from(ridePassengersTable)
          .where(eq(ridePassengersTable.rideId, rideId));
        totalOccupied += passengers[0]?.cnt || 0;
      }
      driverOccupiedSeats.set(driverId, totalOccupied);
    }
  } catch (err) {
    console.error("[QUEUE] refreshOccupiedSeats failed:", (err as Error).message);
  }
}

export function getDriverFreeSeats(driverId: number): number {
  const cached = getCachedDriver(driverId);
  if (!cached) return 0;
  const totalSeats = cached.seats || 4;
  const occupied = driverOccupiedSeats.get(driverId) || 0;
  return Math.max(0, totalSeats - occupied);
}

const BATCH_SIZE = 10;
const MAX_DISTANCE_KM = 500;
const OFFER_COOLDOWN_MS = 10_000;

export function takeNextBatch(
  fromLat: number,
  fromLng: number,
  requiredSeats: number,
  requiredGroupLevel: number,
  excludeDriverIds: Set<number>,
  maxDistanceKm: number = MAX_DISTANCE_KM,
  batchSize: number = BATCH_SIZE,
  scheduledAt?: Date | null,
): QueueCandidate[] {
  const candidates: QueueCandidate[] = [];
  const now = Date.now();

  for (let i = 0; i < queue.length && candidates.length < batchSize; i++) {
    const entry = queue[i];
    if (excludeDriverIds.has(entry.driverId)) continue;

    if (entry.lastOfferedAt > 0 && (now - entry.lastOfferedAt) < OFFER_COOLDOWN_MS) {
      console.log(`[QUEUE FILTER] driver ${entry.driverId}: cooldown ${Math.round((OFFER_COOLDOWN_MS - (now - entry.lastOfferedAt)) / 1000)}s remaining → skip`);
      continue;
    }

    const cached = getCachedDriver(entry.driverId);
    if (!cached) {
      console.log(`[QUEUE FILTER] driver ${entry.driverId}: no cache → skip`);
      continue;
    }

    if (cached.status !== "online" && cached.status !== "busy") {
      console.log(`[QUEUE FILTER] driver ${entry.driverId}: status=${cached.status} → skip`);
      continue;
    }

    const wsOnline = isUserOnline(entry.driverId);
    if (!wsOnline) {
      console.log(`[QUEUE FILTER] driver ${entry.driverId}: not connected via WS → allowing with -20 penalty`);
    }

    const freeSeats = getDriverFreeSeats(entry.driverId);
    if (freeSeats < requiredSeats) {
      console.log(`[QUEUE FILTER] driver ${entry.driverId}: freeSeats=${freeSeats} < required=${requiredSeats} → skip`);
      continue;
    }

    if (requiredGroupLevel > 0 && cached.groupLevel < requiredGroupLevel) {
      console.log(`[QUEUE FILTER] driver ${entry.driverId}: groupLevel=${cached.groupLevel} < required=${requiredGroupLevel} → skip`);
      continue;
    }

    const hasLocation = cached.lat !== 0 || cached.lng !== 0;
    const distKm = hasLocation ? haversineKm(cached.lat, cached.lng, fromLat, fromLng) : 0;
    if (hasLocation && distKm > maxDistanceKm) continue;

    const isNew = cached.acceptedOrders === 0;
    const isIdle = cached.status === "online";
    const totalSeats = cached.seats || 4;
    const occupiedSeats = totalSeats - freeSeats;
    let score = 100 - distKm;
    if (!wsOnline) score -= 20;
    if (isNew) score += 30;
    if (isIdle) score += 20;
    if (!hasLocation) score -= 10;
    score += Math.min(cached.rating * 2, 10);
    score -= entry.skippedCount * 5;
    score += occupiedSeats * 25;

    console.log(`[QUEUE FILTER] driver ${entry.driverId}: INCLUDED | freeSeats=${freeSeats} dist=${Math.round(distKm)}km hasLoc=${hasLocation} isNew=${isNew} isIdle=${isIdle} score=${Math.round(score)}`);

    candidates.push({
      driver: cached,
      queuePosition: i + 1,
      distanceKm: Math.round(distKm * 10) / 10,
      freeSeats,
      score: Math.round(score),
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  return candidates;
}

export function cleanupStaleEntries() {
  const staleIds: number[] = [];
  for (const entry of queue) {
    const cached = getCachedDriver(entry.driverId);
    if (!cached || cached.status === "offline") {
      staleIds.push(entry.driverId);
    }
  }
  const unique = [...new Set(staleIds)];
  for (const id of unique) {
    removeFromQueue(id);
  }
  if (unique.length > 0) {
    console.log(`[QUEUE] cleaned ${unique.length} stale entries, remaining=${queue.length}`);
  }
}

setInterval(cleanupStaleEntries, 30_000);

export async function initQueueFromCache() {
  const { getOnlineDrivers } = await import("./driver-cache.js");
  const online = getOnlineDrivers();
  let added = 0;
  for (const d of online) {
    if (d.status === "online" || d.status === "busy") {
      const idx = queue.findIndex(e => e.driverId === d.id);
      if (idx === -1) {
        queue.push({
          driverId: d.id,
          joinedAt: d.lastActive || Date.now(),
          lastOfferedAt: 0,
          skippedCount: 0,
        });
        added++;
      }
    }
  }
  if (added > 0) {
    console.log(`[QUEUE] initialized ${added} drivers from cache (online+busy), total=${queue.length}`);
  }

  await refreshOccupiedSeats();
}

setTimeout(() => initQueueFromCache(), 5000);
setInterval(() => refreshOccupiedSeats(), 15_000);

export function getQueueMetrics() {
  return {
    queueSize: queue.length,
    totalEnqueued: metrics.totalEnqueued,
    totalDequeued: metrics.totalDequeued,
    totalSkipped: metrics.totalSkipped,
    totalRotated: metrics.totalRotated,
    totalAssigned: metrics.totalAssigned,
    avgAssignTimeMs: metrics.avgAssignTimeMs,
    recentAssignTimes: metrics.assignTimes.slice(-10),
    topQueue: queue.slice(0, 20).map((e, i) => {
      const cached = getCachedDriver(e.driverId);
      return {
        position: i + 1,
        driverId: e.driverId,
        name: cached?.name || null,
        status: cached?.status || "unknown",
        skippedCount: e.skippedCount,
        waitingMs: Date.now() - e.joinedAt,
        lastOfferedAt: e.lastOfferedAt,
      };
    }),
  };
}

export function getFullQueue(): QueueEntry[] {
  return [...queue];
}
