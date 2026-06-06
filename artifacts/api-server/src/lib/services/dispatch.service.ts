/**
 * Dispatch service — ride activity + driver assignment data-access.
 */
import { db, ridesTable } from "@workspace/db";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import type { DbTransaction } from "../ledger.js";

type RideStatus = (typeof ridesTable.$inferSelect)["status"];
const ACTIVE_STATUSES = ["pending", "offered", "accepted", "in_progress"] as unknown as RideStatus[];
const CLAIMABLE_STATUSES = ["pending", "offered"] as unknown as RideStatus[];

/** List a driver's most recent active rides (up to 20, newest first). */
export async function getActiveRides(driverId: number) {
  return db
    .select()
    .from(ridesTable)
    .where(and(eq(ridesTable.driverId, driverId), inArray(ridesTable.status, ACTIVE_STATUSES)))
    .orderBy(desc(ridesTable.createdAt))
    .limit(20);
}

export interface AssignableDriver {
  id: number;
  name: string | null;
  phone: string | null;
  carModel: string | null;
  carNumber: string | null;
  rating: string | number | null;
}

/**
 * Atomically assign a driver to a still-claimable ride (flips to accepted, bumps
 * version). Returns the updated ride, or null if it was already taken.
 */
export async function assignDriver(tx: DbTransaction, rideId: number, driver: AssignableDriver) {
  const [ride] = await tx
    .update(ridesTable)
    .set({
      driverId: driver.id,
      driverName: driver.name,
      driverPhone: driver.phone,
      driverCar: driver.carModel,
      driverCarNumber: driver.carNumber,
      driverRating: driver.rating ? parseFloat(String(driver.rating)) : null,
      status: "accepted",
      version: sql`COALESCE(${ridesTable.version}, 0) + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(ridesTable.id, rideId), inArray(ridesTable.status, CLAIMABLE_STATUSES)))
    .returning();
  return ride ?? null;
}
