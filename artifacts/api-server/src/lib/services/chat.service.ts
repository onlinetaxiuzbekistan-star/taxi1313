/**
 * Chat service — encapsulates chat/message persistence so route handlers and
 * websocket callbacks don't issue raw DB calls directly. HTTP/business concerns
 * (auth, broadcasts, notifications, branching) stay in the routes; this is the
 * data-access seam.
 */
import { db, messagesTable, usersTable, ridesTable, chatParticipantsTable } from "@workspace/db";
import { eq, and, or, asc, sql } from "drizzle-orm";

export async function getRideParticipantIds(rideId: number): Promise<number[]> {
  const participants = await db.select({ userId: chatParticipantsTable.userId })
    .from(chatParticipantsTable)
    .where(eq(chatParticipantsTable.rideId, rideId));
  return participants.map(p => p.userId);
}

export async function getRideParticipants(rideId: number) {
  return db.select().from(chatParticipantsTable)
    .where(eq(chatParticipantsTable.rideId, rideId));
}

export async function ensureParticipant(rideId: number, userId: number, role: string, name: string) {
  try {
    await db.insert(chatParticipantsTable).values({
      rideId, userId, role, name,
    }).onConflictDoNothing();
  } catch {}
}

export async function getUserNameInfo(userId: number) {
  const user = await db.select({ name: usersTable.name, role: usersTable.role, id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.id, userId)).limit(1);
  return user[0];
}

export async function getRideDriverId(rideId: number): Promise<number | null> {
  const ride = await db.select({ driverId: ridesTable.driverId }).from(ridesTable)
    .where(eq(ridesTable.id, rideId)).limit(1);
  return ride.length > 0 ? ride[0].driverId : null;
}

export async function getMessagesByRide(rideId: number) {
  return db.select().from(messagesTable)
    .where(eq(messagesTable.rideId, rideId))
    .orderBy(asc(messagesTable.createdAt))
    .limit(200);
}

export async function getMessagesBetween(myId: number, peerId: number) {
  return db.select().from(messagesTable)
    .where(
      or(
        and(eq(messagesTable.senderId, myId), eq(messagesTable.recipientId, peerId)),
        and(eq(messagesTable.senderId, peerId), eq(messagesTable.recipientId, myId)),
      )
    )
    .orderBy(asc(messagesTable.createdAt))
    .limit(200);
}

export async function getRideMessagesOrdered(rideId: number) {
  return db.select().from(messagesTable)
    .where(eq(messagesTable.rideId, rideId))
    .orderBy(asc(messagesTable.createdAt));
}

export async function insertMessage(values: typeof messagesTable.$inferInsert) {
  const [msg] = await db.insert(messagesTable).values(values).returning();
  return msg;
}

export async function markMessagesRead(messageIds: Array<number | string>, excludeSenderId: number) {
  await db.update(messagesTable)
    .set({ status: "read" })
    .where(
      and(
        sql`${messagesTable.id} IN ${messageIds}`,
        sql`${messagesTable.senderId} != ${excludeSenderId}`,
      )
    );
}

export async function markMessagesDelivered(messageIds: Array<number | string>, excludeSenderId: number) {
  await db.update(messagesTable)
    .set({ status: "delivered" })
    .where(
      and(
        sql`${messagesTable.id} IN ${messageIds}`,
        sql`${messagesTable.senderId} != ${excludeSenderId}`,
        eq(messagesTable.status, "sent"),
      )
    );
}

export async function getMessageSenderId(messageIds: Array<number | string>) {
  const msgs = await db.select({ senderId: messagesTable.senderId })
    .from(messagesTable)
    .where(sql`${messagesTable.id} IN ${messageIds}`)
    .limit(1);
  return msgs.length > 0 ? msgs[0].senderId : null;
}

export async function getConversationRows(myId: number) {
  const rows = await db.execute(sql`
      SELECT
        CASE WHEN sender_id = ${myId} THEN recipient_id ELSE sender_id END AS peer_id,
        MAX(id) AS last_msg_id,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE sender_id != ${myId} AND status != 'read') AS unread_count,
        MAX(CASE WHEN sender_id != ${myId} THEN type END) AS last_type
      FROM messages
      WHERE (sender_id = ${myId} OR recipient_id = ${myId}) AND ride_id = 0
      GROUP BY peer_id
      ORDER BY last_msg_id DESC
      LIMIT 50
    `);
  return rows.rows as any[];
}

export async function getPeerProfiles(peerIds: number[]) {
  return db.select({
    id: usersTable.id,
    name: usersTable.name,
    phone: usersTable.phone,
    role: usersTable.role,
  }).from(usersTable).where(sql`${usersTable.id} IN ${peerIds}`);
}

export async function getMessagesByIds(messageIds: Array<number | string>) {
  return db.select().from(messagesTable)
    .where(sql`${messagesTable.id} IN ${messageIds}`);
}

export async function getDispatchers() {
  return db.select({
    id: usersTable.id,
    name: usersTable.name,
    phone: usersTable.phone,
    acceptsCalls: usersTable.acceptsCalls,
  }).from(usersTable).where(
    or(eq(usersTable.role, "dispatcher"), eq(usersTable.role, "admin"))
  );
}

export async function getUnreadDmCount(myId: number): Promise<number> {
  const dmResult = (await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM messages
      WHERE recipient_id = ${myId} AND status != 'read' AND ride_id = 0
    `)).rows as any[];
  return parseInt(dmResult[0]?.cnt || "0");
}
