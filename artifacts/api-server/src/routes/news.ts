import { errorMessage } from "../lib/errors.js";
import { Router, type IRouter, type Response } from "express";
import { type AuthRequest, authMiddleware, requireRole } from "../middlewares/auth.js";
import { db, newsTable, newsReadsTable, usersTable, deviceTokensTable } from "@workspace/db";
import { eq, desc, and, sql, inArray, notInArray } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import { broadcastToRole, broadcastToUser } from "../lib/websocket.js";
import webpush from "web-push";
import { config } from "../lib/config.js";
import { logger } from "../lib/logger.js";

const UPLOADS_DIR = path.resolve(process.cwd(), "artifacts", "uploads", "news");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const newsStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const newsUpload = multer({
  storage: newsStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"));
  },
});

const router: IRouter = Router();

router.get("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const user = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).then(r => r[0]);
    const isAdmin = user && (user.role === "admin" || user.role === "dispatcher");

    let conditions: any[] = [eq(newsTable.isPublished, true)];
    if (!isAdmin) {
      const roleAudience = user?.role === "driver" ? "driver" : "client";
      conditions.push(inArray(newsTable.audience, ["all", roleAudience]));
    }

    const items = await db.select()
      .from(newsTable)
      .where(and(...conditions))
      .orderBy(desc(newsTable.createdAt))
      .limit(parseInt(limit))
      .offset(offset);

    const readNewsIds = req.userId ? await db.select({ newsId: newsReadsTable.newsId })
      .from(newsReadsTable)
      .where(eq(newsReadsTable.userId, req.userId!)) : [];

    const readSet = new Set(readNewsIds.map(r => r.newsId));

    const enriched = items.map(n => ({
      ...n,
      isRead: readSet.has(n.id),
    }));

    const [countResult] = await db.select({ count: sql<number>`count(*)` })
      .from(newsTable)
      .where(and(...conditions));

    res.json({ items: enriched, total: Number(countResult.count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get("/unread", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const user = await db.select().from(usersTable).where(eq(usersTable.id, userId)).then(r => r[0]);
    if (!user) { res.json({ items: [] }); return; }

    const audienceFilter = user.role === "driver"
      ? sql`${newsTable.audience} IN ('driver', 'all')`
      : sql`${newsTable.audience} IN ('client', 'all')`;

    const readIds = await db.select({ newsId: newsReadsTable.newsId })
      .from(newsReadsTable)
      .where(eq(newsReadsTable.userId, userId));

    const readSet = readIds.map(r => r.newsId);

    let conditions: any[] = [
      eq(newsTable.isPublished, true),
      audienceFilter,
    ];

    if (readSet.length > 0) {
      conditions.push(notInArray(newsTable.id, readSet));
    }

    if (user.role === "driver") {
      conditions.push(
        sql`(${newsTable.cityId} IS NULL OR ${newsTable.cityId}::text = ${user.city || ""})`
      );
      conditions.push(
        sql`(${newsTable.driverGroupId} IS NULL OR ${newsTable.driverGroupId} = ${user.groupId || 0})`
      );
    }

    const items = await db.select()
      .from(newsTable)
      .where(and(...conditions))
      .orderBy(desc(newsTable.createdAt));

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [item] = await db.select().from(newsTable).where(eq(newsTable.id, id));
    if (!item) { res.status(404).json({ error: "Not found" }); return; }

    const user = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).then(r => r[0]);
    const isAdmin = user && (user.role === "admin" || user.role === "dispatcher");

    if (!isAdmin && !item.isPublished) {
      res.status(404).json({ error: "Not found" }); return;
    }

    if (!isAdmin && item.audience !== "all") {
      const roleAudience = user?.role === "driver" ? "driver" : "client";
      if (item.audience !== roleAudience) {
        res.status(403).json({ error: "Access denied" }); return;
      }
    }

    const [readRecord] = await db.select().from(newsReadsTable)
      .where(and(eq(newsReadsTable.newsId, id), eq(newsReadsTable.userId, req.userId!)));

    res.json({ ...item, isRead: !!readRecord });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post("/", authMiddleware, requireRole("admin", "dispatcher"), newsUpload.array("photos", 10), async (req: AuthRequest, res: Response) => {
  try {
    const { title, content, videoUrl, audience, cityId, branchId, driverGroupId } = req.body;

    if (!title || !content) {
      res.status(400).json({ error: "Title and content are required" });
      return;
    }

    const files = (req as any).files as Express.Multer.File[] || [];
    const photos = files.map(f => `/api/uploads/news/${f.filename}`);

    let existingPhotos: string[] = [];
    if (req.body.existingPhotos) {
      try {
        existingPhotos = JSON.parse(req.body.existingPhotos);
      } catch {}
    }

    const [created] = await db.insert(newsTable).values({
      title,
      content,
      photos: [...existingPhotos, ...photos],
      videoUrl: videoUrl || null,
      audience: audience || "all",
      cityId: cityId ? parseInt(cityId) : null,
      branchId: branchId ? parseInt(branchId) : null,
      driverGroupId: driverGroupId ? parseInt(driverGroupId) : null,
      isPublished: true,
      authorId: req.userId!,
    }).returning();

    sendNewsPush(created).catch(err => logger.error({ err }, "News push error"));

    res.json(created);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.patch("/:id", authMiddleware, requireRole("admin", "dispatcher"), newsUpload.array("photos", 10), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { title, content, videoUrl, audience, cityId, branchId, driverGroupId, isPublished } = req.body;

    const files = (req as any).files as Express.Multer.File[] || [];
    const newPhotos = files.map(f => `/api/uploads/news/${f.filename}`);

    let existingPhotos: string[] = [];
    if (req.body.existingPhotos) {
      try {
        existingPhotos = JSON.parse(req.body.existingPhotos);
      } catch {}
    }

    const updates: any = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (videoUrl !== undefined) updates.videoUrl = videoUrl || null;
    if (audience !== undefined) updates.audience = audience;
    if (cityId !== undefined) updates.cityId = cityId ? parseInt(cityId) : null;
    if (branchId !== undefined) updates.branchId = branchId ? parseInt(branchId) : null;
    if (driverGroupId !== undefined) updates.driverGroupId = driverGroupId ? parseInt(driverGroupId) : null;
    if (isPublished !== undefined) updates.isPublished = isPublished === "true" || isPublished === true;
    if (newPhotos.length > 0 || req.body.existingPhotos) {
      updates.photos = [...existingPhotos, ...newPhotos];
    }

    const [updated] = await db.update(newsTable).set(updates).where(eq(newsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.delete("/:id", authMiddleware, requireRole("admin", "dispatcher"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(newsReadsTable).where(eq(newsReadsTable.newsId, id));
    const [deleted] = await db.delete(newsTable).where(eq(newsTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post("/:id/read", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const newsId = parseInt(req.params.id);
    if (isNaN(newsId)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const userId = req.userId!;

    const [newsItem] = await db.select().from(newsTable).where(and(eq(newsTable.id, newsId), eq(newsTable.isPublished, true)));
    if (!newsItem) { res.status(404).json({ error: "Not found" }); return; }

    const [existing] = await db.select().from(newsReadsTable)
      .where(and(eq(newsReadsTable.newsId, newsId), eq(newsReadsTable.userId, userId)));

    if (!existing) {
      await db.insert(newsReadsTable).values({ newsId, userId });
    }

    res.json({ read: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get("/:id/stats", authMiddleware, requireRole("admin", "dispatcher"), async (req: AuthRequest, res: Response) => {
  try {
    const newsId = parseInt(req.params.id);
    const [readCount] = await db.select({ count: sql<number>`count(*)` })
      .from(newsReadsTable)
      .where(eq(newsReadsTable.newsId, newsId));

    res.json({ newsId, readCount: Number(readCount.count) });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

async function sendNewsPush(news: typeof newsTable.$inferSelect) {
  const VAPID_PUBLIC_KEY = config.vapid.publicKey;
  const VAPID_PRIVATE_KEY = config.vapid.privateKey;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  let targetUsers: { id: number }[] = [];

  if (news.audience === "driver" || news.audience === "all") {
    let conditions: any[] = [eq(usersTable.role, "driver")];
    if (news.cityId) {
      conditions.push(sql`${usersTable.city} = ${String(news.cityId)}`);
    }
    if (news.driverGroupId) {
      conditions.push(eq(usersTable.groupId, news.driverGroupId));
    }
    const drivers = await db.select({ id: usersTable.id }).from(usersTable).where(and(...conditions));
    targetUsers.push(...drivers);
  }

  if (news.audience === "client" || news.audience === "all") {
    const clients = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "rider"));
    targetUsers.push(...clients);
  }

  const payload = JSON.stringify({
    title: `📰 ${news.title}`,
    body: news.content.substring(0, 100) + (news.content.length > 100 ? "..." : ""),
    icon: "/images/logo-icon.png",
    badge: "/images/logo-icon.png",
    data: { type: "news", newsId: String(news.id) },
  });

  for (const user of targetUsers) {
    broadcastToUser(user.id, {
      type: "news_published",
      newsId: news.id,
      title: news.title,
    });

    const subs = await db.select().from(deviceTokensTable).where(eq(deviceTokensTable.userId, user.id));
    for (const sub of subs) {
      if (!sub.endpoint || !sub.p256dh || !sub.auth) continue;
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode === 410 || (err as { statusCode?: number }).statusCode === 404) {
          await db.delete(deviceTokensTable).where(eq(deviceTokensTable.id, sub.id));
        }
      }
    }
  }

  logger.info({ newsId: news.id, targetCount: targetUsers.length }, "News push sent");
}

export default router;
