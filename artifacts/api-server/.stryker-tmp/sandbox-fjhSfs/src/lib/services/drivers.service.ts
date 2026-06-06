/**
 * Drivers service — data-access for driver records, kept out of route handlers.
 */
// @ts-nocheck

import { db, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export async function getDriver(id: number) {
  const [driver] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, id), eq(usersTable.role, "driver")));
  return driver;
}

export async function updateDriver(id: number, fields: Partial<typeof usersTable.$inferInsert>) {
  const [updated] = await db
    .update(usersTable)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(usersTable.id, id), eq(usersTable.role, "driver")))
    .returning();
  return updated;
}

export async function getDriverBalance(id: number): Promise<number> {
  const [row] = await db
    .select({ balance: usersTable.balance })
    .from(usersTable)
    .where(eq(usersTable.id, id));
  return parseFloat(row?.balance?.toString() || "0");
}
