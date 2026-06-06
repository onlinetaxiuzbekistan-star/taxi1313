// @ts-nocheck
import { Router, type IRouter } from "express";
import { clog } from "../../lib/logger.js";
import { db, ridesTable, usersTable, tariffsTable, orderOffersTable, ridePassengersTable, districtsTable, settingsTable, routesTable, routeOptionsTable, transactionsTable, driverGroupsTable, citiesTable } from "@workspace/db";
import { eq, desc, asc, and, sql, inArray, gte, lte, like, or, ilike } from "drizzle-orm";
import { broadcastToAll, broadcastToUser } from "../../lib/websocket.js";
import { startAutoDispatch, getOfferStatus, stopDispatchLoop, citiesMatch, addUnassignCooldown } from "../../lib/autodispatch.js";
import { addToBuffer, isBatchEnabled } from "../../lib/ride-buffer.js";
import { completeRide } from "../../lib/completion.js";
import { authMiddleware, requireRole, AuthRequest } from "../../middlewares/auth.js";
import { validateBody } from "../../middlewares/validate.js";
import { createRideBodySchema, updateRideBodySchema } from "../../middlewares/request-schemas.js";
import { createRide, getRide } from "../../lib/services/rides.service.js";
import { config } from "../../lib/config.js";
import { getMarketplaceSettings } from "../../lib/settings.js";
import { getSettingNum, getSettingBool, getSetting } from "../../lib/settingsCache.js";
import { applySurgeToPrice, isRevenueAIProdEnabled, enableRevenueAIProd, getRevenueAIProdSurge } from "../../lib/revenue-ai-prod.js";
import { notifyRideStatusChange } from "../../lib/sms-notifications.js";
import jwt from "jsonwebtoken";

import { JWT_SECRET } from "../../lib/jwt-secret.js";
export function enrichPassengersWithRouteInfo(passengers: any[], ride: any) {
  if (!ride) return passengers;
  const fromDisplay = ride.fromDistrictName
    ? `${ride.fromDistrictName} (${ride.fromCity})`
    : ride.fromCity;
  const toDisplay = ride.toDistrictName
    ? `${ride.toDistrictName} (${ride.toCity})`
    : ride.toCity;
  return passengers.map((p: any) => {
    const hasOwnPickup = p.pickupAddress && p.pickupAddress.trim() && p.pickupAddress !== ride.fromCity;
    const hasOwnDrop = p.dropoffAddress && p.dropoffAddress.trim() && p.dropoffAddress !== ride.toCity;
    return {
      ...p,
      pickupAddress: hasOwnPickup ? p.pickupAddress : fromDisplay,
      dropoffAddress: hasOwnDrop ? p.dropoffAddress : toDisplay,
      rideFromDistrictName: ride.fromDistrictName ?? null,
      rideToDistrictName: ride.toDistrictName ?? null,
      rideFromAddress: ride.fromAddress ?? null,
      rideToAddress: ride.toAddress ?? null,
    };
  });
}


export const SURGE_DEFAULTS: Record<string, string> = {
  surge_min: "1.0",
  surge_max: "3.0",
  demand_supply_multiplier: "1.0",
  demand_threshold: "1.5",
  demand_surge_bonus: "0.3",
  peak_morning_start: "07:00",
  peak_morning_end: "10:00",
  peak_morning_bonus: "0.2",
  peak_evening_start: "17:00",
  peak_evening_end: "20:00",
  peak_evening_bonus: "0.2",
  night_start: "23:00",
  night_end: "06:00",
  night_bonus: "0.15",
  urgent_multiplier: "1.2",
};

export function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function isInTimeRange(nowMin: number, startStr: string, endStr: string): boolean {
  const s = parseTime(startStr);
  const e = parseTime(endStr);
  if (s <= e) return nowMin >= s && nowMin < e;
  return nowMin >= s || nowMin < e;
}

export async function getDemandSupplyRatio(): Promise<{ ratio: number; activeRides: number; availableDrivers: number }> {
  const [ridesRow] = await db.select({ count: sql<number>`count(*)::int` })
    .from(ridesTable)
    .where(inArray(ridesTable.status, ["pending", "accepted", "in_progress"]));
  const activeRides = ridesRow?.count || 0;

  const [driversRow] = await db.select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(and(eq(usersTable.role, "driver"), eq(usersTable.status, "online")));
  const availableDrivers = driversRow?.count || 0;

  const ratio = availableDrivers === 0 ? (activeRides > 0 ? 10 : 0) : activeRides / availableDrivers;
  return { ratio, activeRides, availableDrivers };
}

export async function getSurgeMultiplier(isUrgent: boolean): Promise<{
  multiplier: number;
  breakdown: {
    base: number;
    demandBonus: number;
    timeBonus: number;
    urgentMultiplier: number;
    timePeriod: string | null;
    demandRatio: number;
    activeRides: number;
    availableDrivers: number;
  }
}> {
  const cfg: Record<string, string> = {};
  for (const [k, def] of Object.entries(SURGE_DEFAULTS)) {
    cfg[k] = getSetting(k, def as string);
  }

  const f = (k: string) => parseFloat(cfg[k]);
  const surgeMin = f("surge_min");
  const surgeMax = f("surge_max");
  const baseDemandSupply = f("demand_supply_multiplier");
  const demandThreshold = f("demand_threshold");
  const demandSurgeBonus = f("demand_surge_bonus");

  const { ratio: demandRatio, activeRides, availableDrivers } = await getDemandSupplyRatio();

  let demandBonus = 0;
  if (demandRatio > demandThreshold) {
    demandBonus = demandSurgeBonus;
    if (demandRatio > demandThreshold * 2) {
      demandBonus = demandSurgeBonus * 1.5;
    }
  }

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  let timeBonus = 0;
  let timePeriod: string | null = null;

  if (isInTimeRange(nowMin, cfg.peak_morning_start, cfg.peak_morning_end)) {
    timeBonus = f("peak_morning_bonus");
    timePeriod = "morning_peak";
  } else if (isInTimeRange(nowMin, cfg.peak_evening_start, cfg.peak_evening_end)) {
    timeBonus = f("peak_evening_bonus");
    timePeriod = "evening_peak";
  } else if (isInTimeRange(nowMin, cfg.night_start, cfg.night_end)) {
    timeBonus = f("night_bonus");
    timePeriod = "night";
  }

  const urgentMult = isUrgent ? f("urgent_multiplier") : 1.0;
  const additivePart = baseDemandSupply + demandBonus + timeBonus;
  const rawMultiplier = additivePart * urgentMult;
  const multiplier = Math.min(surgeMax, Math.max(surgeMin, rawMultiplier));

  return {
    multiplier,
    breakdown: {
      base: baseDemandSupply,
      demandBonus,
      timeBonus,
      urgentMultiplier: urgentMult,
      timePeriod,
      demandRatio: Math.round(demandRatio * 100) / 100,
      activeRides,
      availableDrivers,
    }
  };
}

export const CITIES: Record<string, { lat: number; lng: number; nameRu: string }> = {
  bukhara:   { lat: 39.7747, lng: 64.4286, nameRu: "Бухара" },
  samarkand: { lat: 39.6542, lng: 66.9597, nameRu: "Самарканд" },
  tashkent:  { lat: 41.2995, lng: 69.2401, nameRu: "Ташкент" },
  namangan:  { lat: 41.0011, lng: 71.6726, nameRu: "Наманган" },
  andijan:   { lat: 40.7821, lng: 72.3442, nameRu: "Андижан" },
  fergana:   { lat: 40.3834, lng: 71.7864, nameRu: "Фергана" },
  nukus:     { lat: 42.4539, lng: 59.6104, nameRu: "Нукус" },
  urgench:   { lat: 41.5467, lng: 60.6339, nameRu: "Ургенч" },
  qarshi:    { lat: 38.8604, lng: 65.7908, nameRu: "Карши" },
  termez:    { lat: 37.2242, lng: 67.2783, nameRu: "Термез" },
  jizzakh:   { lat: 40.1158, lng: 67.8422, nameRu: "Джиззах" },
  navoiy:    { lat: 40.0840, lng: 65.3791, nameRu: "Навои" },
};


export const CITIES_RU_MAP: Record<string, string> = {};
for (const [key, val] of Object.entries(CITIES)) {
  CITIES_RU_MAP[val.nameRu.toLowerCase()] = key;
}

export function findCity(name: string) {
  const lower = name.toLowerCase();
  return CITIES[lower] || CITIES[CITIES_RU_MAP[lower] || ""];
}

import { getOsrmRoute, haversineDistance, type OsrmRoute } from "../../lib/osrm.js";


import { JWT_SECRET as __JWT_SECRET_FOR_BRANCH } from "../../lib/jwt-secret.js";
import { db as __db_branch, usersTable as __users_branch } from "@workspace/db";
import { eq as __eq_branch } from "drizzle-orm";

export const __branchOfUserCache = new Map<number, { v: number | null; ts: number }>();
export async function __getRequesterBranchScope(req: any): Promise<{ role?: string; branchId: number | null }> {
  try {
    const h = req.headers?.authorization;
    if (!h || !h.startsWith("Bearer ")) return { branchId: null };
    const dec = jwt.verify(h.substring(7), __JWT_SECRET_FOR_BRANCH) as { userId?: number; role?: string };
    if (!dec?.userId) return { branchId: null };
    const cached = __branchOfUserCache.get(dec.userId);
    if (cached && Date.now() - cached.ts < 60_000) return { role: dec.role, branchId: cached.v };
    const [u] = await __db_branch.select({ b: __users_branch.branchId }).from(__users_branch)
      .where(__eq_branch(__users_branch.id, dec.userId));
    const v = u?.b ?? null;
    __branchOfUserCache.set(dec.userId, { v, ts: Date.now() });
    return { role: dec.role, branchId: v };
  } catch { return { branchId: null }; }
}

// Best-effort identity from an optional Bearer token. Never throws; returns {} for guests.
// Used to scope/sanitize endpoints that must stay reachable by unauthenticated rider clients.
export async function __getRequesterIdentity(req: any): Promise<{ role?: string; userId?: number }> {
  try {
    const h = req.headers?.authorization;
    if (!h || !h.startsWith("Bearer ")) return {};
    const dec = jwt.verify(h.substring(7), __JWT_SECRET_FOR_BRANCH) as { userId?: number; role?: string };
    if (!dec?.userId) return {};
    return { role: dec.role, userId: Number(dec.userId) };
  } catch { return {}; }
}

export function calcDistanceFallback(city1: string, city2: string): number {
  const c1 = findCity(city1);
  const c2 = findCity(city2);
  if (!c1 || !c2) return 200;
  return haversineDistance(c1.lat, c1.lng, c2.lat, c2.lng);
}

export async function calcRouteDistance(city1: string, city2: string): Promise<{ distance: number; duration: number }> {
  const c1 = findCity(city1);
  const c2 = findCity(city2);
  if (!c1 || !c2) return { distance: 200, duration: 150 };

  const osrm = await getOsrmRoute([
    { lat: c1.lat, lng: c1.lng },
    { lat: c2.lat, lng: c2.lng },
  ]);

  if (osrm) {
    return { distance: osrm.distance, duration: osrm.duration };
  }

  const dist = haversineDistance(c1.lat, c1.lng, c2.lat, c2.lng);
  return { distance: dist, duration: Math.round((dist / 80) * 60) };
}

export async function calcPrice(fromCity: string, toCity: string, _passengers: number, carClass: string, _distance?: number) {
  const routes = await db.select().from(routesTable).where(
    and(eq(routesTable.fromCity, fromCity), eq(routesTable.toCity, toCity), eq(routesTable.isActive, true))
  );
  let route = routes[0];
  if (!route) {
    const reverseRoutes = await db.select().from(routesTable).where(
      and(eq(routesTable.fromCity, toCity), eq(routesTable.toCity, fromCity), eq(routesTable.isActive, true))
    );
    route = reverseRoutes[0];
    if (!route) {
      return { price: 0, priceBack: 0, priceFront: 0, distance: 0, duration: 0, routeBasePrice: 0, routeId: 0 };
    }
  }
  const priceBack = carClass === "business" ? route.priceBusiness : carClass === "comfort" ? route.priceComfort : route.priceEconomy;
  const priceFront = carClass === "business" ? route.priceFrontBusiness : carClass === "comfort" ? route.priceFrontComfort : route.priceFrontEconomy;
  clog.log("ROUTE PRICE back:", priceBack, "front:", priceFront, "route:", route.fromCity, "→", route.toCity);
  return {
    price: Math.round(priceBack),
    priceBack: Math.round(priceBack),
    priceFront: Math.round(priceFront || priceBack),
    distance: route.distanceKm,
    duration: route.durationMin,
    routeBasePrice: priceBack,
    roundTripDiscountPercent: route.roundTripDiscountPercent,
    routeId: route.id,
  };
}


export interface Waypoint {
  lat: number;
  lng: number;
  type: "origin" | "destination" | "pickup" | "dropoff";
  rideId?: number;
  label?: string;
}

export interface TripMatch {
  trip: typeof ridesTable.$inferSelect;
  score: number;
  detourMinutes?: number;
  isAlongRoute?: boolean;
  newWaypoints?: Waypoint[];
  newRoute?: OsrmRoute;
}

export interface PickupDropoffPair {
  pickup: Waypoint;
  dropoff: Waypoint;
}

export function extractPairs(waypoints: Waypoint[]): PickupDropoffPair[] {
  const byRide = new Map<number, { pickup?: Waypoint; dropoff?: Waypoint }>();
  let unpairedIdx = -1;
  for (const wp of waypoints) {
    if (wp.type !== "pickup" && wp.type !== "dropoff") continue;
    const key = wp.rideId ?? (unpairedIdx--);
    if (!byRide.has(key)) byRide.set(key, {});
    const entry = byRide.get(key)!;
    if (wp.type === "pickup") entry.pickup = wp;
    else entry.dropoff = wp;
  }
  const pairs: PickupDropoffPair[] = [];
  for (const [, entry] of byRide) {
    if (entry.pickup && entry.dropoff) pairs.push({ pickup: entry.pickup, dropoff: entry.dropoff });
  }
  return pairs;
}

export function wpKey(wp: Waypoint): string {
  return `${wp.type}:${wp.rideId ?? ""}:${wp.lat},${wp.lng}`;
}

export function buildPairMap(stops: Waypoint[], pairs: PickupDropoffPair[]): Map<string, string> {
  const dropoffToPickup = new Map<string, string>();
  for (const pair of pairs) {
    const pickupK = wpKey(pair.pickup);
    const dropoffK = wpKey(pair.dropoff);
    dropoffToPickup.set(dropoffK, pickupK);
  }
  return dropoffToPickup;
}

export function isValidOrder(order: Waypoint[], dropoffToPickup: Map<string, string>): boolean {
  const placed = new Set<string>();
  for (const wp of order) {
    const k = wpKey(wp);
    if (wp.type === "dropoff") {
      const requiredPickup = dropoffToPickup.get(k);
      if (requiredPickup && !placed.has(requiredPickup)) return false;
    }
    placed.add(k);
  }
  return true;
}

export function generateValidPermutations(stops: Waypoint[], pairs: PickupDropoffPair[]): Waypoint[][] {
  const results: Waypoint[][] = [];
  const MAX_RESULTS = 60;
  const dropoffToPickup = buildPairMap(stops, pairs);

  function permute(current: Waypoint[], remaining: Waypoint[], placedKeys: Set<string>) {
    if (results.length >= MAX_RESULTS) return;
    if (remaining.length === 0) {
      results.push([...current]);
      return;
    }
    const seen = new Set<string>();
    for (let i = 0; i < remaining.length; i++) {
      const wp = remaining[i];
      const key = wpKey(wp);
      if (seen.has(key)) continue;
      seen.add(key);

      if (wp.type === "dropoff") {
        const requiredPickup = dropoffToPickup.get(key);
        if (requiredPickup && !placedKeys.has(requiredPickup)) continue;
      }

      current.push(wp);
      placedKeys.add(key);
      const next = [...remaining.slice(0, i), ...remaining.slice(i + 1)];
      permute(current, next, placedKeys);
      current.pop();
      placedKeys.delete(key);
    }
  }

  permute([], stops, new Set());
  return results;
}

export function estimateRouteDist(
  origin: { lat: number; lng: number },
  stops: Waypoint[],
  dest: { lat: number; lng: number },
): number {
  let total = 0;
  let prev = origin;
  for (const wp of stops) {
    total += haversineDistance(prev.lat, prev.lng, wp.lat, wp.lng);
    prev = wp;
  }
  total += haversineDistance(prev.lat, prev.lng, dest.lat, dest.lng);
  return total;
}

export async function calcDetour(
  tripOrigin: { lat: number; lng: number },
  tripDest: { lat: number; lng: number },
  existingWaypoints: Waypoint[],
  pickup: { lat: number; lng: number },
  dropoff: { lat: number; lng: number },
  originalDuration: number,
): Promise<{ detourMinutes: number; newWaypoints: Waypoint[]; newRoute: OsrmRoute } | null> {
  const existingStops = existingWaypoints.filter(
    wp => wp.type !== "origin" && wp.type !== "destination"
  );

  const newPickup: Waypoint = { lat: pickup.lat, lng: pickup.lng, type: "pickup" };
  const newDropoff: Waypoint = { lat: dropoff.lat, lng: dropoff.lng, type: "dropoff" };

  const allStops = [...existingStops, newPickup, newDropoff];

  const allPairs = extractPairs([...existingWaypoints, newPickup, newDropoff]);
  allPairs.push({ pickup: newPickup, dropoff: newDropoff });

  if (allStops.length <= 2) {
    const routePoints = [tripOrigin, ...allStops.map(w => ({ lat: w.lat, lng: w.lng })), tripDest];
    const validOrders = generateValidPermutations(allStops, allPairs);

    let bestRoute: OsrmRoute | null = null;
    let bestOrder: Waypoint[] = allStops;
    let bestDuration = Infinity;

    for (const order of validOrders) {
      const pts = [tripOrigin, ...order.map(w => ({ lat: w.lat, lng: w.lng })), tripDest];
      const route = await getOsrmRoute(pts);
      if (route && route.duration < bestDuration) {
        bestDuration = route.duration;
        bestRoute = route;
        bestOrder = order;
      }
    }

    if (!bestRoute) {
      const fallbackRoute = await getOsrmRoute(routePoints);
      if (!fallbackRoute) return null;
      bestRoute = fallbackRoute;
      bestDuration = fallbackRoute.duration;
    }

    return {
      detourMinutes: bestDuration - originalDuration,
      newWaypoints: [
        { lat: tripOrigin.lat, lng: tripOrigin.lng, type: "origin" },
        ...bestOrder,
        { lat: tripDest.lat, lng: tripDest.lng, type: "destination" },
      ],
      newRoute: bestRoute,
    };
  }

  const validPerms = generateValidPermutations(allStops, allPairs);

  if (validPerms.length === 0) {
    return null;
  }

  const ranked = validPerms
    .map(order => ({
      order,
      dist: estimateRouteDist(tripOrigin, order, tripDest),
    }))
    .sort((a, b) => a.dist - b.dist);

  const topK = Math.min(3, ranked.length);
  let bestRoute: OsrmRoute | null = null;
  let bestOrder: Waypoint[] | null = null;
  let bestDuration = Infinity;

  for (let i = 0; i < topK; i++) {
    const order = ranked[i].order;
    const pts = [tripOrigin, ...order.map(w => ({ lat: w.lat, lng: w.lng })), tripDest];
    const route = await getOsrmRoute(pts);
    if (route && route.duration < bestDuration) {
      bestDuration = route.duration;
      bestRoute = route;
      bestOrder = order;
    }
  }

  if (!bestRoute || !bestOrder) return null;

  return {
    detourMinutes: bestDuration - originalDuration,
    newWaypoints: [
      { lat: tripOrigin.lat, lng: tripOrigin.lng, type: "origin" },
      ...bestOrder,
      { lat: tripDest.lat, lng: tripDest.lng, type: "destination" },
    ],
    newRoute: bestRoute,
  };
}

export async function optimizeRouteOrder(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
  waypoints: Waypoint[],
): Promise<{ optimizedWaypoints: Waypoint[]; route: OsrmRoute } | null> {
  const stops = waypoints.filter(wp => wp.type !== "origin" && wp.type !== "destination");
  if (stops.length === 0) {
    const route = await getOsrmRoute([origin, dest]);
    if (!route) return null;
    return {
      optimizedWaypoints: [
        { lat: origin.lat, lng: origin.lng, type: "origin" },
        { lat: dest.lat, lng: dest.lng, type: "destination" },
      ],
      route,
    };
  }

  const pairs = extractPairs(waypoints);
  const validPerms = generateValidPermutations(stops, pairs);

  if (validPerms.length === 0) {
    const route = await getOsrmRoute([origin, ...stops.map(s => ({ lat: s.lat, lng: s.lng })), dest]);
    if (!route) return null;
    return {
      optimizedWaypoints: [
        { lat: origin.lat, lng: origin.lng, type: "origin" },
        ...stops,
        { lat: dest.lat, lng: dest.lng, type: "destination" },
      ],
      route,
    };
  }

  const ranked = validPerms
    .map(order => ({ order, dist: estimateRouteDist(origin, order, dest) }))
    .sort((a, b) => a.dist - b.dist);

  const topK = Math.min(3, ranked.length);
  let bestRoute: OsrmRoute | null = null;
  let bestOrder: Waypoint[] | null = null;
  let bestDuration = Infinity;

  for (let i = 0; i < topK; i++) {
    const order = ranked[i].order;
    const pts = [origin, ...order.map(w => ({ lat: w.lat, lng: w.lng })), dest];
    const route = await getOsrmRoute(pts);
    if (route && route.duration < bestDuration) {
      bestDuration = route.duration;
      bestRoute = route;
      bestOrder = order;
    }
  }

  if (!bestRoute || !bestOrder) return null;

  return {
    optimizedWaypoints: [
      { lat: origin.lat, lng: origin.lng, type: "origin" },
      ...bestOrder,
      { lat: dest.lat, lng: dest.lng, type: "destination" },
    ],
    route: bestRoute,
  };
}

export function pointProgressAlongLine(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  point: { lat: number; lng: number },
): number {
  const dx = end.lng - start.lng;
  const dy = end.lat - start.lat;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  const t = ((point.lng - start.lng) * dx + (point.lat - start.lat) * dy) / lenSq;
  return Math.max(0, Math.min(1, t));
}

export function isAlongRoute(
  tripFrom: { lat: number; lng: number },
  tripTo: { lat: number; lng: number },
  rideFrom: { lat: number; lng: number },
  rideTo: { lat: number; lng: number },
): boolean {
  const pickupProgress = pointProgressAlongLine(tripFrom, tripTo, rideFrom);
  const dropoffProgress = pointProgressAlongLine(tripFrom, tripTo, rideTo);
  if (dropoffProgress <= pickupProgress) return false;

  const perpDistPickup = perpendicularDistKm(tripFrom, tripTo, rideFrom);
  const perpDistDropoff = perpendicularDistKm(tripFrom, tripTo, rideTo);
  return perpDistPickup <= 50 && perpDistDropoff <= 50;
}

export function perpendicularDistKm(
  lineStart: { lat: number; lng: number },
  lineEnd: { lat: number; lng: number },
  point: { lat: number; lng: number },
): number {
  const t = pointProgressAlongLine(lineStart, lineEnd, point);
  const projLat = lineStart.lat + t * (lineEnd.lat - lineStart.lat);
  const projLng = lineStart.lng + t * (lineEnd.lng - lineStart.lng);
  return haversineDistance(point.lat, point.lng, projLat, projLng);
}

export async function findMatchingTrip(
  fromCity: string,
  toCity: string,
  scheduledAt: Date,
  passengersNeeded: number,
  pickupCoords?: { lat: number; lng: number } | null,
  dropoffCoords?: { lat: number; lng: number } | null,
): Promise<TripMatch | null> {
  const timeWindowMinutes = getSettingNum("time_window_minutes", 60);
  const windowMs = timeWindowMinutes * 60 * 1000;
  const windowStart = new Date(scheduledAt.getTime() - windowMs);
  const windowEnd = new Date(scheduledAt.getTime() + windowMs);

  const trips = await db.select().from(ridesTable).where(and(
    inArray(ridesTable.status, ["accepted", "in_progress"]),
    sql`${ridesTable.riderPhone} IS NULL`,
    sql`${ridesTable.driverId} IS NOT NULL`,
    gte(ridesTable.scheduledAt, windowStart),
    sql`${ridesTable.scheduledAt} <= ${windowEnd}`,
    sql`(${ridesTable.seatsTotal} - ${ridesTable.seatsTaken}) >= ${passengersNeeded}`,
  ));

  if (trips.length === 0) return null;

  const scored: TripMatch[] = [];
  for (const trip of trips) {
    const freeSeats = (trip.seatsTotal ?? 0) - (trip.seatsTaken ?? 0);
    if (freeSeats < passengersNeeded) {
      clog.log(`[MATCH] Trip ${trip.id}: [ERROR] MATCH_FAILED: NO_SEATS — ${freeSeats} free < ${passengersNeeded} needed`);
      continue;
    }

    const exactMatch = citiesMatch(trip.fromCity, fromCity) && citiesMatch(trip.toCity, toCity);

    if (exactMatch) {
      const timeDiffMs = Math.abs(trip.scheduledAt.getTime() - scheduledAt.getTime());
      const timeScore = Math.max(0, 100 - (timeDiffMs / windowMs) * 100);
      const seatScore = Math.min(freeSeats * 10, 40);
      const ratingScore = (trip.driverRating || 4) * 5;
      scored.push({ trip, score: timeScore + seatScore + ratingScore });
      continue;
    }

    if (!pickupCoords || !dropoffCoords) continue;
    if (!trip.fromLat || !trip.fromLng || !trip.toLat || !trip.toLng) continue;

    const tripOrigin = { lat: trip.fromLat, lng: trip.fromLng };
    const tripDest = { lat: trip.toLat, lng: trip.toLng };

    if (!isAlongRoute(tripOrigin, tripDest, pickupCoords, dropoffCoords)) continue;

    const originalDuration = trip.routeDuration ?? trip.duration ?? 0;
    if (originalDuration <= 0) continue;

    const existingWaypoints = (Array.isArray(trip.waypoints) ? trip.waypoints : []) as Waypoint[];

    const detourResult = await calcDetour(
      tripOrigin, tripDest, existingWaypoints,
      pickupCoords, dropoffCoords, originalDuration,
    );

    const maxDetourMinutes = getSettingNum("max_detour_minutes", 15);
    if (!detourResult || detourResult.detourMinutes > maxDetourMinutes) continue;

    const timeDiffMs = Math.abs(trip.scheduledAt.getTime() - scheduledAt.getTime());
    const timeScore = Math.max(0, 100 - (timeDiffMs / windowMs) * 100);
    const seatScore = Math.min(freeSeats * 10, 40);
    const ratingScore = (trip.driverRating || 4) * 5;
    const detourPenalty = detourResult.detourMinutes * 3;
    const alongRouteBonus = 20;

    scored.push({
      trip,
      score: timeScore + seatScore + ratingScore - detourPenalty + alongRouteBonus,
      detourMinutes: detourResult.detourMinutes,
      isAlongRoute: true,
      newWaypoints: detourResult.newWaypoints,
      newRoute: detourResult.newRoute,
    });
  }

  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

