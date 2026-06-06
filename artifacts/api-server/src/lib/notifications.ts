import webpush from "web-push";
import { UnrecoverableError } from "bullmq";
import { db, deviceTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { broadcastToUser, broadcastToRole } from "./websocket.js";
import { enqueuePushJob, type PushJobData } from "./queues/push.queue.js";
import { logger } from "./logger.js";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@buxtaxi.uz";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  logger.info("Web Push (VAPID) configured");
} else {
  logger.warn("VAPID keys not set — push notifications disabled");
}

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  icon?: string;
  badge?: string;
}

async function getUserSubscriptions(userId: number) {
  return db.select()
    .from(deviceTokensTable)
    .where(eq(deviceTokensTable.userId, userId));
}

// Producer: fan a user out into one queued job per subscription. The actual
// webpush.sendNotification() happens in deliverPushJob() on the worker side.
async function enqueuePush(userId: number, payload: PushPayload): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    logger.debug({ userId, title: payload.title }, "VAPID not configured, skipping push");
    return;
  }

  const subscriptions = await getUserSubscriptions(userId);
  if (subscriptions.length === 0) return;

  for (const sub of subscriptions) {
    if (!sub.endpoint || !sub.p256dh || !sub.auth) continue;
    await enqueuePushJob({
      userId,
      subId: sub.id,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      payload,
    });
  }
}

// Worker side: deliver a single subscription's push. Throws UnrecoverableError
// on 410/404 (subscription is gone — deleted, never retry); rethrows other
// errors so BullMQ retries with backoff.
export async function deliverPushJob(data: PushJobData): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  const { userId, subId, endpoint, p256dh, auth, payload } = data;

  const pushPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: payload.icon || "/images/logo-icon.png",
    badge: payload.badge || "/images/logo-icon.png",
    data: payload.data || {},
  });

  const pushSubscription = { endpoint, keys: { p256dh, auth } };

  try {
    await webpush.sendNotification(pushSubscription, pushPayload);
    logger.info({ userId, title: payload.title }, "Web Push sent");
  } catch (err: any) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      await db.delete(deviceTokensTable).where(eq(deviceTokensTable.id, subId));
      logger.info({ userId, subId, statusCode: err.statusCode }, "Removed expired push subscription");
      throw new UnrecoverableError(`subscription_gone_${err.statusCode}`);
    }
    logger.warn({ err: err.message, statusCode: err.statusCode, userId }, "Web Push send error");
    throw err;
  }
}

export async function notifyNewOrder(driverId: number, rideId: number, fromCity: string, toCity: string, price: number): Promise<void> {
  broadcastToUser(driverId, {
    type: "new_order",
    rideId,
    title: "Новый заказ",
    body: `${fromCity} → ${toCity}, ${price.toLocaleString("ru-RU")} сум`,
  });

  await enqueuePush(driverId, {
    title: "🚕 Новый заказ",
    body: `${fromCity} → ${toCity}, ${price.toLocaleString("ru-RU")} сум`,
    data: { type: "new_order", rideId: String(rideId), url: "/driver" },
  });
}

export async function notifyOrderAccepted(rideId: number, driverName: string): Promise<void> {
  broadcastToRole("dispatcher", {
    type: "order_accepted",
    rideId,
    driverName,
    message: `Заказ #${rideId} принят водителем ${driverName}`,
  });
}

export async function notifyOrderAssigned(driverId: number, rideId: number, fromCity: string, toCity: string): Promise<void> {
  broadcastToUser(driverId, {
    type: "order_assigned",
    rideId,
    title: "Заказ назначен",
    body: `Вам назначен заказ #${rideId}: ${fromCity} → ${toCity}`,
  });

  await enqueuePush(driverId, {
    title: "📋 Заказ назначен",
    body: `Вам назначен заказ #${rideId}: ${fromCity} → ${toCity}`,
    data: { type: "order_assigned", rideId: String(rideId), url: "/driver" },
  });
}

export async function notifyOrderTaken(driverId: number, rideId: number): Promise<void> {
  broadcastToUser(driverId, {
    type: "order_taken",
    rideId,
    message: `Заказ #${rideId} принят другим водителем`,
  });

  await enqueuePush(driverId, {
    title: "Заказ занят",
    body: `Заказ #${rideId} был принят другим водителем`,
    data: { type: "order_taken", rideId: String(rideId) },
  });
}

export async function registerPushSubscription(
  userId: number,
  role: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
): Promise<void> {
  const token = subscription.endpoint;

  await db.insert(deviceTokensTable).values({
    userId,
    role: role as any,
    token,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  }).onConflictDoUpdate({
    target: [deviceTokensTable.userId, deviceTokensTable.token],
    set: {
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      updatedAt: new Date(),
    },
  });

  logger.info({ userId, role, endpoint: subscription.endpoint }, "Push subscription registered");
}

export async function notifyNewChatMessage(
  recipientId: number,
  senderId: number,
  senderName: string,
  messagePreview: string,
  rideId: number,
  peerId?: number | null,
): Promise<void> {
  const preview = messagePreview.length > 80 ? messagePreview.slice(0, 80) + "…" : messagePreview;

  await enqueuePush(recipientId, {
    title: `💬 ${senderName}`,
    body: preview,
    data: {
      type: "new_message",
      senderId: String(senderId),
      rideId: String(rideId),
      peerId: String(peerId || senderId),
      url: "/driver",
    },
  });
}

export async function notifyChatMessageToRecipients(
  recipientIds: number[],
  senderId: number,
  senderName: string,
  messagePreview: string,
  rideId: number,
): Promise<void> {
  const tasks = recipientIds
    .filter(id => id !== senderId)
    .map(id => notifyNewChatMessage(id, senderId, senderName, messagePreview, rideId));
  await Promise.allSettled(tasks);
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

export async function registerDeviceToken(userId: number, role: string, token: string): Promise<void> {
  await db.insert(deviceTokensTable).values({
    userId,
    role: role as any,
    token,
  }).onConflictDoUpdate({
    target: [deviceTokensTable.userId, deviceTokensTable.token],
    set: { updatedAt: new Date() },
  });
}
