/**
 * Drivers service — data-access for driver records, kept out of route handlers.
 */
import { db, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

/** Fetch a user by id, restricted to the driver role; undefined if none. */
export async function getDriver(id: number) {
  const [driver] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, id), eq(usersTable.role, "driver")));
  return driver;
}

/** Patch a driver's fields (stamping updatedAt) and return the updated row. */
export async function updateDriver(id: number, fields: Partial<typeof usersTable.$inferInsert>) {
  const [updated] = await db
    .update(usersTable)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(usersTable.id, id), eq(usersTable.role, "driver")))
    .returning();
  return updated;
}

/** Return the driver's balance as a number (0 if unset/missing). */
export async function getDriverBalance(id: number): Promise<number> {
  const [row] = await db
    .select({ balance: usersTable.balance })
    .from(usersTable)
    .where(eq(usersTable.id, id));
  return parseFloat(row?.balance?.toString() || "0");
}
