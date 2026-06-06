/**
 * Notifications service — encapsulates push-notification persistence so the
 * push-notifications route handlers don't issue raw DB calls directly. Push
 * DELIVERY (web-push / WebSocket / BullMQ) and HTTP concerns stay in the route
 * and lib/notifications; this is the data-access seam for the route.
 */
import { db, pushNotificationsTable, usersTable, deviceTokensTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";

export async function listPushNotifications(limit: number, offset: number) {
  return db.select()
    .from(pushNotificationsTable)
    .orderBy(desc(pushNotificationsTable.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function countPushNotifications() {
  const [countResult] = await db.select({ count: sql<number>`count(*)` })
    .from(pushNotificationsTable);
  return Number(countResult.count);
}

export async function createPushNotification(values: typeof pushNotificationsTable.$inferInsert) {
  const [created] = await db.insert(pushNotificationsTable).values(values).returning();
  return created;
}

export async function updatePushNotificationCounts(id: number, sentCount: number, deliveredCount: number) {
  await db.update(pushNotificationsTable)
    .set({ sentCount, deliveredCount })
    .where(eq(pushNotificationsTable.id, id));
}

export async function deletePushNotification(id: number) {
  const [deleted] = await db.delete(pushNotificationsTable).where(eq(pushNotificationsTable.id, id)).returning();
  return deleted;
}

/**
 * Driver audience targeting: drivers optionally narrowed by city and/or group.
 * Returns bare ids matching the route's prior `{ id }` projection.
 */
export async function getDriverAudience(cityId: number | null, driverGroupId: number | null) {
  const conditions: any[] = [eq(usersTable.role, "driver")];
  if (cityId) {
    conditions.push(sql`${usersTable.city} = ${String(cityId)}`);
  }
  if (driverGroupId) {
    conditions.push(eq(usersTable.groupId, driverGroupId));
  }
  return db.select({ id: usersTable.id }).from(usersTable).where(and(...conditions));
}

export async function getClientAudience() {
  return db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "rider"));
}

export async function getDeviceTokensForUser(userId: number) {
  return db.select().from(deviceTokensTable).where(eq(deviceTokensTable.userId, userId));
}

export async function deleteDeviceToken(id: number) {
  await db.delete(deviceTokensTable).where(eq(deviceTokensTable.id, id));
}
