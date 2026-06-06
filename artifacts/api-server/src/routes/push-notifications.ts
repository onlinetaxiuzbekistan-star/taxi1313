import { Router, type IRouter, type Response } from "express";
import { type AuthRequest, authMiddleware, requireRole } from "../middlewares/auth.js";
import { db, pushNotificationsTable, usersTable, deviceTokensTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import { broadcastToUser } from "../lib/websocket.js";
import webpush from "web-push";
import { logger } from "../lib/logger.js";

const UPLOADS_DIR = path.resolve(process.cwd(), "artifacts", "uploads", "push");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const pushStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const pushUpload = multer({
  storage: pushStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"));
  },
});

const router: IRouter = Router();

router.get("/", authMiddleware, requireRole("admin", "dispatcher"), async (req: AuthRequest, res: Response) => {
  try {
    const { page = "1", limit = "50" } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const items = await db.select()
      .from(pushNotificationsTable)
      .orderBy(desc(pushNotificationsTable.createdAt))
      .limit(parseInt(limit))
      .offset(offset);

    const [countResult] = await db.select({ count: sql<number>`count(*)` })
      .from(pushNotificationsTable);

    res.json({ items, total: Number(countResult.count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/send", authMiddleware, requireRole("admin", "dispatcher"), pushUpload.array("photos", 10), async (req: AuthRequest, res: Response) => {
  try {
    const { title, content, videoUrl, audience, cityId, branchId, driverGroupId } = req.body;

    if (!title || !content) {
      res.status(400).json({ error: "Заголовок и текст обязательны" });
      return;
    }

    const files = (req as any).files as Express.Multer.File[] || [];
    const photos = files.map(f => `/api/uploads/push/${f.filename}`);

    const [created] = await db.insert(pushNotificationsTable).values({
      title,
      content,
      photos,
      videoUrl: videoUrl || null,
      audience: audience || "all",
      cityId: cityId ? parseInt(cityId) : null,
      branchId: branchId ? parseInt(branchId) : null,
      driverGroupId: driverGroupId ? parseInt(driverGroupId) : null,
      authorId: req.userId!,
    }).returning();

    const result = await sendPushToAudience(created);

    await db.update(pushNotificationsTable)
      .set({ sentCount: result.sent, deliveredCount: result.delivered })
      .where(eq(pushNotificationsTable.id, created.id));

    res.json({
      ...created,
      sentCount: result.sent,
      deliveredCount: result.delivered,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", authMiddleware, requireRole("admin", "dispatcher"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [deleted] = await db.delete(pushNotificationsTable).where(eq(pushNotificationsTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function sendPushToAudience(push: typeof pushNotificationsTable.$inferSelect) {
  const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";

  let targetUsers: { id: number }[] = [];

  if (push.audience === "driver" || push.audience === "all") {
    let conditions: any[] = [eq(usersTable.role, "driver")];
    if (push.cityId) {
      conditions.push(sql`${usersTable.city} = ${String(push.cityId)}`);
    }
    if (push.driverGroupId) {
      conditions.push(eq(usersTable.groupId, push.driverGroupId));
    }
    const drivers = await db.select({ id: usersTable.id }).from(usersTable).where(and(...conditions));
    targetUsers.push(...drivers);
  }

  if (push.audience === "client" || push.audience === "all") {
    const clients = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "rider"));
    targetUsers.push(...clients);
  }

  let sent = 0;
  let delivered = 0;

  for (const user of targetUsers) {
    broadcastToUser(user.id, {
      type: "push_notification",
      pushId: push.id,
      title: push.title,
      content: push.content.substring(0, 100),
      photos: push.photos,
    });

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) continue;

    const subs = await db.select().from(deviceTokensTable).where(eq(deviceTokensTable.userId, user.id));
    for (const sub of subs) {
      if (!sub.endpoint || !sub.p256dh || !sub.auth) continue;
      sent++;
      try {
        const photoUrl = push.photos && (push.photos as string[]).length > 0 ? (push.photos as string[])[0] : null;
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({
            title: push.title,
            body: push.content.substring(0, 200).replace(/\*\*/g, ""),
            icon: "/images/logo-icon.png",
            badge: "/images/logo-icon.png",
            image: photoUrl || undefined,
            data: { type: "push_broadcast", pushId: String(push.id) },
          })
        );
        delivered++;
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.delete(deviceTokensTable).where(eq(deviceTokensTable.id, sub.id));
        }
      }
    }
  }

  logger.info({ pushId: push.id, targetCount: targetUsers.length, sent, delivered }, "Push broadcast sent");
  return { sent, delivered };
}

export default router;
