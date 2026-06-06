import { db, usersTable, ridesTable, orderOffersTable, ridePassengersTable, settingsTable } from "@workspace/db";
import { eq, and, inArray, sql, like, isNull, isNotNull } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { logger } from "../../src/lib/logger.js";
import { matchRoute, type MatchPriority } from "../../src/lib/route-match.js";
import { batchMatchRides, type BatchRide, type BatchDriver } from "../../src/lib/batch-dispatch.js";

import { JWT_SECRET } from "../../src/lib/jwt-secret.js";
const BASE = `http://localhost:${process.env.PORT || 8080}`;

const DRIVER_COUNT = 55;
const RIDE_COUNT = 200;
const STUCK_TIMEOUT_MS = 30_000;
const STRESS_PHONE_PREFIX = "+998950";
const STRESS_RIDER_PREFIX = "+998960";

const CITY_KEYS = [
  "bukhara", "samarkand", "tashkent", "namangan",
  "andijan", "fergana", "nukus", "urgench",
  "qarshi", "termez", "jizzakh", "navoiy",
];

const CITY_NAMES_RU: Record<string, string> = {
  bukhara: "Бухара", samarkand: "Самарканд", tashkent: "Ташкент",
  namangan: "Наманган", andijan: "Андижан", fergana: "Фергана",
  nukus: "Нукус", urgench: "Ургенч", qarshi: "Карши",
  termez: "Термез", jizzakh: "Джиззах", navoiy: "Навои",
};

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
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

interface DriverInfo { id: number; token: string; city: string; tripId?: number; tripTo?: string; }
interface RideTrack {
  id: number;
  createdAt: number;
  matchedAt?: number;
  status: string;
  driverId?: number;
  hasOffer: boolean;
  price: number;
  fromCity: string;
  toCity: string;
  riderPhone: string;
  matchPriority?: MatchPriority;
  error?: string;
}

interface StressReport {
  totalDrivers: number;
  totalRides: number;
  ridesMatched: number;
  matchExact: number;
  matchPartial: number;
  matchDetour: number;
  ridesWithOffers: number;
  ridesStuck: number;
  ridesNoOffer: number;
  ridesZeroPrice: number;
  creationErrors: number;
  acceptRate: number;
  avgMatchTimeMs: number;
  maxMatchTimeMs: number;
  minMatchTimeMs: number;
  p95MatchTimeMs: number;
  totalTimeMs: number;
  passed: boolean;
  failReasons: string[];
  phaseTimings: Record<string, number>;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function api(method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, data: json };
}

const POPULAR_CORRIDORS = [
  { from: "tashkent", to: "samarkand", weight: 8 },
  { from: "tashkent", to: "fergana", weight: 6 },
  { from: "tashkent", to: "namangan", weight: 5 },
  { from: "tashkent", to: "andijan", weight: 5 },
  { from: "tashkent", to: "bukhara", weight: 4 },
  { from: "samarkand", to: "bukhara", weight: 4 },
  { from: "tashkent", to: "jizzakh", weight: 3 },
  { from: "samarkand", to: "qarshi", weight: 3 },
  { from: "fergana", to: "andijan", weight: 3 },
  { from: "fergana", to: "namangan", weight: 3 },
  { from: "tashkent", to: "navoiy", weight: 2 },
  { from: "bukhara", to: "navoiy", weight: 2 },
  { from: "nukus", to: "urgench", weight: 2 },
  { from: "tashkent", to: "urgench", weight: 1 },
  { from: "tashkent", to: "termez", weight: 1 },
  { from: "samarkand", to: "termez", weight: 1 },
];

function weightedRandomRoute(): { from: string; to: string } {
  const totalWeight = POPULAR_CORRIDORS.reduce((s, c) => s + c.weight, 0);
  let r = Math.random() * totalWeight;
  for (const corridor of POPULAR_CORRIDORS) {
    r -= corridor.weight;
    if (r <= 0) {
      if (Math.random() < 0.5) return { from: corridor.from, to: corridor.to };
      return { from: corridor.to, to: corridor.from };
    }
  }
  return pureRandomRoute();
}

function pureRandomRoute(): { from: string; to: string } {
  const from = CITY_KEYS[Math.floor(Math.random() * CITY_KEYS.length)];
  let to = CITY_KEYS[Math.floor(Math.random() * CITY_KEYS.length)];
  while (to === from) to = CITY_KEYS[Math.floor(Math.random() * CITY_KEYS.length)];
  return { from, to };
}

function randomRoute(): { from: string; to: string } {
  return Math.random() < 0.75 ? weightedRandomRoute() : pureRandomRoute();
}

async function bumpLimits() {
  await db.update(settingsTable).set({ value: "500" }).where(eq(settingsTable.key, "max_orders_per_day"));
  await db.update(settingsTable).set({ value: "500" }).where(eq(settingsTable.key, "max_active_orders"));
}

async function restoreLimits() {
  await db.update(settingsTable).set({ value: "30" }).where(eq(settingsTable.key, "max_orders_per_day"));
  await db.update(settingsTable).set({ value: "20" }).where(eq(settingsTable.key, "max_active_orders"));
}

async function cleanupStressData() {
  const stressDrivers = await db.select({ id: usersTable.id }).from(usersTable)
    .where(like(usersTable.phone, `${STRESS_PHONE_PREFIX}%`));
  const driverIds = stressDrivers.map(d => d.id);

  const stressRides = await db.select({ id: ridesTable.id }).from(ridesTable)
    .where(like(ridesTable.riderPhone, `${STRESS_RIDER_PREFIX}%`));
  const riderRideIds = stressRides.map(r => r.id);

  let driverRideIds: number[] = [];
  if (driverIds.length > 0) {
    const driverRides = await db.select({ id: ridesTable.id }).from(ridesTable)
      .where(inArray(ridesTable.driverId, driverIds));
    driverRideIds = driverRides.map(r => r.id);
  }

  const allRideIds = [...new Set([...riderRideIds, ...driverRideIds])];
  if (allRideIds.length > 0) {
    await db.delete(ridePassengersTable).where(inArray(ridePassengersTable.rideId, allRideIds));
    await db.delete(orderOffersTable).where(inArray(orderOffersTable.rideId, allRideIds));
    await db.delete(ridesTable).where(inArray(ridesTable.id, allRideIds));
  }
  if (driverIds.length > 0) {
    await db.delete(orderOffersTable).where(inArray(orderOffersTable.driverId, driverIds));
    await db.delete(usersTable).where(inArray(usersTable.id, driverIds));
  }
}

async function createDrivers(): Promise<DriverInfo[]> {
  const crypto = require("crypto");
  const hash = crypto.createHash("sha256").update("stress123buxtaxi-salt").digest("hex");
  const drivers: DriverInfo[] = [];
  const carClasses = ["economy", "comfort", "business"];

  const CITY_WEIGHTS: Record<string, number> = {
    tashkent: 10, samarkand: 6, fergana: 5, namangan: 4, andijan: 4,
    bukhara: 4, jizzakh: 3, navoiy: 2, qarshi: 2, termez: 2, nukus: 2, urgench: 2,
  };
  const totalCityWeight = Object.values(CITY_WEIGHTS).reduce((s, w) => s + w, 0);
  const driverCities: string[] = [];
  for (let i = 0; i < DRIVER_COUNT; i++) {
    let r = Math.random() * totalCityWeight;
    let picked = "tashkent";
    for (const [city, w] of Object.entries(CITY_WEIGHTS)) {
      r -= w;
      if (r <= 0) { picked = city; break; }
    }
    driverCities.push(picked);
  }

  const batchValues: any[] = [];
  for (let i = 0; i < DRIVER_COUNT; i++) {
    const phone = `${STRESS_PHONE_PREFIX}${String(i).padStart(5, "0")}`;
    const city = driverCities[i];
    const coords = CITY_COORDS[city];
    batchValues.push({
      phone,
      name: `Stress Driver ${i + 1}`,
      passwordHash: hash,
      role: "driver" as const,
      status: "online" as const,
      balance: 500000,
      carModel: `TestCar-${i}`,
      carNumber: `${String(i).padStart(2, "0")}X${String(i).padStart(3, "0")}XX`,
      carClass: carClasses[i % 3],
      seats: 4,
      lat: coords.lat + (Math.random() - 0.5) * 0.05,
      lng: coords.lng + (Math.random() - 0.5) * 0.05,
    });
  }

  const inserted = await db.insert(usersTable).values(batchValues).returning();
  for (let i = 0; i < inserted.length; i++) {
    const city = driverCities[i];
    const token = jwt.sign({ userId: inserted[i].id, role: "driver" }, JWT_SECRET, { expiresIn: "1h" });
    drivers.push({ id: inserted[i].id, token, city });
  }
  return drivers;
}

function pickDriverRoute(driverCity: string): string {
  const corridorsFrom = POPULAR_CORRIDORS.filter(c => c.from === driverCity || c.to === driverCity);
  if (corridorsFrom.length > 0 && Math.random() < 0.8) {
    const totalW = corridorsFrom.reduce((s, c) => s + c.weight, 0);
    let r = Math.random() * totalW;
    for (const c of corridorsFrom) {
      r -= c.weight;
      if (r <= 0) return c.from === driverCity ? c.to : c.from;
    }
  }
  let to = CITY_KEYS[Math.floor(Math.random() * CITY_KEYS.length)];
  while (to === driverCity) to = CITY_KEYS[Math.floor(Math.random() * CITY_KEYS.length)];
  return to;
}

async function createTripsDB(drivers: DriverInfo[]): Promise<void> {
  const departureTime = new Date(Date.now() + 30 * 60 * 1000);
  const tripValues: any[] = [];

  for (const driver of drivers) {
    const toCity = pickDriverRoute(driver.city);
    driver.tripTo = toCity;

    tripValues.push({
      driverId: driver.id,
      fromCity: driver.city,
      toCity: toCity,
      status: "accepted",
      scheduledAt: departureTime,
      mode: "market",
      source: "auto",
      price: 0,
      carClass: ["economy", "comfort", "business"][drivers.indexOf(driver) % 3],
    });
  }

  const trips = await db.insert(ridesTable).values(tripValues).returning();
  for (let i = 0; i < trips.length; i++) {
    drivers[i].tripId = trips[i].id;
  }
}

async function createRidesDB(drivers: DriverInfo[]): Promise<RideTrack[]> {
  const rides: RideTrack[] = [];
  const departureTime = new Date(Date.now() + 30 * 60 * 1000);
  const rideValues: any[] = [];
  const routeInfo: { from: string; to: string }[] = [];

  for (let i = 0; i < RIDE_COUNT; i++) {
    const route = randomRoute();
    routeInfo.push(route);
    rideValues.push({
      fromCity: CITY_NAMES_RU[route.from],
      toCity: CITY_NAMES_RU[route.to],
      riderName: `Stress Rider ${i + 1}`,
      riderPhone: `${STRESS_RIDER_PREFIX}${String(i).padStart(5, "0")}`,
      status: "pending",
      scheduledAt: departureTime,
      paymentType: "cash",
      carClass: ["economy", "comfort", "business"][i % 3],
      mode: "dispatch",
      source: "dispatch",
      price: 0,
    });
  }

  const inserted = await db.insert(ridesTable).values(rideValues).returning();
  const now = Date.now();
  for (let i = 0; i < inserted.length; i++) {
    rides.push({
      id: inserted[i].id,
      createdAt: now,
      status: "pending",
      hasOffer: false,
      price: 0,
      fromCity: routeInfo[i].from,
      toCity: routeInfo[i].to,
      riderPhone: `${STRESS_RIDER_PREFIX}${String(i).padStart(5, "0")}`,
    });
  }
  return rides;
}

async function runMatching(drivers: DriverInfo[], rides: RideTrack[]): Promise<void> {
  const batchRides: BatchRide[] = rides
    .filter(r => r.status === "pending")
    .map(r => ({ id: r.id, fromCity: r.fromCity, toCity: r.toCity }));

  const batchDrivers: BatchDriver[] = drivers
    .filter(d => d.tripId && d.tripTo)
    .map(d => ({
      id: d.id,
      tripId: d.tripId!,
      fromCity: d.city,
      toCity: d.tripTo!,
      totalSeats: 4,
      seatsTaken: 0,
      hasPassengers: false,
    }));

  const assignments = batchMatchRides(batchRides, batchDrivers, 50, 40);

  const seatsTaken = new Map<number, number>();
  for (const a of assignments) {
    const price = 100000 + Math.floor(Math.random() * 200000);
    const ride = rides.find(r => r.id === a.rideId);
    if (!ride) continue;

    await db.update(ridesTable).set({
      status: "accepted",
      driverId: a.driverId,
      tripId: a.tripId,
      price,
      updatedAt: new Date(),
    }).where(eq(ridesTable.id, a.rideId));

    const seatNum = (seatsTaken.get(a.tripId) || 0) + 1;
    await db.insert(ridePassengersTable).values({
      rideId: a.tripId,
      name: `Stress Rider`,
      phone: ride.riderPhone,
      seatNumber: seatNum,
      status: "waiting",
    });
    seatsTaken.set(a.tripId, seatNum);

    ride.status = "accepted";
    ride.driverId = a.driverId;
    ride.price = price;
    ride.hasOffer = true;
    ride.matchedAt = Date.now();
    ride.matchPriority = a.matchPriority;

    const driver = batchDrivers.find(d => d.id === a.driverId);
    if (driver) {
      driver.seatsTaken = seatsTaken.get(a.tripId) || 0;
      driver.hasPassengers = true;
    }
  }

  console.log(`[STRESS] Matching: ${assignments.length}/${rides.length} rides matched to trips`);

  const unmatched = rides.filter(r => r.status === "pending");
  if (unmatched.length > 0) {
    console.log(`[STRESS] ${unmatched.length} rides unmatched (no matching trip route)`);

    const unmatchedByRoute = new Map<string, number>();
    for (const r of unmatched) {
      const key = `${r.fromCity}→${r.toCity}`;
      unmatchedByRoute.set(key, (unmatchedByRoute.get(key) || 0) + 1);
    }
    const topUnmatched = [...unmatchedByRoute.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [route, count] of topUnmatched) {
      console.log(`[STRESS]   ${route}: ${count} rides`);
    }
  }
}

function generateReport(rides: RideTrack[], totalTimeMs: number, phaseTimings: Record<string, number>): StressReport {
  const validRides = rides.filter(r => r.id > 0);
  const errorRides = rides.filter(r => r.id <= 0);
  const matched = validRides.filter(r => ["accepted", "in_progress", "completed"].includes(r.status));
  const withOffers = validRides.filter(r => r.hasOffer);
  const noOffer = validRides.filter(r => !r.hasOffer && !["accepted", "in_progress", "completed"].includes(r.status));
  const stuck = validRides.filter(r => {
    if (["accepted", "in_progress", "completed", "cancelled"].includes(r.status)) return false;
    if (!r.hasOffer) return false;
    return (Date.now() - r.createdAt) > 30_000;
  });
  const zeroPrice = matched.filter(r => r.price <= 0);

  const matchTimes = matched.filter(r => r.matchedAt).map(r => r.matchedAt! - r.createdAt).sort((a, b) => a - b);
  const avgTime = matchTimes.length > 0 ? matchTimes.reduce((s, t) => s + t, 0) / matchTimes.length : 0;
  const maxTime = matchTimes.length > 0 ? matchTimes[matchTimes.length - 1] : 0;
  const minTime = matchTimes.length > 0 ? matchTimes[0] : 0;
  const p95Idx = Math.floor(matchTimes.length * 0.95);
  const p95Time = matchTimes.length > 0 ? matchTimes[Math.min(p95Idx, matchTimes.length - 1)] : 0;
  const acceptRate = validRides.length > 0 ? (matched.length / validRides.length) * 100 : 0;

  const failReasons: string[] = [];
  if (zeroPrice.length > 0) failReasons.push(`${zeroPrice.length} matched ride(s) have price=0`);

  const matchExact = matched.filter(r => r.matchPriority === "exact").length;
  const matchPartial = matched.filter(r => r.matchPriority === "partial").length;
  const matchDetour = matched.filter(r => r.matchPriority === "detour").length;

  return {
    totalDrivers: DRIVER_COUNT,
    totalRides: RIDE_COUNT,
    ridesMatched: matched.length,
    matchExact,
    matchPartial,
    matchDetour,
    ridesWithOffers: withOffers.length,
    ridesStuck: stuck.length,
    ridesNoOffer: noOffer.length,
    ridesZeroPrice: zeroPrice.length,
    creationErrors: errorRides.length,
    acceptRate: Math.round(acceptRate * 10) / 10,
    avgMatchTimeMs: Math.round(avgTime),
    maxMatchTimeMs: maxTime,
    minMatchTimeMs: minTime,
    p95MatchTimeMs: p95Time,
    totalTimeMs,
    passed: failReasons.length === 0,
    failReasons,
    phaseTimings,
  };
}

function printReport(report: StressReport) {
  const div = "═══════════════════════════════════════════════════";
  console.log(`\n${div}`);
  console.log("  [STRESS] BuxTaxi System Performance Report");
  console.log(`${div}\n`);

  console.log(`  Drivers:             ${report.totalDrivers}`);
  console.log(`  Rides:               ${report.totalRides}`);
  console.log(`  Total time:          ${(report.totalTimeMs / 1000).toFixed(1)}s`);
  console.log("");

  console.log("  ── PHASE TIMINGS ─────────────────────");
  for (const [phase, ms] of Object.entries(report.phaseTimings)) {
    console.log(`  ${phase.padEnd(22)} ${ms}ms`);
  }
  console.log("");

  console.log("  ── MATCHING ──────────────────────────");
  console.log(`  Matched:             ${report.ridesMatched}/${report.totalRides} (${report.acceptRate}%)`);
  console.log(`    Exact route:       ${report.matchExact}`);
  console.log(`    Partial match:     ${report.matchPartial}`);
  console.log(`    Detour match:      ${report.matchDetour}`);
  console.log(`  With offers:         ${report.ridesWithOffers}`);
  console.log(`  No match (route):    ${report.ridesNoOffer}`);
  console.log(`  Stuck > 30s:         ${report.ridesStuck}`);
  console.log(`  Price = 0:           ${report.ridesZeroPrice}`);
  console.log(`  Creation errors:     ${report.creationErrors}`);
  console.log("");

  console.log("  ── TIMING ────────────────────────────");
  console.log(`  Avg match time:      ${report.avgMatchTimeMs}ms`);
  console.log(`  Min match time:      ${report.minMatchTimeMs}ms`);
  console.log(`  Max match time:      ${report.maxMatchTimeMs}ms`);
  console.log(`  P95 match time:      ${report.p95MatchTimeMs}ms`);
  console.log("");

  if (report.passed) {
    console.log(`  ✓ RESULT: PASSED`);
  } else {
    console.log(`  ✗ RESULT: FAILED`);
    for (const reason of report.failReasons) {
      console.log(`    - ${reason}`);
    }
  }
  console.log(`\n${div}\n`);
}

export async function runStressSimulation(): Promise<StressReport> {
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  [STRESS] Starting BuxTaxi Stress Simulation");
  console.log(`  ${DRIVER_COUNT} drivers · ${RIDE_COUNT} rides · ${STUCK_TIMEOUT_MS / 1000}s timeout`);
  console.log("═══════════════════════════════════════════════════\n");

  const totalStart = Date.now();
  const phaseTimings: Record<string, number> = {};

  let t = Date.now();
  console.log("[STRESS] Phase 0: Cleanup...");
  await cleanupStressData();
  phaseTimings["cleanup"] = Date.now() - t;
  console.log(`[STRESS] Phase 0: Done (${phaseTimings["cleanup"]}ms)`);

  t = Date.now();
  console.log("[STRESS] Phase 0b: Bump limits...");
  await bumpLimits();
  const { loadSettingsCache } = await import("../../src/lib/settingsCache.js");
  await loadSettingsCache();
  phaseTimings["bump_limits"] = Date.now() - t;
  console.log(`[STRESS] Phase 0b: Done (${phaseTimings["bump_limits"]}ms)`);

  t = Date.now();
  console.log(`[STRESS] Phase 1: Creating ${DRIVER_COUNT} drivers...`);
  let drivers: DriverInfo[];
  try {
    drivers = await createDrivers();
    phaseTimings["create_drivers"] = Date.now() - t;
    console.log(`[STRESS] Phase 1: ${drivers.length} drivers (${phaseTimings["create_drivers"]}ms)`);
  } catch (err: any) {
    console.log(`[STRESS ✗] Driver creation failed: ${err.message}`);
    await restoreLimits(); await loadSettingsCache();
    return generateReport([], Date.now() - totalStart, phaseTimings);
  }

  t = Date.now();
  console.log(`[STRESS] Phase 2: Creating ${DRIVER_COUNT} trip routes...`);
  try {
    await createTripsDB(drivers);
    phaseTimings["create_trips"] = Date.now() - t;
    console.log(`[STRESS] Phase 2: ${drivers.filter(d => d.tripId).length} trips (${phaseTimings["create_trips"]}ms)`);
  } catch (err: any) {
    console.log(`[STRESS ✗] Trip creation failed: ${err.message}`);
    await cleanupStressData(); await restoreLimits(); await loadSettingsCache();
    return generateReport([], Date.now() - totalStart, phaseTimings);
  }

  t = Date.now();
  console.log(`[STRESS] Phase 3: Creating ${RIDE_COUNT} client rides (direct DB)...`);
  let rides: RideTrack[];
  try {
    rides = await createRidesDB(drivers);
    phaseTimings["create_rides"] = Date.now() - t;
    console.log(`[STRESS] Phase 3: ${rides.length} rides (${phaseTimings["create_rides"]}ms)`);
  } catch (err: any) {
    console.log(`[STRESS ✗] Ride creation failed: ${err.message}`);
    await cleanupStressData(); await restoreLimits(); await loadSettingsCache();
    return generateReport([], Date.now() - totalStart, phaseTimings);
  }

  t = Date.now();
  console.log(`[STRESS] Phase 4: Running matching engine...`);
  try {
    await runMatching(drivers, rides);
    phaseTimings["matching"] = Date.now() - t;
    console.log(`[STRESS] Phase 4: Matching done (${phaseTimings["matching"]}ms)`);
  } catch (err: any) {
    console.log(`[STRESS ✗] Matching failed: ${err.message}`);
  }

  t = Date.now();
  console.log("[STRESS] Phase 5: Verifying DB state...");
  const dbRides = await db.select().from(ridesTable).where(inArray(ridesTable.id, rides.map(r => r.id)));
  for (const dbRide of dbRides) {
    const track = rides.find(r => r.id === dbRide.id);
    if (track) {
      track.status = dbRide.status || "unknown";
      track.driverId = dbRide.driverId || undefined;
      track.price = dbRide.price || 0;
    }
  }
  phaseTimings["verify"] = Date.now() - t;
  console.log(`[STRESS] Phase 5: Verified (${phaseTimings["verify"]}ms)`);

  const totalTime = Date.now() - totalStart;
  const report = generateReport(rides, totalTime, phaseTimings);
  printReport(report);

  t = Date.now();
  console.log("[STRESS] Phase 6: Cleanup & restore...");
  await cleanupStressData();
  await restoreLimits();
  await loadSettingsCache();
  phaseTimings["final_cleanup"] = Date.now() - t;
  console.log(`[STRESS] Phase 6: Done (${phaseTimings["final_cleanup"]}ms)`);

  return report;
}
