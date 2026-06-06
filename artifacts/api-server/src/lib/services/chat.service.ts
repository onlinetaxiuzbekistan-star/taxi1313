/**
 * Chat service — encapsulates chat/message persistence so route handlers and
 * websocket callbacks don't issue raw DB calls directly. HTTP/business concerns
 * (auth, broadcasts, notifications, branching) stay in the routes; this is the
 * data-access seam.
 */
import { db, messagesTable, usersTable, ridesTable, chatParticipantsTable } from "@workspace/db";
import { eq, and, or, asc, sql } from "drizzle-orm";

/** Returns the user ids of all participants in a ride's chat. */
export async function getRideParticipantIds(rideId: number): Promise<number[]> {
  const participants = await db.select({ userId: chatParticipantsTable.userId })
    .from(chatParticipantsTable)
    .where(eq(chatParticipantsTable.rideId, rideId));
  return participants.map(p => p.userId);
}

/** Returns the full participant rows for a ride's chat. */
export async function getRideParticipants(rideId: number) {
  return db.select().from(chatParticipantsTable)
    .where(eq(chatParticipantsTable.rideId, rideId));
}

/** Idempotently adds a user to a ride's chat participants; conflicts are ignored. */
export async function ensureParticipant(rideId: number, userId: number, role: string, name: string) {
  try {
    await db.insert(chatParticipantsTable).values({
      rideId, userId, role, name,
    }).onConflictDoNothing();
  } catch {}
}

/** Looks up a user's id, name, and role; returns undefined if not found. */
export async function getUserNameInfo(userId: number) {
  const user = await db.select({ name: usersTable.name, role: usersTable.role, id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.id, userId)).limit(1);
  return user[0];
}

/** Returns the driver id assigned to a ride, or null if unassigned/not found. */
export async function getRideDriverId(rideId: number): Promise<number | null> {
  const ride = await db.select({ driverId: ridesTable.driverId }).from(ridesTable)
    .where(eq(ridesTable.id, rideId)).limit(1);
  return ride.length > 0 ? ride[0].driverId : null;
}

/** Returns up to 200 messages for a ride's group chat, oldest first. */
export async function getMessagesByRide(rideId: number) {
  return db.select().from(messagesTable)
    .where(eq(messagesTable.rideId, rideId))
    .orderBy(asc(messagesTable.createdAt))
    .limit(200);
}

/** Returns up to 200 direct messages exchanged between two users, oldest first. */
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

/** Returns all messages for a ride, oldest first (unbounded). */
export async function getRideMessagesOrdered(rideId: number) {
  return db.select().from(messagesTable)
    .where(eq(messagesTable.rideId, rideId))
    .orderBy(asc(messagesTable.createdAt));
}

/** Inserts a message and returns the persisted row. */
export async function insertMessage(values: typeof messagesTable.$inferInsert) {
  const [msg] = await db.insert(messagesTable).values(values).returning();
  return msg;
}

/**
 * Marks the given messages as "read", skipping any sent by `excludeSenderId`.
 * @param excludeSenderId sender whose own messages should not be marked read
 */
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

/**
 * Promotes the given messages from "sent" to "delivered", skipping any sent by
 * `excludeSenderId`.
 * @param excludeSenderId sender whose own messages should not be marked delivered
 */
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

/** Returns the sender id of the first matching message, or null if none found. */
export async function getMessageSenderId(messageIds: Array<number | string>) {
  const msgs = await db.select({ senderId: messagesTable.senderId })
    .from(messagesTable)
    .where(sql`${messagesTable.id} IN ${messageIds}`)
    .limit(1);
  return msgs.length > 0 ? msgs[0].senderId : null;
}

/** One row per DM conversation (ride_id = 0), summarizing the latest message and unread count. */
interface ConversationRow {
  peer_id: number;
  last_msg_id: number;
  // pg returns COUNT(*) (bigint) as strings; callers parseInt() them.
  total: string;
  unread_count: string;
  last_type: string | null;
}

/**
 * Aggregates the caller's direct-message threads (ride_id = 0): one row per peer
 * with last message id, totals, unread count, and last inbound message type.
 * @returns up to 50 conversation summary rows, newest activity first
 */
export async function getConversationRows(myId: number): Promise<ConversationRow[]> {
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
  return rows.rows as unknown as ConversationRow[];
}

/** Returns id/name/phone/role profiles for the given peer user ids. */
export async function getPeerProfiles(peerIds: number[]) {
  return db.select({
    id: usersTable.id,
    name: usersTable.name,
    phone: usersTable.phone,
    role: usersTable.role,
  }).from(usersTable).where(sql`${usersTable.id} IN ${peerIds}`);
}

/** Returns the full message rows for the given ids. */
export async function getMessagesByIds(messageIds: Array<number | string>) {
  return db.select().from(messagesTable)
    .where(sql`${messagesTable.id} IN ${messageIds}`);
}

/** Returns dispatcher and admin users with call-availability info. */
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

/** Returns the count of unread direct messages (ride_id = 0) addressed to the user. */
export async function getUnreadDmCount(myId: number): Promise<number> {
  const dmResult = (await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM messages
      WHERE recipient_id = ${myId} AND status != 'read' AND ride_id = 0
    `)).rows as Array<{ cnt: string }>;
  return parseInt(dmResult[0]?.cnt || "0");
}
