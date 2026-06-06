import { db, ridesTable, usersTable, orderOffersTable, ridePassengersTable, driverGroupsTable, marketplaceListingsTable } from "@workspace/db";
import { eq, and, inArray, ne, sql } from "drizzle-orm";
import { broadcastToAll, broadcastToUser, isUserOnline } from "./websocket.js";
import { logger } from "./logger.js";
import { applyIgnorePenalty, isDriverBanned } from "./bonuses.js";
import { notifyNewOrder } from "./notifications.js";
import { getSettingNum, getSettingBool } from "./settingsCache.js";
import { matchRoute, type MatchPriority } from "./route-match.js";
import { type CachedDriver, getOnlineDrivers, syncDriverCache, getCachedDriver } from "./driver-cache.js";
import {
  isRevenueAIProdEnabled,
  enableRevenueAIProd,
  reorderDriversForRevenue,
  getDispatchMaxOffers,
  getDispatchTimeoutOverride,
  recordDriverOffer,
  recordDriverAccept,
  recordDriverReject,
  getRevenueAIProdMode,
  getRevenueAIProdSurge,
} from "./revenue-ai-prod.js";
import {
  takeNextBatch,
  moveToEnd,
  markAssigned,
  getQueuePosition,
  getQueueSize,
  getQueueMetrics,
  refreshOccupiedSeats,
  type QueueCandidate,
} from "./driver-queue.js";

const ackedOffers = new Map<number, number>();
const ACKED_OFFER_TTL_MS = 5 * 60 * 1000;
const ACK_TIMEOUT_MS = 5000;
const pendingAckTimers = new Map<number, ReturnType<typeof setTimeout>>();

export function markOfferAcked(offerId: number) {
  ackedOffers.set(offerId, Date.now());
  const timer = pendingAckTimers.get(offerId);
  if (timer) {
    clearTimeout(timer);
    pendingAckTimers.delete(offerId);
  }
  console.log(`[WS ACK] offerId=${offerId} marked as delivered`);
}

export function isOfferAcked(offerId: number): boolean {
  return ackedOffers.has(offerId);
}

export function cleanupAckedOffer(offerId: number) {
  ackedOffers.delete(offerId);
}

export function scheduleAckTimeout(offerId: number, driverId: number, rideId: number) {
  if (pendingAckTimers.has(offerId)) return;
  const timer = setTimeout(async () => {
    pendingAckTimers.delete(offerId);
    if (ackedOffers.has(offerId)) return;
    console.log(`[ACK TIMEOUT] offerId=${offerId} driverId=${driverId} rideId=${rideId} — no ACK in ${ACK_TIMEOUT_MS}ms (offer stays pending, will expire via dispatch loop)`);
    resendOfferIfStillPending(driverId, rideId, 30000, offerId).catch(() => {});
  }, ACK_TIMEOUT_MS);
  pendingAckTimers.set(offerId, timer);
}

function pruneAckedOffers() {
  const now = Date.now();
  let pruned = 0;
  for (const [id, ts] of ackedOffers) {
    if (now - ts > ACKED_OFFER_TTL_MS) {
      ackedOffers.delete(id);
      pruned++;
    }
  }
  if (pruned > 0) console.log(`[ACK PRUNE] removed ${pruned} stale acked offers, ${ackedOffers.size} remaining`);
}

setInterval(pruneAckedOffers, 60_000);

import { registerCache } from "./memory-guardian.js";
registerCache(() => {
  const before = ackedOffers.size + dispatchMetrics.size;
  ackedOffers.clear();
  for (const [id, m] of pendingAckTimers) {
    clearTimeout(m);
  }
  pendingAckTimers.clear();
  dispatchMetrics.clear();
  return { name: "autodispatch", cleared: before };
});

export async function enrichRideForOffer(ride: any): Promise<any> {
  if (!ride || !ride.id) return ride;
  try {
    const [marketListing] = await db.select({
      comment: marketplaceListingsTable.comment,
      baggageType: marketplaceListingsTable.baggageType,
    })
      .from(marketplaceListingsTable)
      .where(and(
        eq(marketplaceListingsTable.rideId, ride.id),
        eq(marketplaceListingsTable.status, "active"),
      ))
      .limit(1);

    const passengers = await db.select({
      seatNumber: ridePassengersTable.seatNumber,
      gender: ridePassengersTable.gender,
      baggageType: ridePassengersTable.baggageType,
    })
      .from(ridePassengersTable)
      .where(eq(ridePassengersTable.rideId, ride.id));

    return {
      ...ride,
      comment: marketListing?.comment ?? (ride as any).comment ?? null,
      baggageType: marketListing?.baggageType ?? passengers[0]?.baggageType ?? null,
      seatPassengers: passengers,
    };
  } catch (err) {
    logger.warn({ err, rideId: ride.id }, "[ENRICH OFFER] failed (non-critical)");
    return ride;
  }
}

export async function resendOfferIfStillPending(driverId: number, rideId: number, offerTimeoutMs: number, offerId?: number) {
  try {
    if (offerId && ackedOffers.has(offerId)) {
      console.log(`[WS ACK] offerId=${offerId} already acked, skipping retry`);
      return;
    }

    const [offer] = await db.select({
        id: orderOffersTable.id,
        status: orderOffersTable.status,
        expiresAt: orderOffersTable.expiresAt,
      })
      .from(orderOffersTable)
      .where(and(
        eq(orderOffersTable.driverId, driverId),
        eq(orderOffersTable.rideId, rideId),
        eq(orderOffersTable.status, "pending"),
      ));
    if (!offer) return;

    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
    if (!ride || (ride.status !== "offered" && ride.status !== "pending")) return;

    const enrichedRide = await enrichRideForOffer(ride);

    const remainingMs = offer.expiresAt
      ? Math.max(3000, new Date(offer.expiresAt).getTime() - Date.now())
      : Math.max(3000, offerTimeoutMs - 2000);
    console.log(`[WS RETRY] resending offer to driver ${driverId}, rideId=${rideId}, offerId=${offer.id}, remainingMs=${remainingMs}`);
    broadcastToUser(driverId, {
      type: "new_order",
      offerId: offer.id,
      ride: enrichedRide,
      expiresIn: remainingMs,
    });
  } catch (err) {
    logger.warn({ err, driverId, rideId }, "[WS RETRY] failed (non-critical)");
  }
}

const CITIES: Record<string, { lat: number; lng: number }> = {
  bukhara: { lat: 39.7747, lng: 64.4286 },
  samarkand: { lat: 39.6542, lng: 66.9597 },
  tashkent: { lat: 41.2995, lng: 69.2401 },
  namangan: { lat: 41.0011, lng: 71.6726 },
  andijan: { lat: 40.7821, lng: 72.3442 },
  fergana: { lat: 40.3834, lng: 71.7864 },
  nukus: { lat: 42.4539, lng: 59.6104 },
  urgench: { lat: 41.5467, lng: 60.6339 },
  qarshi: { lat: 38.8604, lng: 65.7908 },
  termez: { lat: 37.2242, lng: 67.2783 },
  jizzakh: { lat: 40.1158, lng: 67.8422 },
  navoiy: { lat: 40.0840, lng: 65.3791 },
};

const CITY_NAME_MAP: Record<string, string> = {
  "ташкент": "tashkent", "toshkent": "tashkent",
  "фергана": "fergana", "farg'ona": "fergana",
  "андижан": "andijan", "andijon": "andijan",
  "самарканд": "samarkand", "samarqand": "samarkand",
  "бухара": "bukhara", "buxoro": "bukhara",
  "наманган": "namangan", "namangan": "namangan",
  "навои": "navoiy", "navoiy": "navoiy",
  "термез": "termez", "termiz": "termez",
  "нукус": "nukus", "nukus": "nukus",
  "ургенч": "urgench", "urganch": "urgench",
  "джизак": "jizzakh", "jizzax": "jizzakh",
  "карши": "qarshi", "qarshi": "qarshi",
};

function resolveCitySlug(name: string): string {
  const lower = name.toLowerCase().trim();
  return CITY_NAME_MAP[lower] || lower;
}

function getCityCoord(cityName: string): { lat: number; lng: number } {
  const slug = resolveCitySlug(cityName);
  return CITIES[slug] || { lat: 41.3, lng: 69.24 };
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function citiesMatch(a: string, b: string): boolean {
  return resolveCitySlug(a) === resolveCitySlug(b);
}

export { matchRoute } from "./route-match.js";

interface DriverRouteInfo {
  driverId: number;
  routeRideId: number;
  fromCity: string;
  toCity: string;
  scheduledAt: Date | null;
  totalSeats: number;
  seatsTaken: number;
  freeSeats: number;
  matchPriority: MatchPriority;
  matchScore: number;
  extraDistanceKm: number;
  extraTimeMin: number;
}

async function findDriversWithActiveRoutes(fromCity: string, toCity: string, rideScheduledAt: Date | null, rideTimeSlot: string | null = null, allowFullCars: boolean = false): Promise<DriverRouteInfo[]> {
  const activeRouteRides = await db
    .select()
    .from(ridesTable)
    .where(
      and(
        eq(ridesTable.status, "accepted"),
        sql`${ridesTable.driverId} IS NOT NULL`
      )
    );

  const driverIds = [...new Set(activeRouteRides.map(r => r.driverId!).filter(Boolean))];
  const driverSeatsMap = new Map<number, number>();
  if (driverIds.length > 0) {
    const driverRows = await db
      .select({ id: usersTable.id, seats: usersTable.seats })
      .from(usersTable)
      .where(inArray(usersTable.id, driverIds));
    for (const d of driverRows) {
      driverSeatsMap.set(d.id, d.seats || 4);
    }
  }

  const driverRouteRide = new Map<number, { rideId: number; paxCount: number }>();
  for (const route of activeRouteRides) {
    if (!route.driverId) continue;
    const paxRows = await db
      .select({ id: ridePassengersTable.id })
      .from(ridePassengersTable)
      .where(eq(ridePassengersTable.rideId, route.id));
    const existing = driverRouteRide.get(route.driverId);
    if (!existing || paxRows.length > existing.paxCount) {
      driverRouteRide.set(route.driverId, { rideId: route.id, paxCount: paxRows.length });
    }
  }

  const candidates: DriverRouteInfo[] = [];
  const maxDetourKm = getSettingNum("max_detour_km", 50);
  const maxDetourMin = getSettingNum("max_detour_minutes", 40);

  for (const route of activeRouteRides) {
    if (!route.driverId) continue;

    const totalSeats = driverSeatsMap.get(route.driverId) || 4;
    const routeInfo = driverRouteRide.get(route.driverId);
    const seatsTaken = routeInfo ? routeInfo.paxCount : 0;
    if (!allowFullCars && totalSeats - seatsTaken <= 0) continue;

    const routeMatchResult = matchRoute(route.fromCity, route.toCity, fromCity, toCity, maxDetourKm, maxDetourMin);
    if (!routeMatchResult) continue;

    if (rideScheduledAt && route.scheduledAt) {
      const routeTime = new Date(route.scheduledAt).getTime();
      const rideTime = new Date(rideScheduledAt).getTime();
      const diffHours = Math.abs(routeTime - rideTime) / (1000 * 60 * 60);
      const timeWindowHours = getSettingNum("time_window_minutes", 60) / 60;
      const sameTimeSlot = !!rideTimeSlot && !!(route as any).timeSlot && rideTimeSlot === (route as any).timeSlot;
      if (diffHours > timeWindowHours) {
        // Same time_slot on both sides — accept regardless of date drift (off-by-one-day, week mismatch, etc.).
        // The slot itself (e.g. 22:00-00:00) already defines a 2-hour window for the time of day.
        if (sameTimeSlot && diffHours <= 36) {
          console.log(`[ROUTE MATCH] same time_slot ${rideTimeSlot}, accept driver ${route.driverId} despite date drift (${Math.round(diffHours)}h)`);
        } else {
          // For urgent rides (no rideTimeSlot): allow drivers whose route ENDS within 40 min (scheduledAt + duration)
          const isUrgentRide = !rideTimeSlot;
          const urgentTailMs = getSettingNum("urgent_tail_minutes", 40) * 60 * 1000;
          const routeDurationMin = (route as any).duration || 0;
          const routeEndMs = routeTime + routeDurationMin * 60 * 1000;
          const nowMs = Date.now();
          const eligibleByTail = isUrgentRide && routeDurationMin > 0 && routeEndMs > nowMs && (routeEndMs - nowMs) <= urgentTailMs;
          if (!eligibleByTail) continue;
          console.log(`[ROUTE MATCH] urgent-tail accept driver ${route.driverId}: route ends in ${Math.round((routeEndMs - nowMs) / 60000)} min`);
        }
      }
    }

    // STRICT: if both rides have an explicit time_slot, they MUST match.
    // Prevents 14:00-16:00 driver getting 00:00-02:00 ride offer.
    if (rideTimeSlot && (route as any).timeSlot && rideTimeSlot !== (route as any).timeSlot) {
      console.log(`[ROUTE MATCH] skip driver ${route.driverId}: time_slot mismatch route=${(route as any).timeSlot} ride=${rideTimeSlot}`);
      continue;
    }

    // URGENT-ONLY ROUTE: водитель в режиме «только срочные» не должен получать обычные (с time_slot) заказы
    if ((route as any).isUrgent === true && rideTimeSlot) {
      console.log(`[ROUTE MATCH] skip driver ${route.driverId}: urgent-only route, but ride has time_slot=${rideTimeSlot}`);
      continue;
    }

    const routeRideId = routeInfo ? routeInfo.rideId : route.id;

    candidates.push({
      driverId: route.driverId,
      routeRideId,
      fromCity: route.fromCity,
      toCity: route.toCity,
      scheduledAt: route.scheduledAt,
      totalSeats,
      seatsTaken,
      freeSeats: totalSeats - seatsTaken,
      matchPriority: routeMatchResult.priority,
      matchScore: routeMatchResult.score,
      extraDistanceKm: routeMatchResult.extraDistanceKm,
      extraTimeMin: routeMatchResult.extraTimeMin,
    });
  }

  const bestPerDriver = new Map<number, DriverRouteInfo>();
  for (const c of candidates) {
    const existing = bestPerDriver.get(c.driverId);
    if (!existing || c.matchScore > existing.matchScore || (c.matchScore === existing.matchScore && c.freeSeats > existing.freeSeats)) {
      bestPerDriver.set(c.driverId, c);
    }
  }

  return Array.from(bestPerDriver.values());
}

async function isRideStillPending(rideId: number): Promise<boolean> {
  const [ride] = await db.select({ status: ridesTable.status }).from(ridesTable).where(eq(ridesTable.id, rideId));
  if (!ride) return false;
  return ride.status === "pending" || ride.status === "offered";
}

async function isDriverStillEligibleForRoute(driverId: number, routeRideId: number, requiredSeats: number): Promise<boolean> {
  const [driver] = await db
    .select({ status: usersTable.status, balance: usersTable.balance, seats: usersTable.seats })
    .from(usersTable)
    .where(eq(usersTable.id, driverId));
  if (!driver) return false;

  if (driver.status !== "online" && driver.status !== "busy") return false;

  const [pendingOffer] = await db
    .select({ id: orderOffersTable.id })
    .from(orderOffersTable)
    .where(and(eq(orderOffersTable.driverId, driverId), eq(orderOffersTable.status, "pending")))
    .limit(1);
  if (pendingOffer) return false;

  if (routeRideId <= 0) {
    const totalSeats = driver.seats || 4;
    const driverRides = await db
      .select({ id: ridesTable.id })
      .from(ridesTable)
      .where(and(
        eq(ridesTable.driverId, driverId),
        sql`${ridesTable.status} IN ('accepted', 'in_progress')`,
      ));
    let occupied = 0;
    for (const r of driverRides) {
      const pRows = await db
        .select({ id: ridePassengersTable.id })
        .from(ridePassengersTable)
        .where(eq(ridePassengersTable.rideId, r.id));
      occupied += pRows.length;
    }
    return (totalSeats - occupied) >= requiredSeats;
  }

  const [routeRide] = await db
    .select()
    .from(ridesTable)
    .where(and(eq(ridesTable.id, routeRideId), eq(ridesTable.driverId, driverId)));

  if (!routeRide) return false;
  if (routeRide.status === "completed" || routeRide.status === "cancelled") return false;
  if (routeRide.status !== "accepted") return false;

  const passengerRows = await db
    .select({ id: ridePassengersTable.id })
    .from(ridePassengersTable)
    .where(eq(ridePassengersTable.rideId, routeRideId));

  const totalSeats = driver.seats || 4;
  const seatsTaken = passengerRows.length;
  if (totalSeats - seatsTaken < requiredSeats) return false;

  return true;
}

const activeLoops = new Map<number, AbortController>();

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(timer); resolve(); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}


// === Unassign cooldown: после диспетчерского "Снять водителя" не предлагать тот же заказ
// этому же водителю в течение N мс (по умолчанию 2 минуты).
const UNASSIGN_COOLDOWN_MS = 2 * 60 * 1000;
const unassignCooldowns = new Map<number, Map<number, number>>(); // rideId -> driverId -> expireAtMs

export function addUnassignCooldown(rideId: number, driverId: number, ttlMs: number = UNASSIGN_COOLDOWN_MS) {
  let perRide = unassignCooldowns.get(rideId);
  if (!perRide) { perRide = new Map(); unassignCooldowns.set(rideId, perRide); }
  perRide.set(driverId, Date.now() + ttlMs);
}

export function isInUnassignCooldown(rideId: number, driverId: number): boolean {
  const perRide = unassignCooldowns.get(rideId);
  if (!perRide) return false;
  const exp = perRide.get(driverId);
  if (!exp) return false;
  if (Date.now() >= exp) {
    perRide.delete(driverId);
    if (perRide.size === 0) unassignCooldowns.delete(rideId);
    return false;
  }
  return true;
}

export function clearUnassignCooldown(rideId: number) {
  unassignCooldowns.delete(rideId);
}

export function stopDispatchLoop(rideId: number) {
  const controller = activeLoops.get(rideId);
  if (controller) {
    controller.abort();
    activeLoops.delete(rideId);
    console.log(`[DISPATCH LOOP] stopped for ride ${rideId}`);
  }
}

export async function startAutoDispatch(rideId: number, fromCity: string): Promise<void> {
  if (!getSettingBool("auto_dispatch_enabled", true)) {
    console.log(`[DISPATCH LOOP] auto-dispatch disabled by settings, skipping ride ${rideId}`);
    return;
  }

  if (getSettingBool("revenue_ai_enabled", true) && !isRevenueAIProdEnabled()) {
    enableRevenueAIProd();
  }

  if (activeLoops.has(rideId)) {
    console.log(`[DISPATCH LOOP] already running for ride ${rideId}, skipping`);
    return;
  }

  const controller = new AbortController();
  const signal = controller.signal;
  activeLoops.set(rideId, controller);

  const maxRetries = getSettingNum("max_retry_count", 3);
  const maxDispatchCycles = getSettingNum("max_dispatch_cycles", 0);
  const maxCycles = maxDispatchCycles > 0 ? maxDispatchCycles : Math.max(maxRetries, 3) * 10;
  const cyclePauseMs = 60_000;

  console.log(`[DISPATCH LOOP] starting QUEUE-BASED dispatch for ride ${rideId} (maxCycles=${maxCycles}, queueSize=${getQueueSize()})`);

  try {
    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      if (signal.aborted) break;

      if (!(await isRideStillPending(rideId))) {
        console.log(`[DISPATCH LOOP] ride ${rideId}: accepted! stopping loop`);
        break;
      }

      console.log(`[DISPATCH LOOP] ride ${rideId}: cycle ${cycle}/${maxCycles} (queue=${getQueueSize()})`);

      const offeredCount = await runQueueDispatchCycle(rideId, fromCity, signal);

      if (signal.aborted) break;

      if (!(await isRideStillPending(rideId))) {
        console.log(`[DISPATCH LOOP] ride ${rideId}: accepted after cycle ${cycle}!`);
        break;
      }

      if (cycle >= maxCycles) {
        console.log(`[DISPATCH LOOP] ride ${rideId}: max cycles (${maxCycles}) reached`);
        broadcastToAll({ type: "dispatch_failed", rideId, reason: "max_cycles_reached" });
        break;
      }

      const pauseMs = offeredCount === 0 ? 15_000 : cyclePauseMs;
      console.log(`[DISPATCH LOOP] ride ${rideId}: cycle ${cycle} done (offered=${offeredCount}), pausing ${pauseMs / 1000}s`);

      broadcastToAll({
        type: "dispatch_cycle_complete",
        rideId,
        cycle,
        offeredCount,
        nextCycleIn: pauseMs / 1000,
      });

      await abortableSleep(pauseMs, signal);
    }
  } finally {
    activeLoops.delete(rideId);
    console.log(`[DISPATCH LOOP] ride ${rideId}: loop ended`);
  }
}

export async function startMarketplaceDispatch(rideId: number, fromCity: string, listingId: number): Promise<void> {
  if (activeLoops.has(rideId)) {
    console.log(`[MARKETPLACE DISPATCH] already running for ride ${rideId}, skipping`);
    return;
  }

  const controller = new AbortController();
  const signal = controller.signal;
  activeLoops.set(rideId, controller);

  const pauseSchedule = [120_000, 300_000, 300_000, 600_000];
  const maxRounds = 10;

  console.log(`[MARKETPLACE DISPATCH] starting for ride ${rideId} listingId=${listingId}`);

  try {
    for (let round = 0; round < maxRounds; round++) {
      if (signal.aborted) break;

      if (!(await isRideStillPending(rideId))) {
        console.log(`[MARKETPLACE DISPATCH] ride ${rideId}: accepted! stopping`);
        break;
      }

      console.log(`[MARKETPLACE DISPATCH] ride ${rideId}: round ${round + 1}/${maxRounds} — running auto-dispatch cycle`);
      const offeredCount = await runQueueDispatchCycle(rideId, fromCity, signal);

      if (signal.aborted) break;
      if (!(await isRideStillPending(rideId))) {
        console.log(`[MARKETPLACE DISPATCH] ride ${rideId}: accepted after round ${round + 1}!`);
        break;
      }

      const pauseMs = pauseSchedule[Math.min(round, pauseSchedule.length - 1)];
      console.log(`[MARKETPLACE DISPATCH] ride ${rideId}: round ${round + 1} done (offered=${offeredCount}), visible as urgent, pausing ${pauseMs / 1000}s before next round`);

      broadcastToAll({
        type: "dispatch_cycle_complete",
        rideId,
        cycle: round + 1,
        offeredCount,
        nextCycleIn: pauseMs / 1000,
      });

      await abortableSleep(pauseMs, signal);
    }
  } finally {
    activeLoops.delete(rideId);
    console.log(`[MARKETPLACE DISPATCH] ride ${rideId}: loop ended`);
  }
}

const QUEUE_BATCH_SIZE = 1;
const MAX_DISTANCE_KM = 500;
const OFFER_TIMEOUT_DEFAULT_MS = 15_000;

const dispatchMetrics = new Map<number, { startTime: number; retries: number; skippedDrivers: number }>();

export function getDispatchMetrics(rideId: number) {
  return dispatchMetrics.get(rideId);
}

async function runQueueDispatchCycle(
  rideId: number,
  fromCity: string,
  signal: AbortSignal,
): Promise<number> {
  const cycleStart = Date.now();
  const fromCoord = getCityCoord(fromCity);

  if (!dispatchMetrics.has(rideId)) {
    dispatchMetrics.set(rideId, { startTime: cycleStart, retries: 0, skippedDrivers: 0 });
    setTimeout(() => dispatchMetrics.delete(rideId), 10 * 60_000);
  }
  const metrics = dispatchMetrics.get(rideId)!;

  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
  if (!ride || (ride.status !== "pending" && ride.status !== "offered")) {
    console.log(`[QUEUE DISPATCH] skipped ride ${rideId}: status=${ride?.status}`);
    return 0;
  }

  const toCity = ride.toCity || "";
  const requiredSeats = (ride as any).isMail ? 0 : (ride.passengers || 1);
  const requiredGroupLevel = ride.requiredGroupLevel || 0;
  const maxDistKm = getSettingNum("queue_max_distance_km", MAX_DISTANCE_KM);
  const batchSize = getSettingNum("queue_batch_size", QUEUE_BATCH_SIZE);

  // Car-model restriction: when set, only drivers with matching car_model receive offers
  let allowedByCarModel: Set<number> | null = null;
  const reqCarModel = ((ride as any).requiredCarModel || "").toString().trim();
  if (reqCarModel) {
    const matches = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        eq(usersTable.role, "driver"),
        sql`upper(trim(${usersTable.carModel})) = upper(${reqCarModel})`,
      ));
    allowedByCarModel = new Set(matches.map(m => m.id));
    console.log(`[QUEUE DISPATCH] ride ${rideId}: requiredCarModel=${reqCarModel} → ${allowedByCarModel.size} eligible drivers`);
  }

  // MONEY-CARGO restriction: only trusted drivers (cash_carrier=true) receive offers
  let allowedByCash: Set<number> | null = null;
  if ((ride as any).isMoney === true) {
    const cashDrivers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.role, "driver"), eq((usersTable as any).cashCarrier, true)));
    allowedByCash = new Set(cashDrivers.map(m => m.id));
    console.log(`[QUEUE DISPATCH] ride ${rideId}: MONEY cargo → ${allowedByCash.size} trusted drivers`);
  }

  // OPTIONS restriction: filter drivers by their preferences vs ride's selected options.
  //   top_baggage / baggage / baggage_xm → require driver.preferences.roofBaggage=true
  //   parcel / baggage_xm  OR ride.is_mail=true → require driver.preferences.acceptParcels=true
  //   passenger.baggage_type='large' → require driver.preferences.roofBaggage=true
  let allowedByOptions: Set<number> | null = null;
  {
    const opts: string[] = Array.isArray((ride as any).selectedOptions) ? (ride as any).selectedOptions : [];
    let needRoof = opts.includes("top_baggage") || opts.includes("baggage_xm") || opts.includes("baggage");
    let needParcel = opts.includes("parcel") || opts.includes("baggage_xm") || (ride as any).isMail === true;
    if (!needRoof) {
      try {
        const bigBag = await db.select({ id: ridePassengersTable.id })
          .from(ridePassengersTable)
          .where(and(eq(ridePassengersTable.rideId, rideId), eq(ridePassengersTable.baggageType, "large")));
        if (bigBag.length > 0) needRoof = true;
      } catch (e) {
        console.warn(`[QUEUE DISPATCH] ride ${rideId}: large-baggage probe failed, defaulting to needRoof=true for safety`, e);
        needRoof = true;
      }
    }
    if (needRoof || needParcel) {
      const allDrivers = await db
        .select({ id: usersTable.id, preferences: (usersTable as any).preferences })
        .from(usersTable)
        .where(eq(usersTable.role, "driver"));
      const allowed = new Set<number>();
      for (const d of allDrivers) {
        const prefs: any = d.preferences || {};
        if (needRoof && prefs.roofBaggage !== true) continue;
        if (needParcel && prefs.acceptParcels !== true) continue;
        allowed.add(d.id);
      }
      allowedByOptions = allowed;
      console.log(`[QUEUE DISPATCH] ride ${rideId}: option filter (roof=${needRoof}, parcel=${needParcel}) → ${allowed.size} eligible drivers`);
    }
  }

  const driverRoutes = await findDriversWithActiveRoutes(fromCity, toCity, ride.scheduledAt, (ride as any).timeSlot || null, (ride as any).isMail === true);
  const routeMap = new Map(driverRoutes.map(dr => [dr.driverId, dr]));

  const staleExpired = await db.update(orderOffersTable)
    .set({ status: "expired", respondedAt: new Date() })
    .where(and(
      eq(orderOffersTable.status, "pending"),
      sql`${orderOffersTable.expiresAt} < NOW()`,
    ))
    .returning({ id: orderOffersTable.id });
  if (staleExpired.length > 0) {
    console.log(`[QUEUE DISPATCH] expired ${staleExpired.length} stale offers`);
  }

  const pendingOffers = await db
    .select({ driverId: orderOffersTable.driverId })
    .from(orderOffersTable)
    .where(and(
      eq(orderOffersTable.status, "pending"),
      sql`${orderOffersTable.expiresAt} > NOW()`,
    ));
  const driversWithPendingOffers = new Set(pendingOffers.map(o => o.driverId));

  await syncDriverCache();
  await refreshOccupiedSeats();

  console.log(`[QUEUE DISPATCH] ride ${rideId} (${fromCity} → ${toCity}): requiredSeats=${requiredSeats}, queue=${getQueueSize()}, routeMatches=${driverRoutes.length}`);

  const revenueTimeout = getDispatchTimeoutOverride();
  const offerTimeoutMs = (revenueTimeout ?? getSettingNum("offer_timeout_seconds", 30)) * 1000 || OFFER_TIMEOUT_DEFAULT_MS;

  let offeredCount = 0;
  let batchIndex = 0;
  const alreadyOffered = new Set<number>();

  const routeDriversFirst = driverRoutes.filter(dr => {
    if (allowedByCarModel && !allowedByCarModel.has(dr.driverId)) return false;
    if (allowedByCash && !allowedByCash.has(dr.driverId)) return false;
    if (allowedByOptions && !allowedByOptions.has(dr.driverId)) return false;
    if (driversWithPendingOffers.has(dr.driverId)) return false;
    if (isInUnassignCooldown(rideId, dr.driverId)) {
      console.log(`[QUEUE DISPATCH] route-driver ${dr.driverId}: in unassign cooldown for ride ${rideId} → skip`);
      return false;
    }
    const cached = getCachedDriver(dr.driverId);
    if (!cached) return false;
    if (!isUserOnline(dr.driverId)) {
      console.log(`[QUEUE DISPATCH] route-driver ${dr.driverId}: offline but still allowing with low priority`);
    }
    if (dr.freeSeats < requiredSeats) {
      console.log(`[QUEUE DISPATCH] route-driver ${dr.driverId}: freeSeats=${dr.freeSeats} < required=${requiredSeats} → skip`);
      return false;
    }
    return true;
  });

  routeDriversFirst.sort((a, b) => {
    if (a.freeSeats !== b.freeSeats) return a.freeSeats - b.freeSeats;
    return b.matchScore - a.matchScore;
  });

  if (routeDriversFirst.length > 0) {
    console.log(`[QUEUE DISPATCH] ride ${rideId}: ${routeDriversFirst.length} route-matched drivers (fillup order: ${routeDriversFirst.map(d => `${d.driverId}[free=${d.freeSeats}]`).join(", ")})`);
    for (const rd of routeDriversFirst) {
      alreadyOffered.add(rd.driverId);
    }
  } else {
    console.log(`[QUEUE DISPATCH] ride ${rideId}: NO route-matched drivers — falling back to online queue drivers`);
  }

  const routeBatches = Math.ceil(routeDriversFirst.length / batchSize);
  const queueFallbackBatches = getSettingNum("queue_fallback_batches", 10);
  const maxBatches = routeBatches + queueFallbackBatches + 1;

  while (batchIndex < maxBatches) {
    if (signal.aborted) return offeredCount;
    if (!(await isRideStillPending(rideId))) {
      const assignTime = Date.now() - metrics.startTime;
      console.log(`[QUEUE DISPATCH] ride ${rideId} accepted! time_to_assign=${assignTime}ms, retries=${metrics.retries}, skipped=${metrics.skippedDrivers}`);
      broadcastToAll({ type: "dispatch_metrics", rideId, timeToAssignMs: assignTime, retries: metrics.retries, skippedDrivers: metrics.skippedDrivers, queueSize: getQueueSize() });
      return offeredCount;
    }

    let candidates: Array<{ driverId: number; name: string | null; distanceKm: number; queuePos: number; routeInfo?: DriverRouteInfo }> = [];

    const startIdx = batchIndex * batchSize;
    const batchSlice = routeDriversFirst.slice(startIdx, startIdx + batchSize);
    for (const rd of batchSlice) {
      const cached = getCachedDriver(rd.driverId);
      const distKm = cached
        ? haversineKm(cached.lat, cached.lng, fromCoord.lat, fromCoord.lng)
        : 0;
      candidates.push({
        driverId: rd.driverId,
        name: cached?.name || null,
        distanceKm: Math.round(distKm * 10) / 10,
        queuePos: getQueuePosition(rd.driverId),
        routeInfo: rd,
      });
    }

    if (candidates.length === 0) {
      // SCHEDULED RIDES: never fall back to queue, even when time has come.
      // Only route-matched drivers (their own ride covers this trip) can receive scheduled orders.
      const rideTimeSlot = (ride as any).timeSlot || null;
      const schedMs = ride.scheduledAt ? new Date(ride.scheduledAt).getTime() : 0;
      const isScheduled = !!rideTimeSlot || schedMs > 0;
      if (isScheduled && !(ride as any).isMail) {
        console.log(`[QUEUE DISPATCH] ride ${rideId}: scheduled (timeSlot=${rideTimeSlot}, scheduledAt=${ride.scheduledAt}) — skip queue fallback, only route-matched drivers eligible`);
        batchIndex++;
        continue;
      }
      const queueCandidates = takeNextBatch(
        fromCoord.lat,
        fromCoord.lng,
        requiredSeats,
        requiredGroupLevel,
        alreadyOffered,
        maxDistKm,
        batchSize,
        ride.scheduledAt,
      );
      const fromCitySlug = resolveCitySlug(fromCity);
      for (const qc of queueCandidates) {
        if (isInUnassignCooldown(rideId, qc.driver.id)) {
          console.log(`[QUEUE FILTER cooldown] driver ${qc.driver.id}: in unassign cooldown for ride ${rideId} → skip`);
          alreadyOffered.add(qc.driver.id);
          continue;
        }
        if (allowedByOptions && !allowedByOptions.has(qc.driver.id)) {
          console.log(`[QUEUE FILTER options] driver ${qc.driver.id}: missing required preferences → skip`);
          alreadyOffered.add(qc.driver.id);
          continue;
        }
        if (allowedByCash && !allowedByCash.has(qc.driver.id)) {
          alreadyOffered.add(qc.driver.id);
          continue;
        }
        if (allowedByCarModel && !allowedByCarModel.has(qc.driver.id)) {
          alreadyOffered.add(qc.driver.id);
          continue;
        }
        // STRICT: driver's city must match ride's from_city.
        // Prevents Ferghana driver from getting Namangan→Tashkent orders via 500km radius queue.
        const driverCity = (qc.driver.city || "").trim();
        const driverCitySlug = resolveCitySlug(driverCity);
        if (driverCity && driverCitySlug !== fromCitySlug) {
          console.log(`[QUEUE FILTER city] driver ${qc.driver.id}: city=${driverCity} (${driverCitySlug}) != ride.from=${fromCity} (${fromCitySlug}) → skip`);
          continue;
        }
        alreadyOffered.add(qc.driver.id);
        candidates.push({
          driverId: qc.driver.id,
          name: qc.driver.name || null,
          distanceKm: qc.distanceKm,
          queuePos: qc.queuePosition,
        });
      }
      if (candidates.length > 0) {
        console.log(`[QUEUE DISPATCH] ride ${rideId}: fallback to queue — found ${candidates.length} online drivers: ${candidates.map(c => c.driverId).join(",")}`);
      }
    }

    console.log(`[DISPATCH CANDIDATES] ride ${rideId}: batch=${batchIndex}, candidates=${candidates.length}, ids=[${candidates.map(c => c.driverId).join(",")}]`);

    if (candidates.length === 0) {
      console.log(`[QUEUE DISPATCH] ride ${rideId}: no more candidates in queue (batch ${batchIndex})`);
      break;
    }

    metrics.retries++;
    batchIndex++;

    const [offeredRide] = await db.update(ridesTable)
      .set({ status: "offered", updatedAt: new Date() })
      .where(and(eq(ridesTable.id, rideId), inArray(ridesTable.status, ["pending", "offered"])))
      .returning();

    if (!offeredRide) {
      console.log(`[QUEUE DISPATCH] ride ${rideId} already taken`);
      break;
    }

    broadcastToAll({
      type: "dispatch_started",
      rideId,
      totalCandidates: candidates.length,
      groupSize: candidates.length,
      timeoutSec: offerTimeoutMs / 1000,
      queueBatch: batchIndex,
      queueSize: getQueueSize(),
    });

    const offerPromises = candidates.map(async (candidate) => {
      const { driverId, routeInfo } = candidate;

      if (routeInfo && routeInfo.routeRideId > 0) {
        if (!(await isDriverStillEligibleForRoute(driverId, routeInfo.routeRideId, requiredSeats))) {
          console.log(`[QUEUE DISPATCH] skip driver ${driverId}: no longer eligible for route`);
          metrics.skippedDrivers++;
          return false;
        }
      }

      await db.update(orderOffersTable)
        .set({ status: "expired", respondedAt: new Date() })
        .where(and(eq(orderOffersTable.driverId, driverId), eq(orderOffersTable.status, "pending")));

      const expiresAt = new Date(Date.now() + offerTimeoutMs);
      const [createdOffer] = await db.insert(orderOffersTable).values({
        rideId,
        driverId: driverId,
        status: "pending" as const,
        expiresAt,
      }).returning();

      const [fullRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
      const enrichedRide = await enrichRideForOffer(fullRide);

      recordDriverOffer(driverId);

      broadcastToUser(driverId, {
        type: "new_order",
        offerId: createdOffer.id,
        ride: enrichedRide,
        expiresIn: offerTimeoutMs,
      });

      scheduleAckTimeout(createdOffer.id, driverId, rideId);
      setTimeout(() => resendOfferIfStillPending(driverId, rideId, offerTimeoutMs, createdOffer.id), 2000);

      notifyNewOrder(
        driverId, rideId,
        fullRide?.fromCity || fromCity, fullRide?.toCity || "",
        fullRide?.price || 0,
      ).catch(() => {});

      broadcastToAll({
        type: "dispatch_offer_sent",
        rideId,
        offeredTo: { id: driverId, name: candidate.name, distance: candidate.distanceKm, queuePos: candidate.queuePos },
        batchIndex,
        totalCandidates: candidates.length,
        expiresAt: expiresAt.toISOString(),
        queueSize: getQueueSize(),
      });

      return true;
    });

    const settled = await Promise.allSettled(offerPromises);
    const sentCount = settled.filter(r => r.status === "fulfilled" && r.value).length;
    const failedCount = settled.filter(r => r.status === "rejected").length;
    if (failedCount > 0) console.warn(`[QUEUE DISPATCH] ride ${rideId}: ${failedCount} offer(s) failed in batch ${batchIndex}`);
    offeredCount += sentCount;

    const batchSendTime = Date.now() - cycleStart;
    console.log(`[QUEUE DISPATCH] ride ${rideId}: batch ${batchIndex} sent to ${candidates.map(d => d.driverId).join(",")} in ${batchSendTime}ms (timeout=${offerTimeoutMs / 1000}s, queuePos=[${candidates.map(c => c.queuePos).join(",")}])`);

    const [latestRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
    broadcastToAll({ type: "ride_updated", ride: latestRide });

    await abortableSleep(offerTimeoutMs, signal);
    if (signal.aborted) return offeredCount;

    if (!(await isRideStillPending(rideId))) {
      const assignTime = Date.now() - metrics.startTime;
      console.log(`[QUEUE DISPATCH] ride ${rideId} accepted after batch ${batchIndex}! time_to_assign=${assignTime}ms`);
      broadcastToAll({ type: "dispatch_metrics", rideId, timeToAssignMs: assignTime, retries: metrics.retries, skippedDrivers: metrics.skippedDrivers, queueSize: getQueueSize() });
      return offeredCount;
    }

    for (const candidate of candidates) {
      const [offerCheck] = await db
        .select({ status: orderOffersTable.status })
        .from(orderOffersTable)
        .where(and(
          eq(orderOffersTable.rideId, rideId),
          eq(orderOffersTable.driverId, candidate.driverId),
          eq(orderOffersTable.status, "pending")
        ));

      if (offerCheck) {
        await db.update(orderOffersTable)
          .set({ status: "expired", respondedAt: new Date() })
          .where(and(
            eq(orderOffersTable.rideId, rideId),
            eq(orderOffersTable.driverId, candidate.driverId),
            eq(orderOffersTable.status, "pending")
          ));

        broadcastToUser(candidate.driverId, { type: "order_expired", rideId });
        recordDriverReject(candidate.driverId);

        moveToEnd(candidate.driverId);
        metrics.skippedDrivers++;

        applyIgnorePenalty(candidate.driverId, rideId).catch(err => {
          logger.warn({ err, driverId: candidate.driverId, rideId }, "Ignore penalty failed");
        });

        broadcastToAll({
          type: "dispatch_offer_expired",
          rideId,
          driverId: candidate.driverId,
          driverName: candidate.name,
          movedToQueueEnd: true,
        });
      }
    }

    const resetResult = await db.update(ridesTable)
      .set({ status: "pending", updatedAt: new Date() })
      .where(and(eq(ridesTable.id, rideId), eq(ridesTable.status, "offered"), sql`${ridesTable.driverId} IS NULL`))
      .returning({ id: ridesTable.id });

    if (resetResult.length === 0 && (await isRideStillPending(rideId)) === false) {
      return offeredCount;
    }

    const [resetRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
    broadcastToAll({ type: "ride_updated", ride: resetRide });
  }

  const [finalRide] = await db.select({ status: ridesTable.status, driverId: ridesTable.driverId }).from(ridesTable).where(eq(ridesTable.id, rideId));
  if ((finalRide?.status === "pending" || finalRide?.status === "offered") && !finalRide?.driverId) {
    await db.update(ridesTable)
      .set({ status: "pending", updatedAt: new Date() })
      .where(and(eq(ridesTable.id, rideId), sql`${ridesTable.driverId} IS NULL`));
    const [resetRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
    broadcastToAll({ type: "ride_updated", ride: resetRide });
  }

  const totalTime = Date.now() - metrics.startTime;
  console.log(`[QUEUE DISPATCH] ride ${rideId}: cycle complete. total_time=${totalTime}ms, offered=${offeredCount}, retries=${metrics.retries}, skipped=${metrics.skippedDrivers}, queue=${getQueueSize()}`);

  return offeredCount;
}


export async function resumePendingDispatches(): Promise<void> {
  try {
    const pendingRides = await db
      .select({ id: ridesTable.id, fromCity: ridesTable.fromCity })
      .from(ridesTable)
      .where(
        and(
          inArray(ridesTable.status, ["pending", "offered"]),
          sql`${ridesTable.driverId} IS NULL`,
          sql`${ridesTable.scheduledAt} > NOW() - INTERVAL '24 hours'`,
        )
      );

    if (pendingRides.length === 0) {
      console.log(`[DISPATCH RESUME] no pending rides to resume`);
      return;
    }

    console.log(`[DISPATCH RESUME] resuming dispatch for ${pendingRides.length} pending rides: ${pendingRides.map(r => r.id).join(",")}`);

    for (const ride of pendingRides) {
      if (!activeLoops.has(ride.id)) {
        startAutoDispatch(ride.id, ride.fromCity || "").catch(err => {
          console.error(`[DISPATCH RESUME] failed for ride ${ride.id}:`, (err as Error).message);
        });
        await new Promise(r => setTimeout(r, 500));
      }
    }
  } catch (err) {
    console.error(`[DISPATCH RESUME] error:`, (err as Error).message);
  }
}

setTimeout(() => resumePendingDispatches(), 10_000);

export async function getOfferStatus(rideId: number) {
  const offers = await db
    .select({
      id: orderOffersTable.id,
      driverId: orderOffersTable.driverId,
      status: orderOffersTable.status,
      offeredAt: orderOffersTable.offeredAt,
      respondedAt: orderOffersTable.respondedAt,
      expiresAt: orderOffersTable.expiresAt,
    })
    .from(orderOffersTable)
    .where(eq(orderOffersTable.rideId, rideId));

  const drivers = offers.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone })
        .from(usersTable)
        .where(inArray(usersTable.id, offers.map(o => o.driverId)))
    : [];

  const driverMap = new Map(drivers.map(d => [d.id, d]));

  return offers.map(o => ({
    ...o,
    driverName: driverMap.get(o.driverId)?.name || null,
    driverPhone: driverMap.get(o.driverId)?.phone || null,
  }));
}
