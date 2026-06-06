/**
 * Rides service — encapsulates ride persistence so route handlers don't issue
 * raw DB calls directly. Business orchestration (pricing, dispatch, notifications)
 * stays in the routes for now; this is the data-access seam.
 */
// @ts-nocheck

import { db, ridesTable } from "@workspace/db";
import { eq, ne, and, sql } from "drizzle-orm";

export async function getRide(id: number) {
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, id));
  return ride;
}

export async function createRide(values: typeof ridesTable.$inferInsert) {
  const [ride] = await db.insert(ridesTable).values(values).returning();
  return ride;
}

/**
 * Optimistic status flip: bumps version and never re-touches a completed ride.
 * Returns the updated row, or undefined if it was already completed / not found.
 */
export async function updateRideStatus(id: number, status: string) {
  const [updated] = await db
    .update(ridesTable)
    .set({ status: status as any, version: sql`COALESCE(${ridesTable.version}, 0) + 1`, updatedAt: new Date() })
    .where(and(eq(ridesTable.id, id), ne(ridesTable.status, "completed")))
    .returning();
  return updated;
}
