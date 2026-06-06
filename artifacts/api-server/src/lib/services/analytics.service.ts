/**
 * Analytics service — encapsulates analytics data-access so route handlers don't
 * issue raw DB calls directly. Date-range computation and response shaping stay
 * in the routes; this is the data-access seam for aggregated stats.
 */
import { db, ridesTable, usersTable, transactionsTable, clientsTable, analyticsDailyTable } from "@workspace/db";
import { eq, gte, lte, and, desc, sql } from "drizzle-orm";

/** All rides, projecting only status + price. */
export async function getAllRidesStatusPrice() {
  return db.select({ status: ridesTable.status, price: ridesTable.price }).from(ridesTable);
}

/** Rides created within [start, end], projecting status + price. */
export async function getRidesStatusPriceBetween(start: Date, end: Date) {
  return db
    .select({ status: ridesTable.status, price: ridesTable.price })
    .from(ridesTable)
    .where(and(gte(ridesTable.createdAt, start), lte(ridesTable.createdAt, end)));
}

/** Status of all drivers. */
export async function getDriverStatuses() {
  return db.select({ status: usersTable.status }).from(usersTable).where(eq(usersTable.role, "driver"));
}

/** Sum of commission transactions since `start`. Returns rows shaped `{ amount }`. */
export async function getCommissionSumSince(start: Date) {
  return db
    .select({ amount: sql<string>`sum(amount)` })
    .from(transactionsTable)
    .where(and(eq(transactionsTable.type, "commission"), gte(transactionsTable.createdAt, start)));
}

/** Commission total since `start`, coalesced to 0. Returns rows shaped `{ total }`. */
export async function getCommissionTotalSince(start: Date) {
  return db
    .select({ total: sql<string>`coalesce(sum(amount),0)` })
    .from(transactionsTable)
    .where(and(eq(transactionsTable.type, "commission"), gte(transactionsTable.createdAt, start)));
}

/**
 * Sums all transaction amounts for a given type, coalescing to 0.
 * @param type transaction type label (e.g. "commission", "income")
 * @returns the single aggregate row shaped `{ total }`
 */
export async function getTransactionTotalByType(type: string) {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(amount), 0)` })
    .from(transactionsTable)
    // Narrow the wider `string` param to the enum-typed column eq() expects.
    .where(eq(transactionsTable.type, type as typeof transactionsTable.$inferSelect["type"]));
  return row;
}

/** Pre-aggregated daily rows since `sinceDate` (YYYY-MM-DD), newest first. */
export async function getDailySince(sinceDate: string) {
  return db
    .select()
    .from(analyticsDailyTable)
    .where(gte(analyticsDailyTable.date, sinceDate))
    .orderBy(desc(analyticsDailyTable.date));
}

/** Full ride rows created within [start, end]. */
export async function getRidesBetween(start: Date, end: Date) {
  return db
    .select()
    .from(ridesTable)
    .where(and(gte(ridesTable.createdAt, start), lte(ridesTable.createdAt, end)));
}

/** Count of clients created within [start, end]. Returns the raw rows. */
export async function getNewClientsCountBetween(start: Date, end: Date) {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(clientsTable)
    .where(and(gte(clientsTable.createdAt, start), lte(clientsTable.createdAt, end)));
}

/** Count of driver users. Returns the scalar count. */
export async function getActiveDriversCount() {
  return (
    await db
      .select({ count: sql<number>`count(*)` })
      .from(usersTable)
      .where(and(eq(usersTable.role, "driver")))
  )[0].count;
}

/** Upsert a single analytics_daily row keyed by date. */
export async function upsertDaily(row: typeof analyticsDailyTable.$inferInsert) {
  await db
    .insert(analyticsDailyTable)
    .values(row)
    .onConflictDoUpdate({ target: analyticsDailyTable.date, set: row });
}
