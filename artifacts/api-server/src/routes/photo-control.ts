import { Router } from "express";
import { clog } from "../lib/logger.js";
import { authMiddleware, requireRole } from "../middlewares/auth.js";
import type { AuthRequest } from "../middlewares/auth.js";
import { broadcastToUser } from "../lib/websocket.js";
import { enqueuePhotoValidation } from "../lib/queues/photo.queue.js";
import * as photoService from "../lib/services/photo.service.js";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import { z } from "zod";
import { validateBody } from "../middlewares/validate.js";

const createTaskBodySchema = z.object({ name: z.string() }).passthrough();
const updateTaskBodySchema = z.object({}).passthrough();
const sendTaskBodySchema = z.object({}).passthrough();
const reviewRequestBodySchema = z.object({ status: z.string() }).passthrough();
const bulkReviewBodySchema = z.object({ ids: z.array(z.any()), status: z.string() }).passthrough();
const submitPendingBodySchema = z.object({
  selfieUrl: z.string(),
  carFrontUrl: z.string(),
  carBackUrl: z.string(),
  interiorUrl: z.string(),
}).passthrough();
const unblockBodySchema = z.object({}).passthrough();
const requestDriverBodySchema = z.object({}).passthrough();

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
    const tasks = await photoService.listTasks();
    const groups = await photoService.listDriverGroups();
    const groupMap = Object.fromEntries(groups.map(g => [g.id, g.label]));
    res.json({ tasks: tasks.map(t => ({ ...t, groupLabel: t.groupId ? groupMap[t.groupId] || null : null })) });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/tasks", authMiddleware, requireRole("admin", "dispatcher"), validateBody(createTaskBodySchema), async (req: AuthRequest, res) => {
  try {
    const { name, groupId, scheduleType, isActive } = req.body;
    if (!name) return res.status(400).json({ error: "name_required" });
    const task = await photoService.createTask({
      name,
      groupId: groupId ? parseInt(groupId) : null,
      scheduleType: scheduleType || "manual",
      isActive: isActive !== false,
    });
    res.json({ task });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.patch("/tasks/:id", authMiddleware, requireRole("admin", "dispatcher"), validateBody(updateTaskBodySchema), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "invalid_id" });
    const updates: any = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.groupId !== undefined) updates.groupId = req.body.groupId ? parseInt(req.body.groupId) : null;
    if (req.body.scheduleType !== undefined) updates.scheduleType = req.body.scheduleType;
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "no_updates" });
    const updated = await photoService.updateTask(id, updates);
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
    const deleted = await photoService.deleteTask(id);
    if (!deleted) return res.status(404).json({ error: "not_found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/tasks/:id/send", authMiddleware, requireRole("admin", "dispatcher"), validateBody(sendTaskBodySchema), async (req: AuthRequest, res) => {
  try {
    const taskId = parseInt(req.params.id);
    if (isNaN(taskId)) return res.status(400).json({ error: "invalid_id" });

    const task = await photoService.getTask(taskId);
    if (!task) return res.status(404).json({ error: "task_not_found" });

    let drivers;
    if (task.groupId) {
      drivers = await photoService.getDriverIdsByGroup(task.groupId);
    } else {
      drivers = await photoService.getAllDriverIds();
    }

    if (drivers.length === 0) return res.json({ created: 0 });

    const existingActive = await photoService.getActiveRequestDriverIds(drivers.map(d => d.id));
    const alreadyActive = new Set(existingActive.map(e => e.driverId));

    const toCreate = drivers.filter(d => !alreadyActive.has(d.id));
    if (toCreate.length === 0) return res.json({ created: 0, message: "Все водители уже имеют активные запросы" });

    await photoService.createPendingRequests(
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
      searchDriverIds = await photoService.getMatchingDriverIds({
        search: search as string | undefined,
        groupId: groupId as string | undefined,
        city: city as string | undefined,
      });
      if (searchDriverIds.length === 0) {
        return res.json({ requests: [], total: 0, page: pageNum, perPage });
      }
    }

    const total = await photoService.countLatestRequests({ statusFilter, taskIdFilter, searchDriverIds });

    const requests = await photoService.getLatestRequestsPage({
      statusFilter, taskIdFilter, searchDriverIds, perPage, offset,
    });

    const driverIds = [...new Set(requests.map(r => r.driver_id))];
    let driversMap: Record<number, any> = {};
    if (driverIds.length > 0) {
      const drivers = await photoService.getDriversByIds(driverIds);

      const groupIds = [...new Set(drivers.map(d => d.groupId).filter(Boolean))] as number[];
      let groupMap: Record<number, string> = {};
      if (groupIds.length > 0) {
        const groups = await photoService.getGroupsByIds(groupIds);
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
    clog.error("[PHOTO-CONTROL] /requests error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.patch("/requests/:id/review", authMiddleware, requireRole("admin", "dispatcher"), validateBody(reviewRequestBodySchema), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "invalid_id" });
    const { status, comment } = req.body;
    if (!status || !["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "invalid_status" });
    }

    const existing = await photoService.getRequest(id);
    if (!existing) return res.status(404).json({ error: "not_found" });
    if (existing.status === "approved" || existing.status === "rejected" || existing.status === "rejected_final" || existing.status === "rejected_auto") {
      return res.status(400).json({ error: "already_reviewed", message: "Запрос уже проверен" });
    }
    if (status === "approved" && !existing.selfieUrl) {
      return res.status(400).json({ error: "no_photos", message: "Фото ещё не загружены" });
    }

    if (status === "approved") {
      const updated = await photoService.approveRequest(id, comment || null, (req as AuthRequest).userId || null);

      const photoUpdates: any = {};
      if (existing.selfieUrl) photoUpdates.lastSelfieUrl = existing.selfieUrl;
      if (existing.carFrontUrl) photoUpdates.lastCarFrontUrl = existing.carFrontUrl;
      if (existing.carBackUrl) photoUpdates.lastCarBackUrl = existing.carBackUrl;
      if (existing.interiorUrl) photoUpdates.lastInteriorUrl = existing.interiorUrl;
      if (Object.keys(photoUpdates).length > 0) {
        await photoService.updateDriverLastPhotos(existing.driverId, photoUpdates);
      }
      broadcastToUser(existing.driverId, { type: "photo_control_approved" });
      return res.json({ request: updated });
    }

    const currentRetry = existing.retryCount || 0;
    const newRetryCount = currentRetry + 1;
    const isFinalReject = newRetryCount >= 2;
    const finalStatus = isFinalReject ? "rejected_final" : "rejected";

    const updated = await photoService.rejectRequest(id, finalStatus, comment || null, newRetryCount, (req as AuthRequest).userId || null);

    if (isFinalReject) {
      broadcastToUser(existing.driverId, {
        type: "photo_control_rejected",
        reason: comment || "Доступ временно ограничен до одобрения фотоконтроля",
        blocked: true,
        retryCount: newRetryCount,
      });
    } else {
      const newRequest = await photoService.createRetryRequest({
        driverId: existing.driverId,
        taskId: existing.taskId,
        status: "pending",
        retryCount: newRetryCount,
        rejectReason: comment || null,
        previousRequestId: existing.id,
      });

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

router.post("/requests/bulk-review", authMiddleware, requireRole("admin", "dispatcher"), validateBody(bulkReviewBodySchema), async (req: AuthRequest, res) => {
  try {
    const { ids, status, comment } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids_required" });
    if (!status || !["approved", "rejected"].includes(status)) return res.status(400).json({ error: "invalid_status" });

    const numIds = ids.map((id: any) => parseInt(id)).filter((n: number) => !isNaN(n));
    if (numIds.length === 0) return res.status(400).json({ error: "invalid_ids" });

    const existing = await photoService.getReviewableRequests(numIds);

    if (existing.length === 0) return res.json({ updated: 0 });

    for (const r of existing) {
      if (status === "approved") {
        await photoService.approveRequestById(r.id, comment || null, (req as AuthRequest).userId || null);

        const photoUpdates: any = {};
        if (r.selfieUrl) photoUpdates.lastSelfieUrl = r.selfieUrl;
        if (r.carFrontUrl) photoUpdates.lastCarFrontUrl = r.carFrontUrl;
        if (r.carBackUrl) photoUpdates.lastCarBackUrl = r.carBackUrl;
        if (r.interiorUrl) photoUpdates.lastInteriorUrl = r.interiorUrl;
        if (Object.keys(photoUpdates).length > 0) {
          await photoService.updateDriverLastPhotos(r.driverId, photoUpdates);
        }
        broadcastToUser(r.driverId, { type: "photo_control_approved" });
      }

      if (status === "rejected") {
        const currentRetry = r.retryCount || 0;
        const newRetryCount = currentRetry + 1;
        const isFinalReject = newRetryCount >= 2;

        await photoService.rejectRequestById(r.id, isFinalReject, comment || null, newRetryCount, (req as AuthRequest).userId || null);

        if (isFinalReject) {
          broadcastToUser(r.driverId, {
            type: "photo_control_rejected",
            reason: comment || "Доступ временно ограничен до одобрения фотоконтроля",
            blocked: true,
            retryCount: newRetryCount,
          });
        } else {
          await photoService.insertRetryRequest({
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

    const latest = await photoService.getLatestRequestForDriver(driverId);

    if (!latest) {
      return res.json({ request: null, blocked: false });
    }

    const blocked = isBlocked(latest.status, latest.retryCount || 0);
    res.json({ request: latest, blocked });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

// multipart upload — body validated post-multer in handler
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
      clog.warn("[PHOTO COMPRESS] Failed, using original:", (compErr as Error)?.message);
    }

    const url = `/api/uploads/photo-control/${file.filename}`;
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.patch("/my-pending/:id/submit", authMiddleware, validateBody(submitPendingBodySchema), async (req: AuthRequest, res) => {
  try {
    const driverId = (req as AuthRequest).userId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "invalid_id" });

    const { selfieUrl, carFrontUrl, carBackUrl, interiorUrl } = req.body;
    if (!selfieUrl || !carFrontUrl || !carBackUrl || !interiorUrl) {
      return res.status(400).json({ error: "all_photos_required", message: "Все 4 фото обязательны" });
    }

    const request = await photoService.getRequestForDriver(id, driverId!);
    if (!request) return res.status(404).json({ error: "not_found" });
    if (request.status !== "pending") return res.status(400).json({ error: "already_processed" });
    if (request.aiStatus === "processing") {
      return res.status(409).json({ error: "processing", message: "Фото уже на проверке" });
    }

    // Persist the submitted photos and mark AI-processing so the request can't be
    // re-submitted while the (CPU-heavy) validation runs off the request thread.
    await photoService.submitPhotos(id, { selfieUrl, carFrontUrl, carBackUrl, interiorUrl });

    await enqueuePhotoValidation({
      requestId: id,
      driverId: driverId!,
      taskId: request.taskId,
      selfieUrl, carFrontUrl, carBackUrl, interiorUrl,
      retryCount: request.retryCount || 0,
    });

    // 202: validation runs asynchronously; the driver is notified of the result
    // over WebSocket (photo_control_rejected / photo_control_under_review).
    res.status(202).json({ status: "processing", requestId: id, message: "Фото отправлены на проверку" });
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

    const history = await photoService.getDriverHistory(driverId, limit, excludeId);

    res.json({ history });
  } catch (err) {
    clog.error("[PHOTO-CONTROL] history error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/stats", authMiddleware, requireRole("admin", "dispatcher"), async (_req, res) => {
  try {
    const stats = await photoService.getStats();
    res.json({ stats });
  } catch (err) {
    clog.error("[PHOTO-CONTROL] stats error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/requests/:id/unblock", authMiddleware, requireRole("admin", "dispatcher"), validateBody(unblockBodySchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const request = await photoService.getRequest(id);
    if (!request) return res.status(404).json({ error: "not_found" });

    if (!["rejected_final", "rejected_auto", "rejected"].includes(request.status)) {
      return res.status(400).json({ error: "can_only_unblock_rejected_drivers" });
    }

    await photoService.unblockRequest(id, request.driverId, request.taskId);

    broadcastToUser(request.driverId, {
      type: "photo_control_required",
      message: "Вы разблокированы. Отправьте фото заново.",
    });

    res.json({ success: true });
  } catch (err) {
    clog.error("[PHOTO-CONTROL] unblock error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/request-driver/:driverId", authMiddleware, requireRole("admin", "dispatcher"), validateBody(requestDriverBodySchema), async (req: AuthRequest, res) => {
  try {
    const driverId = parseInt(req.params.driverId);
    if (isNaN(driverId)) return res.status(400).json({ error: "invalid_driver_id" });

    const driver = await photoService.getDriverRole(driverId);
    if (!driver || driver.role !== "driver") {
      return res.status(404).json({ error: "driver_not_found" });
    }

    const existing = await photoService.getActiveRequestForDriver(driverId);

    if (existing) {
      broadcastToUser(driverId, { type: "photo_control_required" });
      return res.json({ created: false, message: "У водителя уже есть активный запрос фотоконтроля", requestId: existing.id });
    }

    const created = await photoService.createRequestForDriver({
      driverId,
      status: "pending",
      retryCount: 0,
    });

    broadcastToUser(driverId, { type: "photo_control_required" });

    res.json({ created: true, requestId: created.id });
  } catch (err) {
    clog.error("[PHOTO-CONTROL] request-driver error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/request-driver/:driverId/status", authMiddleware, requireRole("admin", "dispatcher"), async (req, res) => {
  try {
    const driverId = parseInt(req.params.driverId);
    if (isNaN(driverId)) return res.status(400).json({ error: "invalid_driver_id" });

    const active = await photoService.getLatestActiveRequestForDriver(driverId);

    res.json(active ? { hasActive: true, requestId: active.id, status: active.status, createdAt: active.createdAt } : { hasActive: false });
  } catch (err) {
    clog.error("[PHOTO-CONTROL] status error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/request-driver/:driverId", authMiddleware, requireRole("admin", "dispatcher"), async (req, res) => {
  try {
    const driverId = parseInt(req.params.driverId);
    if (isNaN(driverId)) return res.status(400).json({ error: "invalid_driver_id" });

    const cancelled = await photoService.cancelPendingRequests(driverId);

    if (cancelled.length === 0) {
      return res.status(404).json({ error: "no_pending_request" });
    }

    broadcastToUser(driverId, { type: "photo_control_cancelled" });

    res.json({ cancelled: cancelled.length });
  } catch (err) {
    clog.error("[PHOTO-CONTROL] cancel error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
