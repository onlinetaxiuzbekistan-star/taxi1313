import { Router, type IRouter } from "express";
import { db, ridesTable, usersTable, tariffsTable, orderOffersTable, ridePassengersTable, districtsTable, settingsTable, routesTable, routeOptionsTable, transactionsTable, driverGroupsTable, citiesTable } from "@workspace/db";
import { eq, desc, asc, and, sql, inArray, gte, lte, like, or, ilike } from "drizzle-orm";
import { broadcastToAll, broadcastToUser } from "../lib/websocket.js";
import { startAutoDispatch, getOfferStatus, stopDispatchLoop, citiesMatch, addUnassignCooldown } from "../lib/autodispatch.js";
import { addToBuffer, isBatchEnabled } from "../lib/ride-buffer.js";
import { completeRide } from "../lib/completion.js";
import { authMiddleware, requireRole, AuthRequest } from "../middlewares/auth.js";
import { getMarketplaceSettings } from "../lib/settings.js";
import { getSettingNum, getSettingBool, getSetting } from "../lib/settingsCache.js";
import { applySurgeToPrice, isRevenueAIProdEnabled, enableRevenueAIProd, getRevenueAIProdSurge } from "../lib/revenue-ai-prod.js";
import { notifyRideStatusChange } from "../lib/sms-notifications.js";
import jwt from "jsonwebtoken";

import { JWT_SECRET } from "../lib/jwt-secret.js";
function enrichPassengersWithRouteInfo(passengers: any[], ride: any) {
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

const router: IRouter = Router();

const SURGE_DEFAULTS: Record<string, string> = {
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

function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function isInTimeRange(nowMin: number, startStr: string, endStr: string): boolean {
  const s = parseTime(startStr);
  const e = parseTime(endStr);
  if (s <= e) return nowMin >= s && nowMin < e;
  return nowMin >= s || nowMin < e;
}

async function getDemandSupplyRatio(): Promise<{ ratio: number; activeRides: number; availableDrivers: number }> {
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

async function getSurgeMultiplier(isUrgent: boolean): Promise<{
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

const CITIES: Record<string, { lat: number; lng: number; nameRu: string }> = {
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

export { CITIES };

const CITIES_RU_MAP: Record<string, string> = {};
for (const [key, val] of Object.entries(CITIES)) {
  CITIES_RU_MAP[val.nameRu.toLowerCase()] = key;
}

function findCity(name: string) {
  const lower = name.toLowerCase();
  return CITIES[lower] || CITIES[CITIES_RU_MAP[lower] || ""];
}

import { getOsrmRoute, haversineDistance, type OsrmRoute } from "../lib/osrm.js";


import jwt from "jsonwebtoken";
import { JWT_SECRET as __JWT_SECRET_FOR_BRANCH } from "../lib/jwt-secret.js";
import { db as __db_branch, usersTable as __users_branch } from "@workspace/db";
import { eq as __eq_branch } from "drizzle-orm";

const __branchOfUserCache = new Map<number, { v: number | null; ts: number }>();
async function __getRequesterBranchScope(req: any): Promise<{ role?: string; branchId: number | null }> {
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
async function __getRequesterIdentity(req: any): Promise<{ role?: string; userId?: number }> {
  try {
    const h = req.headers?.authorization;
    if (!h || !h.startsWith("Bearer ")) return {};
    const dec = jwt.verify(h.substring(7), __JWT_SECRET_FOR_BRANCH) as { userId?: number; role?: string };
    if (!dec?.userId) return {};
    return { role: dec.role, userId: Number(dec.userId) };
  } catch { return {}; }
}

function calcDistanceFallback(city1: string, city2: string): number {
  const c1 = findCity(city1);
  const c2 = findCity(city2);
  if (!c1 || !c2) return 200;
  return haversineDistance(c1.lat, c1.lng, c2.lat, c2.lng);
}

async function calcRouteDistance(city1: string, city2: string): Promise<{ distance: number; duration: number }> {
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

async function calcPrice(fromCity: string, toCity: string, _passengers: number, carClass: string, _distance?: number) {
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
  console.log("ROUTE PRICE back:", priceBack, "front:", priceFront, "route:", route.fromCity, "→", route.toCity);
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


interface Waypoint {
  lat: number;
  lng: number;
  type: "origin" | "destination" | "pickup" | "dropoff";
  rideId?: number;
  label?: string;
}

interface TripMatch {
  trip: typeof ridesTable.$inferSelect;
  score: number;
  detourMinutes?: number;
  isAlongRoute?: boolean;
  newWaypoints?: Waypoint[];
  newRoute?: OsrmRoute;
}

interface PickupDropoffPair {
  pickup: Waypoint;
  dropoff: Waypoint;
}

function extractPairs(waypoints: Waypoint[]): PickupDropoffPair[] {
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

function wpKey(wp: Waypoint): string {
  return `${wp.type}:${wp.rideId ?? ""}:${wp.lat},${wp.lng}`;
}

function buildPairMap(stops: Waypoint[], pairs: PickupDropoffPair[]): Map<string, string> {
  const dropoffToPickup = new Map<string, string>();
  for (const pair of pairs) {
    const pickupK = wpKey(pair.pickup);
    const dropoffK = wpKey(pair.dropoff);
    dropoffToPickup.set(dropoffK, pickupK);
  }
  return dropoffToPickup;
}

function isValidOrder(order: Waypoint[], dropoffToPickup: Map<string, string>): boolean {
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

function generateValidPermutations(stops: Waypoint[], pairs: PickupDropoffPair[]): Waypoint[][] {
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

function estimateRouteDist(
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

async function calcDetour(
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

async function optimizeRouteOrder(
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

function pointProgressAlongLine(
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

function isAlongRoute(
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

function perpendicularDistKm(
  lineStart: { lat: number; lng: number },
  lineEnd: { lat: number; lng: number },
  point: { lat: number; lng: number },
): number {
  const t = pointProgressAlongLine(lineStart, lineEnd, point);
  const projLat = lineStart.lat + t * (lineEnd.lat - lineStart.lat);
  const projLng = lineStart.lng + t * (lineEnd.lng - lineStart.lng);
  return haversineDistance(point.lat, point.lng, projLat, projLng);
}

async function findMatchingTrip(
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
      console.log(`[MATCH] Trip ${trip.id}: [ERROR] MATCH_FAILED: NO_SEATS — ${freeSeats} free < ${passengersNeeded} needed`);
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

router.get("/cities", async (_req, res) => {
  try {
    const rows = await db.select().from(citiesTable).orderBy(citiesTable.nameRu);
    const cities = rows
      .filter(c => c.isActive && c.slug)
      .map(c => ({ id: c.slug!, name: c.slug!, nameRu: c.nameRu, nameUz: c.nameUz, slug: c.slug!, lat: c.lat, lng: c.lng }));
    res.json({ cities });
  } catch {
    res.json({ cities: Object.entries(CITIES).map(([id, c]) => ({ id, name: id, nameRu: c.nameRu, slug: id, lat: c.lat, lng: c.lng })) });
  }
});

router.get("/pricing-info", async (_req, res) => {
  try {
    const surge = await getSurgeMultiplier(false);
    const surgeUrgent = await getSurgeMultiplier(true);
    // Default 10 to match completion.ts (the authoritative charge path) so this
    // estimate never diverges from what the driver is actually charged.
    const commissionPercent = getSettingNum("commission_percent", 10);
    const commissionFixed = getSettingNum("commission_fixed", 0);

    res.json({
      currentMultiplier: surge.multiplier,
      urgentMultiplier: surgeUrgent.multiplier,
      breakdown: surge.breakdown,
      commission: {
        percent: commissionPercent,
        fixed: commissionFixed,
      },
      isHighDemand: surge.breakdown.demandRatio > parseFloat(getSetting("demand_threshold", "1.5")),
      isNight: surge.breakdown.timePeriod === "night",
      isPeakHour: surge.breakdown.timePeriod === "morning_peak" || surge.breakdown.timePeriod === "evening_peak",
    });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/price-estimate", async (req, res) => {
  try {
    const { fromCity, toCity, carClass, fromDistrictId, toDistrictId, roundTrip, seatPosition, selectedOptions, frontSeats, backSeats } = req.body;
    const tariff = carClass || "economy";
    const result = await calcPrice(fromCity, toCity, 1, tariff);

    if (!result.price || result.price <= 0) {
      res.status(400).json({ error: "tariff_missing", message: "Тариф не настроен для данного маршрута" });
      return;
    }

    const nFront = typeof frontSeats === "number" ? Math.max(0, Math.min(1, frontSeats)) : 0;
    const nBack = typeof backSeats === "number" ? Math.max(0, Math.min(3, backSeats)) : 0;

    let seatTotal: number;
    if (nFront > 0 || nBack > 0) {
      seatTotal = (nFront * result.priceFront) + (nBack * result.priceBack);
    } else {
      const isFront = seatPosition === "front";
      seatTotal = isFront ? result.priceFront : result.priceBack;
    }

    let fromDistrictCharge = 0;
    let toDistrictCharge = 0;
    if (fromDistrictId) {
      const [d] = await db.select().from(districtsTable).where(eq(districtsTable.id, Number(fromDistrictId)));
      if (d) fromDistrictCharge = d.extraCharge;
    }
    if (toDistrictId) {
      const [d] = await db.select().from(districtsTable).where(eq(districtsTable.id, Number(toDistrictId)));
      if (d) toDistrictCharge = d.extraCharge;
    }

    let optionsTotal = 0;
    let optionsCommission = 0;
    if (Array.isArray(selectedOptions) && selectedOptions.length > 0 && result.routeId) {
      const routeOpts = await db.select().from(routeOptionsTable)
        .where(and(
          eq(routeOptionsTable.routeId, result.routeId),
          eq(routeOptionsTable.tariffClass, tariff),
          eq(routeOptionsTable.isActive, true)
        ));
      const optsMap = new Map(routeOpts.map(o => [o.optionKey, o]));
      const validOptions = [...new Set(selectedOptions as string[])].filter((key: string) => optsMap.has(key));
      for (const key of validOptions) {
        const opt = optsMap.get(key);
        if (opt) { optionsTotal += opt.price; optionsCommission += (opt.commission || 0); }
      }
    }

    let price = seatTotal + fromDistrictCharge + toDistrictCharge + optionsTotal;

    if (roundTrip) {
      const total = price * 2;
      let discountPercent = result.roundTripDiscountPercent ?? 0;
      if (discountPercent < 0) discountPercent = 0;
      if (discountPercent > 100) discountPercent = 100;
      const discountAmount = Math.round(total * (discountPercent / 100));
      price = total - discountAmount;
      if (price <= 0) price = total;
    }

    if (!Number.isFinite(price) || price <= 0) {
      price = seatTotal;
    }

    console.log("SEAT TOTAL:", seatTotal, "front:", nFront, "back:", nBack, "FINAL PRICE:", price);

    res.json({
      price: Math.round(price),
      priceFront: Math.round(result.priceFront),
      priceBack: Math.round(result.priceBack),
    });
  } catch (err) {
    req.log.error({ err }, "Price estimate error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

function buildArchiveFilters(q: Record<string, string>) {
  const conditions: any[] = [];
  const validStatuses = ["pending", "offered", "accepted", "in_progress", "completed", "cancelled"];

  if (q.status) {
    const statuses = q.status.split(",").map(s => s.trim()).filter(s => validStatuses.includes(s));
    if (statuses.length === 1) conditions.push(eq(ridesTable.status, statuses[0] as any));
    else if (statuses.length > 1) conditions.push(inArray(ridesTable.status, statuses as any[]));
  }
  if (q.orderId) {
    const oid = parseInt(q.orderId);
    if (!isNaN(oid) && oid > 0) conditions.push(eq(ridesTable.id, oid));
  }
  if (q.clientPhone) {
    const phone = q.clientPhone.replace(/[^0-9+]/g, "");
    if (phone.length >= 3) conditions.push(ilike(ridesTable.riderPhone, `%${phone}%`));
  }
  if (q.driverCarNumber) {
    const plate = q.driverCarNumber.trim();
    if (plate.length >= 2) conditions.push(ilike(ridesTable.driverCarNumber, `%${plate}%`));
  }
  if (q.driverName) {
    const name = q.driverName.trim();
    if (name.length >= 2) conditions.push(ilike(ridesTable.driverName, `%${name}%`));
  }
  if (q.fromCity) conditions.push(eq(ridesTable.fromCity, q.fromCity));
  if (q.toCity) conditions.push(eq(ridesTable.toCity, q.toCity));
  if (q.carClass && ["economy", "comfort", "business"].includes(q.carClass)) conditions.push(eq(ridesTable.carClass, q.carClass));
  if (q.source) conditions.push(eq(ridesTable.source, q.source));
  if (q.dateFrom) {
    const d = new Date(q.dateFrom);
    if (!isNaN(d.getTime())) conditions.push(gte(ridesTable.createdAt, d));
  }
  if (q.dateTo) {
    const d = new Date(q.dateTo);
    if (!isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); conditions.push(lte(ridesTable.createdAt, d)); }
  }
  if (q.noDriver === "true") {
    conditions.push(sql`${ridesTable.driverId} IS NULL`);
  }
  if (q.problemOrders === "true") {
    conditions.push(or(
      eq(ridesTable.status, "cancelled" as any),
      sql`${ridesTable.driverId} IS NULL`,
      sql`(${ridesTable.status} IN ('pending','offered') AND ${ridesTable.createdAt} < now() - interval '30 minutes')`
    ));
  }
  if (q.search) {
    const s = q.search.trim().slice(0, 100);
    if (s) {
      const num = parseInt(s);
      if (!isNaN(num) && num > 0) {
        conditions.push(or(eq(ridesTable.id, num), ilike(ridesTable.riderPhone, `%${s}%`), ilike(ridesTable.driverPhone, `%${s}%`)));
      } else {
        conditions.push(or(
          ilike(ridesTable.riderName, `%${s}%`), ilike(ridesTable.riderPhone, `%${s}%`),
          ilike(ridesTable.driverName, `%${s}%`), ilike(ridesTable.driverCarNumber, `%${s}%`),
          ilike(ridesTable.fromCity, `%${s}%`), ilike(ridesTable.toCity, `%${s}%`),
        ));
      }
    }
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

router.get("/archive", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const q = req.query as Record<string, string>;
    const page = Math.max(1, parseInt(q.page || "1") || 1);
    const perPage = Math.min(100, Math.max(10, parseInt(q.perPage || "30") || 30));
    const offset = (page - 1) * perPage;

    const whereClause = buildArchiveFilters(q);

    const validSorts = ["createdAt", "price", "id"];
    const sortKey = validSorts.includes(q.sort) ? q.sort : "createdAt";
    const sortField = sortKey === "price" ? ridesTable.price : sortKey === "id" ? ridesTable.id : ridesTable.createdAt;
    const sortDir = q.sortDir === "asc" ? asc(sortField) : desc(sortField);

    let dataQuery = db.select().from(ridesTable).$dynamic();
    if (whereClause) dataQuery = dataQuery.where(whereClause);
    const rides = await dataQuery.orderBy(sortDir).limit(perPage).offset(offset);

    const statsQuery = db.select({
      total: sql<number>`count(*)`,
      completed: sql<number>`count(*) filter (where ${ridesTable.status} = 'completed')`,
      cancelled: sql<number>`count(*) filter (where ${ridesTable.status} = 'cancelled')`,
      revenue: sql<number>`coalesce(sum(${ridesTable.price}) filter (where ${ridesTable.status} = 'completed'), 0)`,
      problemCount: sql<number>`count(*) filter (where ${ridesTable.status} = 'cancelled' or ${ridesTable.driverId} is null or (${ridesTable.status} in ('pending','offered') and ${ridesTable.createdAt} < now() - interval '30 minutes'))`,
      avgDurationMin: sql<number>`coalesce(avg(extract(epoch from (${ridesTable.updatedAt} - ${ridesTable.createdAt})) / 60) filter (where ${ridesTable.status} = 'completed'), 0)`,
    }).from(ridesTable).$dynamic();
    const filteredStatsQuery = whereClause ? statsQuery.where(whereClause) : statsQuery;
    const [stats] = await filteredStatsQuery;

    res.json({
      rides,
      total: Number(stats.total),
      completed: Number(stats.completed),
      cancelled: Number(stats.cancelled),
      revenue: Number(stats.revenue),
      problemCount: Number(stats.problemCount),
      avgDurationMin: Math.round(Number(stats.avgDurationMin)),
      page,
      perPage,
    });
  } catch (err) {
    req.log.error({ err }, "Archive rides error");
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/archive/export", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const q = req.query as Record<string, string>;
    const whereClause = buildArchiveFilters(q);

    let dataQuery = db.select().from(ridesTable).$dynamic();
    if (whereClause) dataQuery = dataQuery.where(whereClause);
    const rides = await dataQuery.orderBy(desc(ridesTable.createdAt)).limit(5000);

    const header = "ID,Дата,Клиент,Телефон,Откуда,Куда,Водитель,Авто,Гос.номер,Тариф,Статус,Цена,Оплата,Источник\n";
    const statusLabels: Record<string, string> = { pending: "Ожидает", offered: "Предложен", accepted: "Принят", in_progress: "В пути", completed: "Завершён", cancelled: "Отменён" };
    const csvSafe = (v: any) => {
      let s = String(v ?? "").replace(/"/g, '""');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return `"${s}"`;
    };
    const rows = rides.map(r => [
      r.id,
      csvSafe(r.createdAt ? new Date(r.createdAt).toLocaleString("ru-RU") : ""),
      csvSafe(r.riderName || ""), csvSafe(r.riderPhone || ""),
      csvSafe(r.fromCity), csvSafe(r.toCity),
      csvSafe(r.driverName || ""), csvSafe(r.driverCar || ""), csvSafe(r.driverCarNumber || ""),
      csvSafe(r.carClass), csvSafe(statusLabels[r.status] || r.status),
      r.price || 0, csvSafe(r.paymentType), csvSafe(r.source || "dispatch"),
    ].join(",")).join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="archive_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send("\uFEFF" + header + rows);
  } catch (err) {
    req.log.error({ err }, "Export archive error");
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/:id/transactions", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.params.id);
    if (isNaN(rideId)) return res.status(400).json({ error: "invalid_ride_id" });
    const txs = await db.select({
      id: transactionsTable.id,
      driverId: transactionsTable.driverId,
      rideId: transactionsTable.rideId,
      type: transactionsTable.type,
      amount: transactionsTable.amount,
      balanceBefore: transactionsTable.balanceBefore,
      balanceAfter: transactionsTable.balanceAfter,
      description: transactionsTable.description,
      createdAt: transactionsTable.createdAt,
      updatedBy: transactionsTable.updatedBy,
      updatedAt: transactionsTable.updatedAt,
      driverName: usersTable.name,
    })
      .from(transactionsTable)
      .leftJoin(usersTable, eq(transactionsTable.driverId, usersTable.id))
      .where(eq(transactionsTable.rideId, rideId))
      .orderBy(desc(transactionsTable.createdAt));
    res.json({ transactions: txs });
  } catch (err) {
    req.log.error({ err }, "Get ride transactions error");
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/:id/transactions", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.params.id);
    if (isNaN(rideId)) return res.status(400).json({ error: "invalid_ride_id" });
    const { type, amount, comment } = req.body;
    if (!type || amount == null) return res.status(400).json({ error: "type_and_amount_required" });
    const validTypes = ["income", "commission", "bonus", "penalty", "adjust", "refund", "withdraw"];
    if (!validTypes.includes(type)) return res.status(400).json({ error: "invalid_type" });
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) return res.status(400).json({ error: "invalid_amount" });

    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
    if (!ride) return res.status(404).json({ error: "ride_not_found" });

    const driverId = ride.driverId;
    let balanceBefore: string | null = null;
    let balanceAfter: string | null = null;

    if (driverId) {
      const result = await db.transaction(async (tx) => {
        const [driver] = await tx.select().from(usersTable).where(eq(usersTable.id, driverId)).for("update");
        if (!driver) return null;
        balanceBefore = driver.balance?.toString() || "0";
        const newBalance = parseFloat(balanceBefore) + numAmount;
        balanceAfter = newBalance.toFixed(2);
        await tx.update(usersTable).set({ balance: balanceAfter }).where(eq(usersTable.id, driverId));
        const [inserted] = await tx.insert(transactionsTable).values({
          driverId,
          rideId,
          type,
          amount: numAmount.toFixed(2),
          balanceBefore,
          balanceAfter,
          description: comment || null,
          updatedBy: (req as AuthRequest).userId || null,
        }).returning();
        return inserted;
      });
      if (!result) return res.status(404).json({ error: "driver_not_found" });
      res.json({ transaction: result, driverBalance: balanceAfter });
    } else {
      const [inserted] = await db.insert(transactionsTable).values({
        driverId: null,
        rideId,
        type,
        amount: numAmount.toFixed(2),
        description: comment || null,
        updatedBy: (req as AuthRequest).userId || null,
      }).returning();
      res.json({ transaction: inserted });
    }
  } catch (err) {
    req.log.error({ err }, "Create ride transaction error");
    res.status(500).json({ error: "server_error" });
  }
});

router.patch("/:rideId/transactions/:txId", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.params.rideId);
    const txId = parseInt(req.params.txId);
    if (isNaN(rideId) || isNaN(txId)) return res.status(400).json({ error: "invalid_ids" });
    const { amount, comment } = req.body;
    if (amount !== undefined && isNaN(parseFloat(amount))) return res.status(400).json({ error: "invalid_amount" });

    let driverBalance: string | null = null;

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(transactionsTable)
        .where(and(eq(transactionsTable.id, txId), eq(transactionsTable.rideId, rideId)))
        .for("update");
      if (!existing) return null;

      const updates: any = { updatedBy: req.user!.id, updatedAt: new Date() };
      if (comment !== undefined) updates.description = comment;

      if (amount !== undefined && existing.driverId) {
        const newAmount = parseFloat(amount);
        const oldAmount = parseFloat(existing.amount);
        const diff = newAmount - oldAmount;

        const [driver] = await tx.select().from(usersTable).where(eq(usersTable.id, existing.driverId)).for("update");
        if (!driver) throw new Error("driver_not_found");
        const currentBalance = parseFloat(driver.balance?.toString() || "0");
        const updatedBalance = (currentBalance + diff).toFixed(2);
        await tx.update(usersTable).set({ balance: updatedBalance }).where(eq(usersTable.id, existing.driverId));
        updates.amount = newAmount.toFixed(2);
        updates.balanceAfter = updatedBalance;
        driverBalance = updatedBalance;
      } else if (amount !== undefined) {
        updates.amount = parseFloat(amount).toFixed(2);
      }

      await tx.update(transactionsTable).set(updates).where(eq(transactionsTable.id, txId));
      const [updated] = await tx.select().from(transactionsTable).where(eq(transactionsTable.id, txId));
      return updated;
    });

    if (!result) return res.status(404).json({ error: "transaction_not_found" });
    res.json({ transaction: result, driverBalance });
  } catch (err) {
    req.log.error({ err }, "Update ride transaction error");
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/", async (req, res) => {
  try {
    const { status, limit = "50", offset = "0", type } = req.query as Record<string, string>;
    const conditions: any[] = [];
    if (status) {
      const statuses = (status as string).split(",").map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        conditions.push(eq(ridesTable.status, statuses[0] as any));
      } else if (statuses.length > 1) {
        conditions.push(inArray(ridesTable.status, statuses as any[]));
      }
    }
    if (type === "ride") {
      conditions.push(sql`${ridesTable.riderPhone} IS NOT NULL`);
    } else if (type === "trip") {
      conditions.push(sql`${ridesTable.riderPhone} IS NULL AND ${ridesTable.driverId} IS NOT NULL`);
    }
    const _scope = await __getRequesterBranchScope(req);
    const _me = await __getRequesterIdentity(req);
    // Anonymous callers must NOT receive the global ride feed (was a data leak). Return empty.
    if (!_scope.role) {
      res.json({ rides: [], total: 0 });
      return;
    }
    if (_scope.role === "rider") {
      // Riders only ever see their own rides.
      conditions.push(eq(ridesTable.riderId, _me.userId ?? -1));
    } else if (_scope.role !== "admin" && _scope.branchId != null) {
      // Dispatchers/staff are confined to their branch; admin sees everything.
      conditions.push(eq(ridesTable.branchId, _scope.branchId));
    }
    let query = db.select().from(ridesTable).$dynamic();
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    const rides = await query.orderBy(desc(ridesTable.createdAt)).limit(parseInt(limit)).offset(parseInt(offset));

    const countConditions = [...conditions];
    let countQuery = db.select({ count: sql<number>`count(*)` }).from(ridesTable).$dynamic();
    if (countConditions.length > 0) {
      countQuery = countQuery.where(and(...countConditions));
    }
    const [{ count }] = await countQuery;
    res.json({ rides, total: count });
  } catch (err) {
    req.log.error({ err }, "Get rides error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { fromCity, toCity, fromAddress, toAddress, scheduledAt, passengers, carClass, riderName, riderPhone, paymentType, comment, seats, fromDistrictId, toDistrictId, timeSlot, isUrgent, roundTrip, selectedOptions, gender, isMail, isMoney, requiredCarModel } = req.body;

    if (!fromCity || !toCity) {
      res.status(400).json({ error: "validation_error", message: "fromCity and toCity are required" });
      return;
    }

    let userRole: string | null = null;
    let creatorUserId: number | null = null;
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        if (token) {
          const decoded = jwt.verify(token, JWT_SECRET) as any;
          if (decoded && decoded.role && decoded.userId) {
            userRole = decoded.role;
            creatorUserId = Number(decoded.userId);
          }
        }
      }
    } catch (err: any) {
      if (process.env.NODE_ENV === "development") {
        console.warn("JWT parse failed:", err?.message);
      }
    }
    const isDispatcher = userRole === "dispatcher" || userRole === "admin";
    let creatorUserName: string | null = null;
    if (creatorUserId && isDispatcher) {
      try {
        const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, creatorUserId));
        if (u) creatorUserName = u.name;
      } catch {}
    }

    const mktCfg = await getMarketplaceSettings();

    if (!isDispatcher) {
      const maxActive = parseInt(mktCfg.max_active_orders) || 20;
      const maxPerDay = parseInt(mktCfg.max_orders_per_day) || 30;

      const [{ activeCount }] = await db.select({ activeCount: sql<number>`count(*)` })
        .from(ridesTable)
        .where(inArray(ridesTable.status, ["pending", "accepted", "in_progress"]));
      if (Number(activeCount) >= maxActive) {
        res.status(429).json({ error: "limit_exceeded", message: `Достигнут лимит активных заказов (${maxActive})` });
        return;
      }

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const [{ dayCount }] = await db.select({ dayCount: sql<number>`count(*)` })
        .from(ridesTable)
        .where(gte(ridesTable.createdAt, todayStart));
      if (Number(dayCount) >= maxPerDay) {
        res.status(429).json({ error: "limit_exceeded", message: `Достигнут суточный лимит заказов (${maxPerDay})` });
        return;
      }
    }

    const seatCount = Array.isArray(seats) ? seats.length : (passengers || 1);
    const tariff = carClass || "economy";
    const est = await calcPrice(fromCity, toCity, 1, tariff);

    let fromDistrictCharge = 0;
    let toDistrictCharge = 0;
    let fromDistrictData: any = null;
    let toDistrictData: any = null;

    if (fromDistrictId) {
      const [d] = await db.select().from(districtsTable).where(eq(districtsTable.id, Number(fromDistrictId)));
      if (d) { fromDistrictCharge = d.extraCharge; fromDistrictData = d; }
    }
    if (toDistrictId) {
      const [d] = await db.select().from(districtsTable).where(eq(districtsTable.id, Number(toDistrictId)));
      if (d) { toDistrictCharge = d.extraCharge; toDistrictData = d; }
    }

    const seatsArray = Array.isArray(seats) ? seats : [];
    const hasFrontSeat = seatsArray.some((s: any) => s.seatNumber === 1);
    const frontCount = hasFrontSeat ? 1 : 0;
    const backCount = seatsArray.filter((s: any) => s.seatNumber !== 1).length;

    let basePrice = 0;
    basePrice += frontCount * (est.priceFront || 0);
    basePrice += backCount * (est.priceBack || 0);
    if (basePrice <= 0 && seatCount > 0) {
      basePrice = seatCount * (est.priceBack || est.price || 0);
    }

    // MAIL ORDER: override price from route.priceMail, no seat occupancy
    const isMailOrder = isMail === true;
    if (isMailOrder) {
      try {
        const [matchedRoute] = await db.select().from(routesTable)
          .where(and(eq(routesTable.fromCity, fromCity), eq(routesTable.toCity, toCity)));
        const mailPrice = matchedRoute && (matchedRoute as any).priceMail ? (matchedRoute as any).priceMail : 0;
        basePrice = mailPrice;
      } catch (e) { req.log?.warn?.({ e }, "mail price lookup failed"); }
    }

    let optionsTotal = 0;
    let optionsCommission = 0;
    if (Array.isArray(selectedOptions) && selectedOptions.length > 0 && est.routeId) {
      const routeOpts = await db.select().from(routeOptionsTable)
        .where(and(
          eq(routeOptionsTable.routeId, est.routeId),
          eq(routeOptionsTable.tariffClass, tariff),
          eq(routeOptionsTable.isActive, true)
        ));
      const optsMap = new Map(routeOpts.map(o => [o.optionKey, o]));
      const validOptions = [...new Set(selectedOptions as string[])].filter((key: string) => optsMap.has(key));
      for (const key of validOptions) {
        const opt = optsMap.get(key);
        if (opt) { optionsTotal += opt.price; optionsCommission += (opt.commission || 0); }
      }
    }

    let finalPrice = basePrice + (fromDistrictCharge || 0) + (toDistrictCharge || 0) + optionsTotal;

    if (roundTrip === true) {
      const total = finalPrice * 2;
      let discountPercent = est.roundTripDiscountPercent ?? 0;
      if (discountPercent < 0) discountPercent = 0;
      if (discountPercent > 100) discountPercent = 100;
      const discountAmount = Math.round(total * (discountPercent / 100));
      finalPrice = total - discountAmount;
      if (finalPrice <= 0) finalPrice = total;
    }

    if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
      finalPrice = seatCount * (est.priceBack || est.price || 0);
    }

    console.log("SAVE RIDE:", { seats: seatsArray.length, frontCount, backCount, priceFront: est.priceFront, priceBack: est.priceBack, basePrice, finalPrice, fromDistrictCharge, toDistrictCharge, optionsTotal, roundTrip });

    const fromCityData = findCity(fromCity);
    const toCityData = findCity(toCity);

    const fromLat = fromDistrictData?.lat || fromCityData?.lat || null;
    const fromLng = fromDistrictData?.lng || fromCityData?.lng || null;
    const toLat = toDistrictData?.lat || toCityData?.lat || null;
    const toLng = toDistrictData?.lng || toCityData?.lng || null;

    const scheduledDate = scheduledAt ? new Date(scheduledAt) : new Date();
    const msUntilScheduled = scheduledDate.getTime() - Date.now();
    const computedUrgent = isUrgent === true || (msUntilScheduled >= 0 && msUntilScheduled <= 10 * 60 * 1000);

    if (!est.distance || est.distance <= 0) {
      req.log.error({ fromCity, toCity, distance: est.distance }, "[ERROR] MATCH_FAILED: NO_PRICE — distance is zero or null");
      res.status(400).json({ error: "no_price", message: "Ошибка расчёта маршрута — расстояние не определено" });
      return;
    }

    const minOrderPrice = parseInt(mktCfg.min_order_price) || 0;
    const maxOrderPrice = parseInt(mktCfg.max_order_price) || 5000000;
    if (finalPrice < minOrderPrice) {
      res.status(400).json({ error: "price_too_low", message: `Цена заказа ниже минимума (${minOrderPrice.toLocaleString("ru-RU")} сум)` });
      return;
    }
    if (finalPrice > maxOrderPrice) {
      res.status(400).json({ error: "price_too_high", message: `Цена заказа превышает максимум (${maxOrderPrice.toLocaleString("ru-RU")} сум)` });
      return;
    }

    let requiredGroupLevel: number | null = null;
    if (tariff) {
      const [matchedGroup] = await db.select().from(driverGroupsTable).where(eq(driverGroupsTable.name, tariff));
      if (matchedGroup) {
        requiredGroupLevel = matchedGroup.level;
      }
    }

    {
      const __sc = await __getRequesterBranchScope(req);
      (req as any).__creatorBranchId = __sc.branchId;
    }
    const [ride] = await db.insert(ridesTable).values({
      fromCity, toCity, fromAddress, toAddress,
      scheduledAt: scheduledDate,
      passengers: isMailOrder ? 0 : seatCount,
      carClass: tariff,
      status: "pending",
      price: finalPrice,
      isMail: isMailOrder,
      isMoney: isMailOrder && isMoney === true,
      requiredCarModel: (typeof requiredCarModel === "string" && requiredCarModel.trim()) ? requiredCarModel.trim() : null,
        branchId: (req as any).__creatorBranchId ?? null,
        optionsTotal: Math.round(optionsTotal || 0),
        optionsCommission: Math.round(optionsCommission || 0),
      distance: est.distance,
      duration: est.duration,
      riderName, riderPhone,
      paymentType: paymentType || "cash",
      comment: comment || null,
      fromLat, fromLng, toLat, toLng,
      fromDistrictId: fromDistrictData?.id || null,
      toDistrictId: toDistrictData?.id || null,
      fromDistrictName: fromDistrictData?.name || null,
      toDistrictName: toDistrictData?.name || null,
      fromDistrictCharge,
      toDistrictCharge,
      basePrice,
      timeSlot: timeSlot || null,
      isUrgent: computedUrgent,
      roundTrip: roundTrip === true,
      source: computedUrgent ? "urgent" : "dispatch",
      mode: computedUrgent ? "market" : "dispatch",
      requiredGroupLevel,
      selectedOptions: Array.isArray(selectedOptions) ? (selectedOptions as string[]).filter((k: any) => typeof k === "string") : [],
      createdByUserId: creatorUserId,
      createdByUserName: creatorUserName,
    }).returning();

    if (!isMailOrder && Array.isArray(seats) && seats.length > 0) {
      for (const seat of seats) {
        await db.insert(ridePassengersTable).values({
          rideId: ride.id,
          name: seat.name || "",
          phone: seat.phone || null,
          pickupAddress: seat.pickupAddress || null,
          dropoffAddress: seat.dropoffAddress || null,
          pickupLat: seat.pickupLat != null ? Number(seat.pickupLat) : null,
          pickupLng: seat.pickupLng != null ? Number(seat.pickupLng) : null,
          seatNumber: seat.seatNumber || 1,
          price: Number(seat.price) || 0,
          baggageType: seat.baggageType || "none",
          gender: seat.gender || gender || "male",
        });
      }
    } else if (seatCount > 0) {
      const perSeatPrice = Math.round(finalPrice / seatCount);
      for (let i = 1; i <= seatCount; i++) {
        await db.insert(ridePassengersTable).values({
          rideId: ride.id,
          name: riderName || "",
          phone: riderPhone || null,
          seatNumber: i,
          price: perSeatPrice,
          baggageType: "none",
          gender: gender || "male",
        });
      }
    }

    const ridePassengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, ride.id));

    console.log("PASSENGERS:", {
      rideId: ride.id,
      seats: Array.isArray(seats) ? seats.length : 0,
      passengersCount: ridePassengers.length,
      seatCount,
      storedPassengers: ride.passengers,
    });

    broadcastToAll({ type: "new_ride", ride: { ...ride, seatPassengers: enrichPassengersWithRouteInfo(ridePassengers, ride) } });

    if (isBatchEnabled()) {
      req.log.info({ rideId: ride.id }, "Ride created, added to batch buffer");
      addToBuffer(ride.id, fromCity, toCity, carClass || "economy");
    } else {
      req.log.info({ rideId: ride.id, seats: ridePassengers.length }, "Ride created, dispatching");
      startAutoDispatch(ride.id, fromCity).catch(err =>
        req.log.error({ err, rideId: ride.id }, "Auto-dispatch error")
      );
    }

    res.status(201).json({ ...ride, seatPassengers: enrichPassengersWithRouteInfo(ridePassengers, ride) });
  } catch (err: any) {
    console.error("CREATE RIDE ERROR:", err);
    req.log.error({ err }, "Create ride error");
    res.status(500).json({ error: "server_error", message: err?.message || "Internal server error" });
  }
});

router.get("/urgent", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { fromCity, toCity } = req.query as Record<string, string>;
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

    // Show in "Срочные":
    //  - orders whose scheduled time is within the next 1 hour (so drivers see them in advance), or
    //  - orders that started up to 3 hours ago and still nobody took.
    let query = db.select().from(ridesTable)
      .where(
        and(
          inArray(ridesTable.status, ["pending", "offered"]),
          sql`${ridesTable.scheduledAt} <= ${oneHourFromNow}`,
          sql`${ridesTable.scheduledAt} >= ${threeHoursAgo}`,
        )
      )
      .$dynamic();

    if (fromCity && toCity) {
      query = query.where(and(
        eq(ridesTable.fromCity, fromCity),
        eq(ridesTable.toCity, toCity),
      ));
    } else if (fromCity) {
      query = query.where(eq(ridesTable.fromCity, fromCity));
    }

    const rides = await query.orderBy(asc(ridesTable.scheduledAt)).limit(40);

    const activeOffers = await db
      .select({ rideId: orderOffersTable.rideId })
      .from(orderOffersTable)
      .where(eq(orderOffersTable.status, "pending"));
    const rideIdsWithActiveOffers = new Set(activeOffers.map(o => o.rideId));

    const urgentRides = rides.filter(r => !rideIdsWithActiveOffers.has(r.id));

    const ridesWithPassengers = await Promise.all(urgentRides.slice(0, 20).map(async (ride) => {
      const passengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, ride.id));
      return { ...ride, hasActiveOffer: false, seatPassengers: enrichPassengersWithRouteInfo(passengers, ride) };
    }));

    res.json({ rides: ridesWithPassengers });
  } catch (err) {
    req.log.error({ err }, "Get urgent rides error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, parseInt(req.params.id)));
    if (!ride) { res.status(404).json({ error: "not_found", message: "Ride not found" }); return; }

    const me = await __getRequesterIdentity(req);
    const isStaff = me.role === "dispatcher" || me.role === "admin";
    const isAssignedDriver = me.role === "driver" && ride.driverId === me.userId;
    const isOwnerRider = me.userId != null && ride.riderId === me.userId;

    // Authorized parties get the full record (incl. passengers, financials, contacts).
    if (isStaff || isAssignedDriver || isOwnerRider) {
      const seatPassengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, ride.id));
      res.json({ ...ride, seatPassengers: enrichPassengersWithRouteInfo(seatPassengers, ride) });
      return;
    }

    // Guests (unauthenticated rider tracking) get a sanitized view: enough to track the ride,
    // but no other people's contacts and no internal financials (commission/payout/basePrice).
    res.json({
      id: ride.id,
      status: ride.status,
      fromCity: ride.fromCity,
      toCity: ride.toCity,
      fromAddress: ride.fromAddress,
      toAddress: ride.toAddress,
      scheduledAt: ride.scheduledAt,
      passengers: ride.passengers,
      carClass: ride.carClass,
      price: ride.price,
      distance: ride.distance,
      duration: ride.duration,
      isUrgent: ride.isUrgent,
      driverName: ride.driverName,
      driverCar: ride.driverCar,
      driverCarNumber: ride.driverCarNumber,
      driverRating: ride.driverRating,
      createdAt: ride.createdAt,
      updatedAt: ride.updatedAt,
    });
  } catch (err) {
    req.log.error({ err }, "Get ride error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.patch("/:id", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const { status, driverId, fromCity, toCity, fromAddress, toAddress,
            passengers, carClass, price, comment, riderName, riderPhone, paymentType,
            fromDistrictId, toDistrictId } = req.body;
    const rideId = parseInt(req.params.id);

    const [existing] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Заказ не найден" });
      return;
    }

    if (["completed", "cancelled"].includes(existing.status as string) && !status) {
      res.status(400).json({ error: "invalid_state", message: "Нельзя редактировать завершённый или отменённый заказ" });
      return;
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };

    if (status) updateData.status = status;
    if (fromCity !== undefined) {
      updateData.fromCity = fromCity;
      const c = CITIES[fromCity.toLowerCase()];
      if (c) { updateData.fromLat = c.lat; updateData.fromLng = c.lng; }
    }
    if (toCity !== undefined) {
      updateData.toCity = toCity;
      const c = CITIES[toCity.toLowerCase()];
      if (c) { updateData.toLat = c.lat; updateData.toLng = c.lng; }
    }
    if (fromAddress !== undefined) updateData.fromAddress = fromAddress;
    if (toAddress !== undefined) updateData.toAddress = toAddress;
    if (passengers !== undefined) {
      const p = parseInt(passengers);
      if (p < 1 || p > 8) {
        res.status(400).json({ error: "validation_error", message: "Количество пассажиров: от 1 до 8" });
        return;
      }
      updateData.passengers = p;
    }
    if (carClass !== undefined) {
      if (!["economy", "comfort", "business"].includes(carClass)) {
        res.status(400).json({ error: "validation_error", message: "Недопустимый класс авто" });
        return;
      }
      updateData.carClass = carClass;
    }
    if (fromDistrictId !== undefined) {
      if (fromDistrictId === null || fromDistrictId === "") {
        updateData.fromDistrictId = null;
        updateData.fromDistrictName = null;
        updateData.fromDistrictCharge = 0;
      } else {
        const [d] = await db.select().from(districtsTable).where(eq(districtsTable.id, Number(fromDistrictId)));
        if (d) {
          updateData.fromDistrictId = d.id;
          updateData.fromDistrictName = d.name;
          updateData.fromDistrictCharge = d.extraCharge || 0;
          if (d.lat && d.lng) { updateData.fromLat = d.lat; updateData.fromLng = d.lng; }
        }
      }
    }
    if (toDistrictId !== undefined) {
      if (toDistrictId === null || toDistrictId === "") {
        updateData.toDistrictId = null;
        updateData.toDistrictName = null;
        updateData.toDistrictCharge = 0;
      } else {
        const [d] = await db.select().from(districtsTable).where(eq(districtsTable.id, Number(toDistrictId)));
        if (d) {
          updateData.toDistrictId = d.id;
          updateData.toDistrictName = d.name;
          updateData.toDistrictCharge = d.extraCharge || 0;
          if (d.lat && d.lng) { updateData.toLat = d.lat; updateData.toLng = d.lng; }
        }
      }
    }
        if (price !== undefined) {
      const pr = parseFloat(price);
      if (pr < 0) {
        res.status(400).json({ error: "validation_error", message: "Цена не может быть отрицательной" });
        return;
      }
      updateData.price = pr;
    }
    if (comment !== undefined) updateData.comment = comment;
    if (riderName !== undefined) updateData.riderName = riderName;
    if (riderPhone !== undefined) updateData.riderPhone = riderPhone;
    if (paymentType !== undefined) {
      if (!["cash", "card", "transfer"].includes(paymentType)) {
        res.status(400).json({ error: "validation_error", message: "Недопустимый тип оплаты" });
        return;
      }
      updateData.paymentType = paymentType;
    }

    if (driverId && status !== "accepted") {
      console.log("DISPATCH MODE:", { rideId, mode: "offer-only", assigned: false, requestedDriverId: driverId });
      console.error(`[BLOCKED] dispatcher tried to directly assign driver ${driverId} to ride ${rideId} — use offer flow instead`);
    }

    if (status === "accepted" && !existing.driverId) {
      res.status(400).json({ error: "no_driver", message: "Нельзя принять рейс без назначения водителя. Используйте кнопку 'Отправить заказ'" });
      return;
    }

    if (status === "in_progress" && existing.driverId) {
      await db.update(usersTable).set({ status: "busy" }).where(eq(usersTable.id, existing.driverId));
    }

    if (status === "completed") {
      const result = await completeRide(rideId);
      if (!result.success) {
        const statusCode = result.error === "no_driver" || result.error === "no_price" ? 409 : 400;
        res.status(statusCode).json({ error: result.error || "completion_error", message: result.message || result.error || "Ошибка завершения" });
        return;
      }
      const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
      const seatPassengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, rideId));
      broadcastToAll({ type: "ride_updated", ride: { ...ride, seatPassengers: enrichPassengersWithRouteInfo(seatPassengers, ride) } });
      notifyRideStatusChange(rideId, "completed").catch(() => {});
      res.json({ ...ride, seatPassengers: enrichPassengersWithRouteInfo(seatPassengers, ride) });
      return;
    }

    const [ride] = await db.update(ridesTable).set(updateData).where(eq(ridesTable.id, rideId)).returning();
    const seatPassengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, rideId));
    broadcastToAll({ type: "ride_updated", ride: { ...ride, seatPassengers: enrichPassengersWithRouteInfo(seatPassengers, ride) } });
    if (status && ["accepted", "in_progress", "cancelled"].includes(status)) {
      notifyRideStatusChange(rideId, status).catch(() => {});
    }
    res.json({ ...ride, seatPassengers: enrichPassengersWithRouteInfo(seatPassengers, ride) });
  } catch (err) {
    req.log.error({ err }, "Update ride error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.get("/:id/passengers", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.params.id);
    const [ride] = await db.select({ driverId: ridesTable.driverId, branchId: ridesTable.branchId })
      .from(ridesTable).where(eq(ridesTable.id, rideId));
    if (!ride) { res.status(404).json({ error: "not_found", message: "Заказ не найден" }); return; }

    const isStaff = req.userRole === "dispatcher" || req.userRole === "admin";
    const isAssignedDriver = req.userRole === "driver" && ride.driverId === req.userId;
    if (!isStaff && !isAssignedDriver) {
      res.status(403).json({ error: "forbidden", message: "Нет доступа к пассажирам этого заказа" });
      return;
    }

    const passengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, rideId));
    res.json({ passengers });
  } catch (err) {
    req.log.error({ err }, "Get ride passengers error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/:id/passengers", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.params.id);
    const { name, phone, pickupAddress, dropoffAddress, pickupLat, pickupLng, seatNumber, price, baggageType, source } = req.body;

    if (!name) {
      res.status(400).json({ error: "validation_error", message: "Имя пассажира обязательно" });
      return;
    }

    const seat = Number(seatNumber) || 1;
    if (seat < 1 || seat > 4) {
      res.status(400).json({ error: "validation_error", message: "Номер места: от 1 до 4" });
      return;
    }

    const existing = await db.select().from(ridePassengersTable)
      .where(and(eq(ridePassengersTable.rideId, rideId), eq(ridePassengersTable.seatNumber, seat)));
    if (existing.length > 0) {
      res.status(409).json({ error: "seat_taken", message: `Место ${seat} уже занято` });
      return;
    }

    const passengerSource = source === "manual" ? "manual" : "system";
    const [passenger] = await db.insert(ridePassengersTable).values({
      rideId,
      name,
      phone: phone || null,
      pickupAddress: pickupAddress || null,
      dropoffAddress: dropoffAddress || null,
      pickupLat: pickupLat != null ? Number(pickupLat) : null,
      pickupLng: pickupLng != null ? Number(pickupLng) : null,
      seatNumber: seat,
      price: Number(price) || 0,
      baggageType: baggageType || "none",
      source: passengerSource,
    }).returning();

    const allPassengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, rideId));
    await db.update(ridesTable).set({
      passengers: allPassengers.length,
      price: allPassengers.reduce((s, p) => s + (p.price || 0), 0),
      updatedAt: new Date(),
    }).where(eq(ridesTable.id, rideId));

    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
    if (ride) {
      broadcastToAll({ type: "queue_update", fromCity: ride.fromCity, toCity: ride.toCity, reason: "passenger_added" });
      broadcastToAll({ type: "ride_updated", ride: { ...ride, seatPassengers: enrichPassengersWithRouteInfo(allPassengers, ride) } });
    }

    res.status(201).json(passenger);
  } catch (err) {
    req.log.error({ err }, "Add passenger error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.patch("/:id/passengers/:passengerId", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const passengerId = parseInt(req.params.passengerId);
    const { name, phone, pickupAddress, dropoffAddress, pickupLat, pickupLng, seatNumber, price, baggageType } = req.body;

    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (pickupAddress !== undefined) updateData.pickupAddress = pickupAddress;
    if (dropoffAddress !== undefined) updateData.dropoffAddress = dropoffAddress;
    if (pickupLat !== undefined) updateData.pickupLat = pickupLat != null ? Number(pickupLat) : null;
    if (pickupLng !== undefined) updateData.pickupLng = pickupLng != null ? Number(pickupLng) : null;
    if (seatNumber !== undefined) updateData.seatNumber = Number(seatNumber);
    if (price !== undefined) updateData.price = Number(price);
    if (baggageType !== undefined) updateData.baggageType = baggageType;

    // Seat-change validation: check duplicate in same ride and in driver's other accepted rides
    if (seatNumber !== undefined) {
      const newSeat = Number(seatNumber);
      if (newSeat < 1 || newSeat > 4) {
        res.status(400).json({ error: "validation_error", message: "Номер места: от 1 до 4" });
        return;
      }
      const [current] = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.id, passengerId));
      if (!current) {
        res.status(404).json({ error: "not_found", message: "Пассажир не найден" });
        return;
      }
      if (current.seatNumber !== newSeat) {
        const sameRideConflict = await db.select().from(ridePassengersTable)
          .where(and(eq(ridePassengersTable.rideId, current.rideId), eq(ridePassengersTable.seatNumber, newSeat)));
        if (sameRideConflict.some(r => r.id !== passengerId)) {
          res.status(409).json({ error: "seat_taken", message: `Место ${newSeat} в этом заказе уже занято` });
          return;
        }
        const [thisRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, current.rideId));
        // If this is a child of a merged trip, also check seat conflicts on the parent trip
        if (thisRide?.tripId) {
          const mirrorKey = `merged-ride-${thisRide.id}`;
          const parentSeats = await db.select().from(ridePassengersTable)
            .where(and(eq(ridePassengersTable.rideId, thisRide.tripId), eq(ridePassengersTable.seatNumber, newSeat)));
          if (parentSeats.some(r => r.externalKey !== mirrorKey)) {
            res.status(409).json({ error: "seat_taken_trip", message: `Место ${newSeat} занято пассажиром этого рейса` });
            return;
          }
        }
        if (thisRide?.driverId) {
          const otherRides = await db.select().from(ridesTable)
            .where(and(eq(ridesTable.driverId, thisRide.driverId), eq(ridesTable.status, "accepted")));
          const otherRideIds = otherRides.map(r => r.id).filter(id => id !== current.rideId);
          if (otherRideIds.length > 0) {
            const otherSeats = await db.select().from(ridePassengersTable)
              .where(and(inArray(ridePassengersTable.rideId, otherRideIds), eq(ridePassengersTable.seatNumber, newSeat)));
            if (otherSeats.length > 0) {
              res.status(409).json({ error: "seat_taken_driver", message: `Место ${newSeat} занято пассажиром другого заказа этого водителя` });
              return;
            }
          }
        }
      }
    }

    const [passenger] = await db.update(ridePassengersTable)
      .set(updateData)
      .where(eq(ridePassengersTable.id, passengerId))
      .returning();

    if (!passenger) {
      res.status(404).json({ error: "not_found", message: "Пассажир не найден" });
      return;
    }

    // Mirror the change onto the parent trip's merged passenger row (if this ride is a child of a merged trip)
    try {
      const [childRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, passenger.rideId));
      if (childRide?.tripId) {
        const mirrorKey = `merged-ride-${childRide.id}`;
        const mirrorUpdate: Record<string, any> = {};
        if (updateData.seatNumber !== undefined) mirrorUpdate.seatNumber = updateData.seatNumber;
        if (updateData.name !== undefined) mirrorUpdate.name = updateData.name;
        if (updateData.phone !== undefined) mirrorUpdate.phone = updateData.phone;
        if (updateData.pickupAddress !== undefined) mirrorUpdate.pickupAddress = updateData.pickupAddress;
        if (updateData.dropoffAddress !== undefined) mirrorUpdate.dropoffAddress = updateData.dropoffAddress;
        if (updateData.pickupLat !== undefined) mirrorUpdate.pickupLat = updateData.pickupLat;
        if (updateData.pickupLng !== undefined) mirrorUpdate.pickupLng = updateData.pickupLng;
        if (updateData.price !== undefined) mirrorUpdate.price = updateData.price;
        if (updateData.baggageType !== undefined) mirrorUpdate.baggageType = updateData.baggageType;
        if (Object.keys(mirrorUpdate).length > 0) {
          await db.update(ridePassengersTable)
            .set(mirrorUpdate)
            .where(and(eq(ridePassengersTable.rideId, childRide.tripId), eq(ridePassengersTable.externalKey, mirrorKey)));
        }
      }
    } catch (e) { req.log?.warn?.({ e }, "mirror passenger to parent trip failed"); }

    // Recompute total ride price based on new seat distribution (front seat costs more)
    try {
      if (updateData.seatNumber !== undefined) {
        const [thisRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, passenger.rideId));
        if (thisRide && !thisRide.isMail) {
          const [route] = await db.select().from(routesTable)
            .where(and(eq(routesTable.fromCity, thisRide.fromCity), eq(routesTable.toCity, thisRide.toCity)));
          if (route) {
            const cls = (thisRide.carClass || "economy") as "economy" | "comfort" | "business";
            const priceBack: number = (route as any)[`price${cls.charAt(0).toUpperCase()+cls.slice(1)}`] || 0;
            const priceFront: number = (route as any)[`priceFront${cls.charAt(0).toUpperCase()+cls.slice(1)}`] || priceBack;
            const allP = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, thisRide.id));
            const frontCount = allP.filter(p => p.seatNumber === 1).length;
            const backCount = allP.filter(p => p.seatNumber !== 1).length;
            let basePrice = frontCount * priceFront + backCount * priceBack;
            const optionsTotal = (thisRide as any).optionsTotal || 0;
            const fromCharge = (thisRide as any).fromDistrictCharge || 0;
            const toCharge = (thisRide as any).toDistrictCharge || 0;
            let finalPrice = basePrice + fromCharge + toCharge + optionsTotal;
            if (thisRide.roundTrip) {
              const [est] = await db.select().from(routesTable)
                .where(and(eq(routesTable.fromCity, thisRide.fromCity), eq(routesTable.toCity, thisRide.toCity)));
              let dp = (est as any)?.roundTripDiscountPercent ?? 0;
              if (dp < 0) dp = 0; if (dp > 100) dp = 100;
              const total = finalPrice * 2;
              finalPrice = total - Math.round(total * (dp/100));
              if (finalPrice <= 0) finalPrice = total;
            }
            if (Number.isFinite(finalPrice) && finalPrice > 0) {
              await db.update(ridesTable)
                .set({ basePrice, price: finalPrice, updatedAt: new Date() })
                .where(eq(ridesTable.id, thisRide.id));
              // Update each passenger's individual price based on their (possibly new) seat
              const tripMul = thisRide.roundTrip ? 2 : 1;
              for (const pp of allP) {
                const newPrice = (pp.seatNumber === 1 ? priceFront : priceBack) * tripMul;
                if (Number.isFinite(newPrice) && newPrice > 0 && newPrice !== pp.price) {
                  await db.update(ridePassengersTable)
                    .set({ price: newPrice })
                    .where(eq(ridePassengersTable.id, pp.id));
                }
              }
              console.log(`[SEAT-CHANGE] ride ${thisRide.id} price recomputed: front=${frontCount} back=${backCount} basePrice=${basePrice} final=${finalPrice} tripMul=${tripMul}`);
            }
          }
        }
      }
    } catch (e) { req.log?.warn?.({ e }, "price recompute after seat change failed"); }

    // Bump ride version so driver app does NOT discard refresh as "stale", then broadcast for child + parent trip
    try {
      const ridesToNotify: number[] = [passenger.rideId];
      const [childRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, passenger.rideId));
      if (childRide?.tripId) ridesToNotify.push(childRide.tripId);
      for (const rid of ridesToNotify) {
        const [bumped] = await db.update(ridesTable)
          .set({ version: sql`COALESCE(${ridesTable.version}, 0) + 1`, updatedAt: new Date() })
          .where(eq(ridesTable.id, rid))
          .returning();
        const ride = bumped;
        if (!ride) continue;
        if (ride.id === passenger.rideId) (req as any).finalRideForResponse = ride;
        const allPassengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, ride.id));
        const enriched = enrichPassengersWithRouteInfo(allPassengers, ride);
        const payload = { type: "ride_updated", rideId: ride.id, version: ride.version, ride: { ...ride, seatPassengers: enriched } };
        broadcastToAll(payload);
        if (ride.driverId) {
          broadcastToUser(ride.driverId, payload);
          broadcastToUser(ride.driverId, { type: "passenger_seat_changed", rideId: ride.id, passengerId: passenger.id, seatNumber: passenger.seatNumber, version: ride.version });
        }
      }
    } catch (e) { req.log?.warn?.({ e }, "broadcast after seat change failed"); }

    res.json({ ...passenger, ride: (req as any).finalRideForResponse || null });
  } catch (err) {
    req.log.error({ err }, "Update passenger error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.delete("/:id/passengers/:passengerId", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.params.id);
    const passengerId = parseInt(req.params.passengerId);

    const [deleted] = await db.delete(ridePassengersTable)
      .where(eq(ridePassengersTable.id, passengerId))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "not_found", message: "Пассажир не найден" });
      return;
    }

    const allPassengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, rideId));
    await db.update(ridesTable).set({
      passengers: Math.max(1, allPassengers.length),
      price: allPassengers.reduce((s, p) => s + (p.price || 0), 0) || 0,
      updatedAt: new Date(),
    }).where(eq(ridesTable.id, rideId));

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete passenger error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/:id/cancel", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.params.id);
    const [existing] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));

    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Заказ не найден" });
      return;
    }

    if (["completed", "cancelled"].includes(existing.status as string)) {
      res.status(400).json({ error: "invalid_state", message: "Заказ уже завершён или отменён" });
      return;
    }

    stopDispatchLoop(rideId);

    const reasonRaw = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    const cancelReason = reasonRaw ? reasonRaw.slice(0, 500) : null;

    const [ride] = await db.update(ridesTable)
      .set({ status: "cancelled", cancelReason, updatedAt: new Date() })
      .where(eq(ridesTable.id, rideId))
      .returning();

    if (existing.tripId) {
      const externalKey = `merged-ride-${rideId}`;
      const deleted = await db.delete(ridePassengersTable)
        .where(and(eq(ridePassengersTable.rideId, existing.tripId), eq(ridePassengersTable.externalKey, externalKey)))
        .returning({ id: ridePassengersTable.id });
      const removedCount = deleted.length || (existing.passengers || 1);
      req.log.info({ tripId: existing.tripId, childRideId: rideId, removedPassengers: deleted.length }, "Removed merged passengers from parent trip on cancel");

      const remaining = await db.select({ cnt: sql<number>`count(*)` })
        .from(ridePassengersTable).where(eq(ridePassengersTable.rideId, existing.tripId));
      const remainingCount = Number(remaining[0]?.cnt || 0);

      const [parentTrip] = await db.select().from(ridesTable).where(eq(ridesTable.id, existing.tripId));
      const tripUpdateFields: Record<string, any> = {
        seatsTaken: remainingCount,
        passengers: remainingCount,
        updatedAt: new Date(),
      };

      if (parentTrip?.waypoints && Array.isArray(parentTrip.waypoints)) {
        const cleanedWps = (parentTrip.waypoints as any[]).filter(
          (wp: any) => wp.rideId !== rideId
        );

        if (parentTrip.fromLat && parentTrip.fromLng && parentTrip.toLat && parentTrip.toLng) {
          const origin = { lat: parentTrip.fromLat, lng: parentTrip.fromLng };
          const dest = { lat: parentTrip.toLat, lng: parentTrip.toLng };
          const optimized = await optimizeRouteOrder(origin, dest, cleanedWps);
          if (optimized) {
            tripUpdateFields.waypoints = optimized.optimizedWaypoints;
            tripUpdateFields.routePolyline = optimized.route.geometry;
            tripUpdateFields.routeDuration = optimized.route.duration;
            tripUpdateFields.routeDistance = optimized.route.distance;
          } else {
            tripUpdateFields.waypoints = cleanedWps;
          }
        } else {
          tripUpdateFields.waypoints = cleanedWps;
        }
      }

      await db.update(ridesTable).set(tripUpdateFields).where(eq(ridesTable.id, existing.tripId));
      req.log.info({ tripId: existing.tripId, releasedSeats: removedCount }, "Released seats on trip after ride cancel");

      const [updatedTrip] = await db.select().from(ridesTable).where(eq(ridesTable.id, existing.tripId));
      if (updatedTrip) broadcastToAll({ type: "trip_updated", trip: updatedTrip });
    }

    if (existing.driverId && !existing.tripId) {
      await db.update(usersTable)
        .set({ status: "online", cancelledOrders: sql`cancelled_orders + 1`, updatedAt: new Date() })
        .where(eq(usersTable.id, existing.driverId));
    }

    await db.update(orderOffersTable)
      .set({ status: "expired", respondedAt: new Date() })
      .where(and(eq(orderOffersTable.rideId, rideId), eq(orderOffersTable.status, "pending")));

    broadcastToAll({ type: "ride_updated", ride });
    notifyRideStatusChange(rideId, "cancelled").catch(() => {});
    res.json(ride);
  } catch (err) {
    req.log.error({ err }, "Cancel ride error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/:id/unassign-driver", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.params.id);
    const [existing] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));

    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Заказ не найден" });
      return;
    }

    if (!existing.driverId) {
      res.status(400).json({ error: "no_driver", message: "На заказе нет водителя" });
      return;
    }

    if (!["offered", "accepted", "merged"].includes(existing.status as string)) {
      res.status(400).json({
        error: "invalid_state",
        message: "Снять водителя можно только пока он не начал поездку. Используйте полную отмену.",
      });
      return;
    }

    const previousDriverId = existing.driverId;

    // 1. остановим текущий dispatch loop (если ещё крутится)
    stopDispatchLoop(rideId);

    // 2. expire все pending offers по этому заказу
    await db.update(orderOffersTable)
      .set({ status: "expired", respondedAt: new Date() })
      .where(and(eq(orderOffersTable.rideId, rideId), eq(orderOffersTable.status, "pending")));

    // 3. освободим водителя (status=online), счётчик отказов НЕ инкрементируем (это диспетчер снял)
    await db.update(usersTable)
      .set({ status: "online", updatedAt: new Date() })
      .where(eq(usersTable.id, previousDriverId));

    // 4. сбросим заказ в pending без водителя
    const [ride] = await db.update(ridesTable)
      .set({ driverId: null, status: "pending", updatedAt: new Date() })
      .where(eq(ridesTable.id, rideId))
      .returning();

    // 5. точечно уведомим бывшего водителя (у него заказ должен исчезнуть с подсказкой)
    broadcastToUser(previousDriverId, {
      type: "ride_unassigned_by_dispatcher",
      rideId,
      message: "Диспетчер снял с вас этот заказ",
    });

    // 6. broadcast обновления заказа всем (диспетчерам)
    broadcastToAll({ type: "ride_updated", ride });

    // 7. перезапустим автодиспетчинг — заказ снова уйдёт другим водителям
    if (ride.fromCity) {
      startAutoDispatch(rideId, ride.fromCity).catch(err =>
        req.log.error({ err, rideId }, "Failed to restart auto-dispatch after unassign")
      );
    }

    req.log.info({ rideId, previousDriverId }, "Driver unassigned by dispatcher, ride re-queued");
    res.json(ride);
  } catch (err) {
    req.log.error({ err }, "Unassign driver error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/:id/optimize-route", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const tripId = parseInt(req.params.id);
    const [trip] = await db.select().from(ridesTable).where(eq(ridesTable.id, tripId));

    if (!trip) {
      res.status(404).json({ error: "not_found", message: "Рейс не найден" });
      return;
    }

    if (!trip.fromLat || !trip.fromLng || !trip.toLat || !trip.toLng) {
      res.status(400).json({ error: "missing_coords", message: "У рейса нет координат" });
      return;
    }

    const waypoints = (Array.isArray(trip.waypoints) ? trip.waypoints : []) as Waypoint[];
    const origin = { lat: trip.fromLat, lng: trip.fromLng };
    const dest = { lat: trip.toLat, lng: trip.toLng };

    const optimized = await optimizeRouteOrder(origin, dest, waypoints);
    if (!optimized) {
      res.status(500).json({ error: "optimization_failed", message: "Не удалось оптимизировать маршрут" });
      return;
    }

    const [updated] = await db.update(ridesTable)
      .set({
        waypoints: optimized.optimizedWaypoints,
        routePolyline: optimized.route.geometry,
        routeDuration: optimized.route.duration,
        routeDistance: optimized.route.distance,
        updatedAt: new Date(),
      })
      .where(eq(ridesTable.id, tripId))
      .returning();

    broadcastToAll({ type: "trip_updated", trip: updated });
    req.log.info({ tripId, duration: optimized.route.duration, stops: optimized.optimizedWaypoints.length }, "Route optimized");

    res.json({
      trip: updated,
      optimization: {
        duration: optimized.route.duration,
        distance: optimized.route.distance,
        waypointCount: optimized.optimizedWaypoints.length,
        previousDuration: trip.routeDuration,
        savedMinutes: (trip.routeDuration ?? 0) - optimized.route.duration,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Optimize route error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.get("/:id/offers", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const rideId = Number(req.params.id);
    if (!rideId) {
      res.status(400).json({ error: "validation_error", message: "Invalid ride ID" });
      return;
    }
    const offers = await getOfferStatus(rideId);
    res.json({ offers });
  } catch (err) {
    req.log.error({ err }, "Get offer status error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
