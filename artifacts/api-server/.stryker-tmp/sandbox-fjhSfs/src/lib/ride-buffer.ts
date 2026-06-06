// @ts-nocheck
import { db, ridesTable, usersTable, ridePassengersTable, orderOffersTable } from "@workspace/db";
import { clog } from "./logger.js";
import { eq, and, inArray, sql } from "drizzle-orm";
import { batchMatchRides, type BatchRide, type BatchDriver, type BatchAssignment } from "./batch-dispatch.js";
import { broadcastToAll, broadcastToUser } from "./websocket.js";
import { logger } from "./logger.js";
import { getSettingNum, getSettingBool } from "./settingsCache.js";
import { startAutoDispatch } from "./autodispatch.js";

interface BufferedRide {
  id: number;
  fromCity: string;
  toCity: string;
  carClass: string;
  addedAt: number;
}

const buffer: BufferedRide[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

export function addToBuffer(rideId: number, fromCity: string, toCity: string, carClass: string = "economy") {
  buffer.push({ id: rideId, fromCity, toCity, carClass, addedAt: Date.now() });

  clog.log(`[BATCH] Buffered ride ${rideId} (${fromCity}→${toCity}), buffer size: ${buffer.length}`);

  if (!batchTimer) {
    const windowSec = getSettingNum("batch_window_seconds", 90);
    clog.log(`[BATCH] Starting ${windowSec}s batch window`);
    batchTimer = setTimeout(() => {
      batchTimer = null;
      processBatch().catch(err => {
        logger.error({ err }, "[BATCH] processBatch failed");
      });
    }, windowSec * 1000);
  }
}

export function getBufferSize(): number {
  return buffer.length;
}

export function isBatchEnabled(): boolean {
  return getSettingBool("batch_dispatch_enabled", false);
}

export async function processBatch(): Promise<BatchAssignment[]> {
  if (buffer.length === 0) return [];

  const bufferedRides = buffer.splice(0);
  clog.log(`[BATCH] Processing ${bufferedRides.length} buffered rides`);

  const rideIds = bufferedRides.map(r => r.id);
  const stillPending = await db
    .select({ id: ridesTable.id, status: ridesTable.status, riderPhone: ridesTable.riderPhone, riderName: ridesTable.riderName })
    .from(ridesTable)
    .where(and(inArray(ridesTable.id, rideIds), eq(ridesTable.status, "pending")));

  const pendingIds = new Set(stillPending.map(r => r.id));
  const rideDataMap = new Map(stillPending.map(r => [r.id, r]));
  const ridesToMatch: BatchRide[] = bufferedRides
    .filter(r => pendingIds.has(r.id))
    .map(r => ({ id: r.id, fromCity: r.fromCity, toCity: r.toCity, carClass: r.carClass }));

  if (ridesToMatch.length === 0) {
    clog.log("[BATCH] No pending rides left to match");
    return [];
  }

  const activeTrips = await db
    .select()
    .from(ridesTable)
    .where(
      and(
        eq(ridesTable.status, "accepted"),
        sql`${ridesTable.driverId} IS NOT NULL`,
        sql`${ridesTable.riderPhone} IS NULL`,
      )
    );

  const driverIds = [...new Set(activeTrips.map(r => r.driverId!).filter(Boolean))];
  const driverSeats = new Map<number, number>();
  if (driverIds.length > 0) {
    const rows = await db
      .select({ id: usersTable.id, seats: usersTable.seats })
      .from(usersTable)
      .where(inArray(usersTable.id, driverIds));
    for (const d of rows) {
      driverSeats.set(d.id, d.seats || 4);
    }
  }

  const passengerCounts = new Map<number, number>();
  if (activeTrips.length > 0) {
    const tripIds = activeTrips.map(r => r.id);
    const pRows = await db
      .select({
        rideId: ridePassengersTable.rideId,
        cnt: sql<number>`count(*)::int`,
      })
      .from(ridePassengersTable)
      .where(inArray(ridePassengersTable.rideId, tripIds))
      .groupBy(ridePassengersTable.rideId);
    for (const p of pRows) {
      passengerCounts.set(p.rideId, p.cnt);
    }
  }

  const batchDrivers: BatchDriver[] = activeTrips.map(trip => ({
    id: trip.driverId!,
    tripId: trip.id,
    fromCity: trip.fromCity,
    toCity: trip.toCity,
    totalSeats: driverSeats.get(trip.driverId!) || 4,
    seatsTaken: passengerCounts.get(trip.id) || 0,
    hasPassengers: (passengerCounts.get(trip.id) || 0) > 0,
  }));

  const maxKm = getSettingNum("max_detour_km", 50);
  const maxMin = getSettingNum("max_detour_minutes", 40);
  const assignments = batchMatchRides(ridesToMatch, batchDrivers, maxKm, maxMin);

  const matchedRideIds = new Set(assignments.map(a => a.rideId));
  clog.log(`[BATCH] Matched ${assignments.length}/${ridesToMatch.length} rides`);

  for (const a of assignments) {
    const price = 100000 + Math.floor(Math.random() * 200000);

    const updateResult = await db.update(ridesTable).set({
      status: "accepted",
      driverId: a.driverId,
      tripId: a.tripId,
      price,
      updatedAt: new Date(),
    }).where(and(eq(ridesTable.id, a.rideId), eq(ridesTable.status, "pending")))
      .returning({ id: ridesTable.id });

    if (updateResult.length === 0) {
      clog.log(`[BATCH] Ride ${a.rideId} was already claimed, skipping`);
      continue;
    }

    const rideData = rideDataMap.get(a.rideId);
    const seatNum = (passengerCounts.get(a.tripId) || 0) + 1;
    await db.insert(ridePassengersTable).values({
      rideId: a.tripId,
      name: rideData?.riderName || "Passenger",
      phone: rideData?.riderPhone || `+998900000000`,
      seatNumber: seatNum,
      status: "waiting",
    });
    passengerCounts.set(a.tripId, seatNum);

    await db.update(ridesTable)
      .set({ seatsTaken: seatNum, passengers: seatNum, updatedAt: new Date() })
      .where(eq(ridesTable.id, a.tripId));

    const [updatedRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, a.rideId));
    const [tripRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, a.tripId));
    if (updatedRide) {
      broadcastToAll({ type: "ride_updated", ride: updatedRide });
      broadcastToUser(a.driverId, {
        type: "ride_matched_trip",
        rideId: a.rideId,
        tripId: a.tripId,
        matchPriority: a.matchPriority,
      });
      broadcastToUser(a.driverId, {
        type: "route_updated",
        rideId: a.tripId,
        version: tripRide?.version,
        reason: "passenger_added",
      });
    }
  }

  const unmatchedRides = ridesToMatch.filter(r => !matchedRideIds.has(r.id));
  if (unmatchedRides.length > 0) {
    clog.log(`[BATCH] Falling back to auto-dispatch for ${unmatchedRides.length} unmatched rides`);
    for (const ride of unmatchedRides) {
      const stillExists = await db.select({ id: ridesTable.id }).from(ridesTable)
        .where(and(eq(ridesTable.id, ride.id), eq(ridesTable.status, "pending")));
      if (stillExists.length > 0) {
        startAutoDispatch(ride.id, ride.fromCity);
      }
    }
  }

  return assignments;
}

export function clearBuffer() {
  buffer.length = 0;
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
}
