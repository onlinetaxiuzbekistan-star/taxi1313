import { Router } from "express";
import { db, photoTasksTable, photoRequestsTable, photoHistoryTable, usersTable, driverGroupsTable } from "@workspace/db";
import { eq, and, desc, inArray, sql, or, ilike } from "drizzle-orm";
import { authMiddleware, requireRole } from "../middlewares/auth.js";
import type { AuthRequest } from "../middlewares/auth.js";
import { broadcastToUser } from "../lib/websocket.js";
import { validatePhotos } from "../lib/photo-ai-validator.js";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";

const UPLOADS_DIR = path.resolve(process.cwd(), "artifacts", "uploads", "photo-control");

import fs from "fs";
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `pc_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Допустимы только изображения (JPEG, PNG, WebP)"));
    }
  },
});

const BLOCKING_STATUSES = ["pending", "rejected_final"];

function isBlocked(status: string, retryCount: number): boolean {
  if (status === "pending") return true;
  if (status === "rejected_final") return true;
  if (status === "rejected_auto") return true;
  if (status === "rejected" && retryCount >= 2) return true;
  return false;
}

const router = Router();

router.get("/tasks", authMiddleware, requireRole("admin", "dispatcher"), async (_req, res) => {
  try {
    const tasks = await db.select().from(photoTasksTable).orderBy(desc(photoTasksTable.createdAt));
    const groups = await db.select().from(driverGroupsTable);
    const groupMap = Object.fromEntries(groups.map(g => [g.id, g.label]));
    res.json({ tasks: tasks.map(t => ({ ...t, groupLabel: t.groupId ? groupMap[t.groupId] || null : null })) });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/tasks", authMiddleware, requireRole("admin", "dispatcher"), async (req: AuthRequest, res) => {
  try {
    const { name, groupId, scheduleType, isActive } = req.body;
    if (!name) return res.status(400).json({ error: "name_required" });
    const [task] = await db.insert(photoTasksTable).values({
      name,
      groupId: groupId ? parseInt(groupId) : null,
      scheduleType: scheduleType || "manual",
      isActive: isActive !== false,
    }).returning();
    res.json({ task });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.patch("/tasks/:id", authMiddleware, requireRole("admin", "dispatcher"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "invalid_id" });
    const updates: any = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.groupId !== undefined) updates.groupId = req.body.groupId ? parseInt(req.body.groupId) : null;
    if (req.body.scheduleType !== undefined) updates.scheduleType = req.body.scheduleType;
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "no_updates" });
    const [updated] = await db.update(photoTasksTable).set(updates).where(eq(photoTasksTable.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "not_found" });
    res.json({ task: updated });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/tasks/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "invalid_id" });
    const [deleted] = await db.delete(photoTasksTable).where(eq(photoTasksTable.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: "not_found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/tasks/:id/send", authMiddleware, requireRole("admin", "dispatcher"), async (req: AuthRequest, res) => {
  try {
    const taskId = parseInt(req.params.id);
    if (isNaN(taskId)) return res.status(400).json({ error: "invalid_id" });

    const [task] = await db.select().from(photoTasksTable).where(eq(photoTasksTable.id, taskId));
    if (!task) return res.status(404).json({ error: "task_not_found" });

    let drivers;
    if (task.groupId) {
      drivers = await db.select({ id: usersTable.id }).from(usersTable)
        .where(and(eq(usersTable.role, "driver"), eq(usersTable.groupId, task.groupId)));
    } else {
      drivers = await db.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.role, "driver"));
    }

    if (drivers.length === 0) return res.json({ created: 0 });

    const existingActive = await db.select({ driverId: photoRequestsTable.driverId })
      .from(photoRequestsTable)
      .where(and(
        inArray(photoRequestsTable.driverId, drivers.map(d => d.id)),
        inArray(photoRequestsTable.status, ["pending", "under_review"]),
      ));
    const alreadyActive = new Set(existingActive.map(e => e.driverId));

    const toCreate = drivers.filter(d => !alreadyActive.has(d.id));
    if (toCreate.length === 0) return res.json({ created: 0, message: "Все водители уже имеют активные запросы" });

    await db.insert(photoRequestsTable).values(
      toCreate.map(d => ({
        driverId: d.id,
        taskId,
        status: "pending",
        retryCount: 0,
      }))
    );

    for (const d of toCreate) {
      broadcastToUser(d.id, { type: "photo_control_required" });
    }

    res.json({ created: toCreate.length });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/requests", authMiddleware, requireRole("admin", "dispatcher"), async (req, res) => {
  try {
    const { status, taskId, search, groupId, city, page, limit: lim } = req.query;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(lim as string) || 50));
    const offset = (pageNum - 1) * perPage;

    const statusFilter = status && status !== "all" ? status as string : null;
    const taskIdFilter = taskId ? parseInt(taskId as string) : null;

    let searchDriverIds: number[] | null = null;
    if (search || groupId || city) {
      const driverConditions: any[] = [eq(usersTable.role, "driver")];
      if (search) {
        const s = `%${search}%`;
        driverConditions.push(or(
          ilike(usersTable.name, s),
          ilike(usersTable.phone, s),
          ilike(usersTable.carNumber, s),
          ilike(usersTable.city, s),
        ));
      }
      if (groupId) driverConditions.push(eq(usersTable.groupId, parseInt(groupId as string)));
      if (city) driverConditions.push(ilike(usersTable.city, city as string));

      const matchedDrivers = await db.select({ id: usersTable.id }).from(usersTable)
        .where(and(...driverConditions));
      searchDriverIds = matchedDrivers.map(d => d.id);
      if (searchDriverIds.length === 0) {
        return res.json({ requests: [], total: 0, page: pageNum, perPage });
      }
    }

    const latestSubquery = sql`
      SELECT DISTINCT ON (driver_id) *
      FROM photo_requests
      WHERE TRUE
      ${statusFilter ? sql`AND status = ${statusFilter}` : sql``}
      ${taskIdFilter ? sql`AND task_id = ${taskIdFilter}` : sql``}
      ${searchDriverIds && searchDriverIds.length > 0
        ? sql`AND driver_id IN (${sql.join(searchDriverIds.map((id) => sql`${id}`), sql`, `)})`
        : sql``}
      AND status != 'unblocked'
      ORDER BY driver_id, created_at DESC
    `;

    const countResult = await db.execute(sql`SELECT count(*)::int AS total FROM (${latestSubquery}) sub`);
    const total = (countResult.rows[0] as any)?.total || 0;

    const requestsResult = await db.execute(sql`
      SELECT * FROM (${latestSubquery}) sub
      ORDER BY sub.created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);
    const requests = requestsResult.rows as any[];

    const driverIds = [...new Set(requests.map(r => r.driver_id))];
    let driversMap: Record<number, any> = {};
    if (driverIds.length > 0) {
      const drivers = await db.select({
        id: usersTable.id, name: usersTable.name, phone: usersTable.phone,
        carBrand: usersTable.carBrand, carModel: usersTable.carModel, carNumber: usersTable.carNumber,
        groupId: usersTable.groupId, city: usersTable.city,
        lastSelfieUrl: usersTable.lastSelfieUrl,
        lastCarFrontUrl: usersTable.lastCarFrontUrl,
        lastCarBackUrl: usersTable.lastCarBackUrl,
        lastInteriorUrl: usersTable.lastInteriorUrl,
      }).from(usersTable).where(inArray(usersTable.id, driverIds));

      const groupIds = [...new Set(drivers.map(d => d.groupId).filter(Boolean))] as number[];
      let groupMap: Record<number, string> = {};
      if (groupIds.length > 0) {
        const groups = await db.select({ id: driverGroupsTable.id, label: driverGroupsTable.label })
          .from(driverGroupsTable).where(inArray(driverGroupsTable.id, groupIds));
        groupMap = Object.fromEntries(groups.map(g => [g.id, g.label]));
      }

      driversMap = Object.fromEntries(drivers.map(d => [d.id, {
        ...d,
        groupLabel: d.groupId ? groupMap[d.groupId] || null : null,
      }]));
    }

    res.json({
      requests: requests.map(r => ({
        id: r.id,
        driverId: r.driver_id,
        taskId: r.task_id,
        status: r.status,
        selfieUrl: r.selfie_url,
        carFrontUrl: r.car_front_url,
        carBackUrl: r.car_back_url,
        interiorUrl: r.interior_url,
        comment: r.comment,
        rejectReason: r.reject_reason,
        previousRequestId: r.previous_request_id,
        retryCount: r.retry_count,
        aiResults: r.ai_results,
        aiStatus: r.ai_status,
        reviewedBy: r.reviewed_by,
        reviewedAt: r.reviewed_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        driver: driversMap[r.driver_id] || null,
      })),
      total,
      page: pageNum,
      perPage,
    });
  } catch (err) {
    console.error("[PHOTO-CONTROL] /requests error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.patch("/requests/:id/review", authMiddleware, requireRole("admin", "dispatcher"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "invalid_id" });
    const { status, comment } = req.body;
    if (!status || !["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "invalid_status" });
    }

    const [existing] = await db.select().from(photoRequestsTable).where(eq(photoRequestsTable.id, id));
    if (!existing) return res.status(404).json({ error: "not_found" });
    if (existing.status === "approved" || existing.status === "rejected" || existing.status === "rejected_final" || existing.status === "rejected_auto") {
      return res.status(400).json({ error: "already_reviewed", message: "Запрос уже проверен" });
    }
    if (status === "approved" && !existing.selfieUrl) {
      return res.status(400).json({ error: "no_photos", message: "Фото ещё не загружены" });
    }

    if (status === "approved") {
      const [updated] = await db.update(photoRequestsTable).set({
        status: "approved",
        comment: comment || null,
        rejectReason: null,
        retryCount: 0,
        reviewedBy: (req as AuthRequest).userId || null,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(photoRequestsTable.id, id)).returning();

      const photoUpdates: any = {};
      if (existing.selfieUrl) photoUpdates.lastSelfieUrl = existing.selfieUrl;
      if (existing.carFrontUrl) photoUpdates.lastCarFrontUrl = existing.carFrontUrl;
      if (existing.carBackUrl) photoUpdates.lastCarBackUrl = existing.carBackUrl;
      if (existing.interiorUrl) photoUpdates.lastInteriorUrl = existing.interiorUrl;
      if (Object.keys(photoUpdates).length > 0) {
        await db.update(usersTable).set(photoUpdates).where(eq(usersTable.id, existing.driverId));
      }
      broadcastToUser(existing.driverId, { type: "photo_control_approved" });
      return res.json({ request: updated });
    }

    const currentRetry = existing.retryCount || 0;
    const newRetryCount = currentRetry + 1;
    const isFinalReject = newRetryCount >= 2;
    const finalStatus = isFinalReject ? "rejected_final" : "rejected";

    const [updated] = await db.update(photoRequestsTable).set({
      status: finalStatus,
      comment: comment || null,
      rejectReason: comment || null,
      retryCount: newRetryCount,
      reviewedBy: (req as AuthRequest).userId || null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(photoRequestsTable.id, id)).returning();

    if (isFinalReject) {
      broadcastToUser(existing.driverId, {
        type: "photo_control_rejected",
        reason: comment || "Доступ временно ограничен до одобрения фотоконтроля",
        blocked: true,
        retryCount: newRetryCount,
      });
    } else {
      const [newRequest] = await db.insert(photoRequestsTable).values({
        driverId: existing.driverId,
        taskId: existing.taskId,
        status: "pending",
        retryCount: newRetryCount,
        rejectReason: comment || null,
        previousRequestId: existing.id,
      }).returning();

      broadcastToUser(existing.driverId, {
        type: "photo_control_rejected",
        reason: comment || "Исправьте ошибки и отправьте заново",
        blocked: false,
        retryCount: newRetryCount,
        newRequestId: newRequest.id,
      });
    }

    res.json({ request: updated });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/requests/bulk-review", authMiddleware, requireRole("admin", "dispatcher"), async (req: AuthRequest, res) => {
  try {
    const { ids, status, comment } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids_required" });
    if (!status || !["approved", "rejected"].includes(status)) return res.status(400).json({ error: "invalid_status" });

    const numIds = ids.map((id: any) => parseInt(id)).filter((n: number) => !isNaN(n));
    if (numIds.length === 0) return res.status(400).json({ error: "invalid_ids" });

    const existing = await db.select().from(photoRequestsTable)
      .where(and(
        inArray(photoRequestsTable.id, numIds),
        inArray(photoRequestsTable.status, ["pending", "under_review"]),
      ));

    if (existing.length === 0) return res.json({ updated: 0 });

    for (const r of existing) {
      if (status === "approved") {
        await db.update(photoRequestsTable).set({
          status: "approved",
          comment: comment || null,
          rejectReason: null,
          retryCount: 0,
          reviewedBy: (req as AuthRequest).userId || null,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(photoRequestsTable.id, r.id));

        const photoUpdates: any = {};
        if (r.selfieUrl) photoUpdates.lastSelfieUrl = r.selfieUrl;
        if (r.carFrontUrl) photoUpdates.lastCarFrontUrl = r.carFrontUrl;
        if (r.carBackUrl) photoUpdates.lastCarBackUrl = r.carBackUrl;
        if (r.interiorUrl) photoUpdates.lastInteriorUrl = r.interiorUrl;
        if (Object.keys(photoUpdates).length > 0) {
          await db.update(usersTable).set(photoUpdates).where(eq(usersTable.id, r.driverId));
        }
        broadcastToUser(r.driverId, { type: "photo_control_approved" });
      }

      if (status === "rejected") {
        const currentRetry = r.retryCount || 0;
        const newRetryCount = currentRetry + 1;
        const isFinalReject = newRetryCount >= 2;

        await db.update(photoRequestsTable).set({
          status: isFinalReject ? "rejected_final" : "rejected",
          comment: comment || null,
          rejectReason: comment || null,
          retryCount: newRetryCount,
          reviewedBy: (req as AuthRequest).userId || null,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(photoRequestsTable.id, r.id));

        if (isFinalReject) {
          broadcastToUser(r.driverId, {
            type: "photo_control_rejected",
            reason: comment || "Доступ временно ограничен до одобрения фотоконтроля",
            blocked: true,
            retryCount: newRetryCount,
          });
        } else {
          await db.insert(photoRequestsTable).values({
            driverId: r.driverId,
            taskId: r.taskId,
            status: "pending",
            retryCount: newRetryCount,
            rejectReason: comment || null,
            previousRequestId: r.id,
          });
          broadcastToUser(r.driverId, {
            type: "photo_control_rejected",
            reason: comment || "Исправьте ошибки и отправьте заново",
            blocked: false,
            retryCount: newRetryCount,
          });
        }
      }
    }

    res.json({ updated: existing.length });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/my-pending", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const driverId = (req as AuthRequest).userId;
    if (!driverId) return res.status(401).json({ error: "unauthorized" });

    const [latest] = await db.select().from(photoRequestsTable)
      .where(eq(photoRequestsTable.driverId, driverId))
      .orderBy(desc(photoRequestsTable.createdAt))
      .limit(1);

    if (!latest) {
      return res.json({ request: null, blocked: false });
    }

    const blocked = isBlocked(latest.status, latest.retryCount || 0);
    res.json({ request: latest, blocked });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/upload-photo", authMiddleware, (req, res, next) => {
  upload.single("photo")(req, res, (err: any) => {
    if (err) {
      res.status(400).json({ error: "upload_error", message: err.message || "Ошибка загрузки" });
      return;
    }
    next();
  });
}, async (req: AuthRequest, res) => {
  try {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: "no_file" });

    try {
      const filePath = path.join(UPLOADS_DIR, file.filename);
      const optimizedName = `opt_${file.filename.replace(/\.[^.]+$/, ".jpg")}`;
      const optimizedPath = path.join(UPLOADS_DIR, optimizedName);
      await sharp(filePath)
        .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toFile(optimizedPath);
      const stat = fs.statSync(optimizedPath);
      if (stat.size < file.size) {
        fs.unlinkSync(filePath);
        const url = `/api/uploads/photo-control/${optimizedName}`;
        res.json({ url });
        return;
      } else {
        fs.unlinkSync(optimizedPath);
      }
    } catch (compErr) {
      console.warn("[PHOTO COMPRESS] Failed, using original:", (compErr as Error)?.message);
    }

    const url = `/api/uploads/photo-control/${file.filename}`;
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.patch("/my-pending/:id/submit", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const driverId = (req as AuthRequest).userId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "invalid_id" });

    const { selfieUrl, carFrontUrl, carBackUrl, interiorUrl } = req.body;
    if (!selfieUrl || !carFrontUrl || !carBackUrl || !interiorUrl) {
      return res.status(400).json({ error: "all_photos_required", message: "Все 4 фото обязательны" });
    }

    const [request] = await db.select().from(photoRequestsTable)
      .where(and(eq(photoRequestsTable.id, id), eq(photoRequestsTable.driverId, driverId!)));
    if (!request) return res.status(404).json({ error: "not_found" });
    if (request.status !== "pending") return res.status(400).json({ error: "already_processed" });

    const aiResult = await validatePhotos({ selfieUrl, carFrontUrl, carBackUrl, interiorUrl });
    const retryCount = request.retryCount || 0;

    if (aiResult.overallStatus === "fail") {
      const failReasons = aiResult.photos
        .filter(p => p.aiStatus === "fail")
        .map(p => p.aiComment)
        .join("; ");

      const newRetryAfterAI = retryCount + 1;
      const isFinalAfterAI = newRetryAfterAI >= 2;

      const txResult = await db.transaction(async (tx) => {
        const [updated] = await tx.update(photoRequestsTable).set({
          selfieUrl, carFrontUrl, carBackUrl, interiorUrl,
          status: isFinalAfterAI ? "rejected_final" : "rejected_auto",
          aiResults: aiResult,
          aiStatus: aiResult.overallStatus,
          retryCount: newRetryAfterAI,
          rejectReason: failReasons || "Фото не прошли автоматическую проверку",
          updatedAt: new Date(),
        }).where(eq(photoRequestsTable.id, id)).returning();

        const historyEntries = [
          { driverId: driverId!, requestId: id, photoType: "selfie", url: selfieUrl },
          { driverId: driverId!, requestId: id, photoType: "car_front", url: carFrontUrl },
          { driverId: driverId!, requestId: id, photoType: "car_back", url: carBackUrl },
          { driverId: driverId!, requestId: id, photoType: "interior", url: interiorUrl },
        ];
        await tx.insert(photoHistoryTable).values(historyEntries);

        let newRequestId: number | null = null;
        if (!isFinalAfterAI) {
          const [newReq] = await tx.insert(photoRequestsTable).values({
            driverId: driverId!,
            taskId: request.taskId,
            status: "pending",
            retryCount: newRetryAfterAI,
            rejectReason: failReasons || "Исправьте фото и отправьте заново",
            previousRequestId: id,
          }).returning();
          newRequestId = newReq.id;
        }

        return { updated, newRequestId };
      });

      if (!isFinalAfterAI && txResult.newRequestId) {
        broadcastToUser(driverId!, {
          type: "photo_control_rejected",
          reason: failReasons || "Фото не прошли автоматическую проверку",
          blocked: false,
          retryCount: newRetryAfterAI,
          aiResults: aiResult,
          newRequestId: txResult.newRequestId,
        });
      } else {
        broadcastToUser(driverId!, {
          type: "photo_control_rejected",
          reason: "Доступ временно ограничен до одобрения фотоконтроля",
          blocked: true,
          retryCount: newRetryAfterAI,
          aiResults: aiResult,
        });
      }

      return res.json({ request: txResult.updated, aiResult, autoRejected: true, newRequestId: txResult.newRequestId });
    }

    const [updated] = await db.update(photoRequestsTable).set({
      selfieUrl, carFrontUrl, carBackUrl, interiorUrl,
      status: "under_review",
      aiResults: aiResult,
      aiStatus: aiResult.overallStatus,
      updatedAt: new Date(),
    }).where(eq(photoRequestsTable.id, id)).returning();

    const historyEntries = [
      { driverId: driverId!, requestId: id, photoType: "selfie", url: selfieUrl },
      { driverId: driverId!, requestId: id, photoType: "car_front", url: carFrontUrl },
      { driverId: driverId!, requestId: id, photoType: "car_back", url: carBackUrl },
      { driverId: driverId!, requestId: id, photoType: "interior", url: interiorUrl },
    ];
    await db.insert(photoHistoryTable).values(historyEntries);

    res.json({ request: updated, aiResult, autoRejected: false });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/history/:driverId", authMiddleware, requireRole("admin", "dispatcher"), async (req, res) => {
  try {
    const driverId = parseInt(req.params.driverId);
    if (isNaN(driverId)) return res.status(400).json({ error: "invalid_id" });
    const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit ?? "5")) || 5));
    const excludeIdRaw = req.query.excludeId ? parseInt(String(req.query.excludeId)) : null;
    const excludeId = excludeIdRaw !== null && Number.isFinite(excludeIdRaw) ? excludeIdRaw : null;

    const result = await db.execute(sql`
      SELECT id, driver_id AS "driverId", task_id AS "taskId", status,
             selfie_url AS "selfieUrl", car_front_url AS "carFrontUrl",
             car_back_url AS "carBackUrl", interior_url AS "interiorUrl",
             comment, reject_reason AS "rejectReason",
             retry_count AS "retryCount",
             ai_results AS "aiResults", ai_status AS "aiStatus",
             reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM photo_requests
      WHERE driver_id = ${driverId}
        AND status NOT IN ('pending', 'unblocked')
        AND (selfie_url IS NOT NULL OR car_front_url IS NOT NULL
             OR car_back_url IS NOT NULL OR interior_url IS NOT NULL)
        ${excludeId !== null ? sql`AND id <> ${excludeId}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);

    res.json({ history: result.rows });
  } catch (err) {
    console.error("[PHOTO-CONTROL] history error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/stats", authMiddleware, requireRole("admin", "dispatcher"), async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        count(*)::int AS total,
        count(*) filter (where status = 'pending')::int AS pending,
        count(*) filter (where status = 'under_review')::int AS "underReview",
        count(*) filter (where status = 'approved')::int AS approved,
        count(*) filter (where status = 'rejected')::int AS rejected,
        count(*) filter (where status = 'rejected_auto')::int AS "rejectedAuto",
        count(*) filter (where status = 'rejected_final')::int AS "rejectedFinal",
        count(*) filter (where selfie_url is not null)::int AS "withPhotos"
      FROM (
        SELECT DISTINCT ON (driver_id) status, selfie_url
        FROM photo_requests
        WHERE status != 'unblocked'
        ORDER BY driver_id, created_at DESC
      ) sub
    `);
    res.json({ stats: result.rows[0] || {} });
  } catch (err) {
    console.error("[PHOTO-CONTROL] stats error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/requests/:id/unblock", authMiddleware, requireRole("admin", "dispatcher"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [request] = await db.select().from(photoRequestsTable).where(eq(photoRequestsTable.id, id));
    if (!request) return res.status(404).json({ error: "not_found" });

    if (!["rejected_final", "rejected_auto", "rejected"].includes(request.status)) {
      return res.status(400).json({ error: "can_only_unblock_rejected_drivers" });
    }

    await db.transaction(async (tx) => {
      await tx.update(photoRequestsTable)
        .set({ retryCount: 0, status: "unblocked", rejectReason: null, updatedAt: new Date() })
        .where(eq(photoRequestsTable.id, id));

      const [existingPending] = await tx.select({ id: photoRequestsTable.id })
        .from(photoRequestsTable)
        .where(and(
          eq(photoRequestsTable.driverId, request.driverId),
          eq(photoRequestsTable.status, "pending"),
        ))
        .limit(1);

      if (!existingPending) {
        await tx.insert(photoRequestsTable).values({
          driverId: request.driverId,
          taskId: request.taskId,
          status: "pending",
          retryCount: 0,
          previousRequestId: id,
        });
      }
    });

    broadcastToUser(request.driverId, {
      type: "photo_control_required",
      message: "Вы разблокированы. Отправьте фото заново.",
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[PHOTO-CONTROL] unblock error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/request-driver/:driverId", authMiddleware, requireRole("admin", "dispatcher"), async (req: AuthRequest, res) => {
  try {
    const driverId = parseInt(req.params.driverId);
    if (isNaN(driverId)) return res.status(400).json({ error: "invalid_driver_id" });

    const [driver] = await db.select({ id: usersTable.id, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, driverId));
    if (!driver || driver.role !== "driver") {
      return res.status(404).json({ error: "driver_not_found" });
    }

    const [existing] = await db.select({ id: photoRequestsTable.id, status: photoRequestsTable.status })
      .from(photoRequestsTable)
      .where(and(
        eq(photoRequestsTable.driverId, driverId),
        inArray(photoRequestsTable.status, ["pending", "under_review"]),
      ))
      .limit(1);

    if (existing) {
      broadcastToUser(driverId, { type: "photo_control_required" });
      return res.json({ created: false, message: "У водителя уже есть активный запрос фотоконтроля", requestId: existing.id });
    }

    const [created] = await db.insert(photoRequestsTable).values({
      driverId,
      status: "pending",
      retryCount: 0,
    }).returning({ id: photoRequestsTable.id });

    broadcastToUser(driverId, { type: "photo_control_required" });

    res.json({ created: true, requestId: created.id });
  } catch (err) {
    console.error("[PHOTO-CONTROL] request-driver error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/request-driver/:driverId/status", authMiddleware, requireRole("admin", "dispatcher"), async (req, res) => {
  try {
    const driverId = parseInt(req.params.driverId);
    if (isNaN(driverId)) return res.status(400).json({ error: "invalid_driver_id" });

    const [active] = await db.select({
      id: photoRequestsTable.id,
      status: photoRequestsTable.status,
      createdAt: photoRequestsTable.createdAt,
    }).from(photoRequestsTable)
      .where(and(
        eq(photoRequestsTable.driverId, driverId),
        inArray(photoRequestsTable.status, ["pending", "under_review"]),
      ))
      .orderBy(desc(photoRequestsTable.createdAt))
      .limit(1);

    res.json(active ? { hasActive: true, requestId: active.id, status: active.status, createdAt: active.createdAt } : { hasActive: false });
  } catch (err) {
    console.error("[PHOTO-CONTROL] status error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/request-driver/:driverId", authMiddleware, requireRole("admin", "dispatcher"), async (req, res) => {
  try {
    const driverId = parseInt(req.params.driverId);
    if (isNaN(driverId)) return res.status(400).json({ error: "invalid_driver_id" });

    const cancelled = await db.delete(photoRequestsTable)
      .where(and(
        eq(photoRequestsTable.driverId, driverId),
        eq(photoRequestsTable.status, "pending"),
      ))
      .returning({ id: photoRequestsTable.id });

    if (cancelled.length === 0) {
      return res.status(404).json({ error: "no_pending_request" });
    }

    broadcastToUser(driverId, { type: "photo_control_cancelled" });

    res.json({ cancelled: cancelled.length });
  } catch (err) {
    console.error("[PHOTO-CONTROL] cancel error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
