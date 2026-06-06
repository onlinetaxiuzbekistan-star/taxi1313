import { Router, type IRouter } from "express";
import { clog } from "../../lib/logger.js";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { db, usersTable, ridesTable, orderOffersTable, transactionsTable, ridePassengersTable, marketplaceListingsTable, photoRequestsTable, driverAuditLogsTable, safeUserColumns } from "@workspace/db";
import { eq, and, ne, desc, sql, gte, lte, inArray, notInArray } from "drizzle-orm";
import { CITIES } from "../rides/index.js";
import { getOsrmRoute, haversineDistance } from "../../lib/osrm.js";
import { authMiddleware, requireRole, AuthRequest } from "../../middlewares/auth.js";
import { broadcastToAll, broadcastToUser } from "../../lib/websocket.js";
import { notifyOrderAccepted, notifyOrderTaken } from "../../lib/notifications.js";
import { applyCancelPenalty, resetConsecutiveIgnores, isDriverBanned, getBanRemainingMs, handleStatusToggle } from "../../lib/bonuses.js";
import { completeRide } from "../../lib/completion.js";
import { stopDispatchLoop, citiesMatch, enrichRideForOffer } from "../../lib/autodispatch.js";
import { getDriver, updateDriver, getDriverBalance } from "../../lib/services/drivers.service.js";
import { validateBody } from "../../middlewares/validate.js";
import { driverStatusBodySchema, driverLocationBodySchema } from "../../middlewares/request-schemas.js";
import { notifyRideStatusChange } from "../../lib/sms-notifications.js";
import { idempotencyKey, getIdempotentResult, storeIdempotentResult } from "../../lib/idempotency.js";
import { recordDriverAccept, recordDriverReject, recordRideCompleted } from "../../lib/revenue-ai-prod.js";
import { hashPassword } from "../auth.js";
import { generateReferralCode } from "../../lib/bonuses.js";
import { getSettingNum } from "../../lib/settingsCache.js";
import { parseBranchIdFromBody, checkMinBalance, PHOTOS_DIR, photoStorage, photoUpload, enrichPassengersWithRouteInfo, nearestNeighborPickup, totalRouteDistance, permutations, optimizePickupOrder } from "./shared.js";

const router: IRouter = Router();

// multipart upload — body validated post-multer in handler
router.post("/upload-my-photo", authMiddleware, requireRole("driver"), (req, res, next) => {
  photoUpload.single("photo")(req, res, (err: any) => {
    if (err) {
      req.log.error({ err }, "Multer upload error");
      res.status(400).json({ error: "upload_error", message: err.message || "Ошибка загрузки" });
      return;
    }
    next();
  });
}, async (req: AuthRequest, res) => {
  const file = (req as any).file;
  const filePath = file ? path.join(PHOTOS_DIR, file.filename) : null;
  try {
    if (!file || !filePath) {
      req.log.error("No file received in upload-my-photo");
      res.status(400).json({ error: "no_file", message: "Файл не получен" });
      return;
    }

    const type = req.body?.type;
    if (!type || !["driver", "car"].includes(type)) {
      try { fs.unlinkSync(filePath); } catch {}
      res.status(400).json({ error: "invalid_type", message: "type must be 'driver' or 'car'" });
      return;
    }

    const safeName = `drv_${req.userId}_${type}_${Date.now()}.jpg`;
    const safePath = path.join(PHOTOS_DIR, safeName);

    try {
      const sharp = (await import("sharp")).default;
      await sharp(filePath)
        .rotate()
        .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toFile(safePath);
      try { fs.unlinkSync(filePath); } catch {}
    } catch (sharpErr: any) {
      req.log.error({ err: sharpErr, filePath, mimetype: file.mimetype, originalname: file.originalname }, "Sharp processing error, saving raw file");
      try {
        fs.copyFileSync(filePath, safePath);
        fs.unlinkSync(filePath);
      } catch {
        res.status(500).json({ error: "process_error", message: "Ошибка обработки фото" });
        return;
      }
    }

    const url = `/api/uploads/photos/${safeName}`;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (type === "driver") updates.driverPhoto = url;
    else updates.carPhoto = url;

    await db.update(usersTable).set(updates).where(eq(usersTable.id, req.userId!));
    const [driver] = await db.select(safeUserColumns).from(usersTable).where(eq(usersTable.id, req.userId!));
    const safeDriver = driver;
    res.json({ url, user: safeDriver });
  } catch (err: any) {
    if (filePath) { try { fs.unlinkSync(filePath); } catch {} }
    req.log.error({ err, fileName: file?.originalname, mimetype: file?.mimetype }, "Driver self-upload photo error");
    res.status(500).json({ error: "server_error", message: "Ошибка сервера при загрузке фото" });
  }
});


// multipart upload — body validated post-multer in handler
router.post("/admin/upload-photo", authMiddleware, requireRole("dispatcher", "admin"), (req, res, next) => {
  photoUpload.single("photo")(req, res, (err: any) => {
    if (err) {
      res.status(400).json({ error: "upload_error", message: err.message || "Ошибка загрузки" });
      return;
    }
    next();
  });
}, async (req: AuthRequest, res) => {
  try {
    const file = (req as any).file;
    if (!file) { res.status(400).json({ error: "no_file", message: "Файл не предоставлен" }); return; }

    try {
      const sharp = (await import("sharp")).default;
      const filePath = path.join(PHOTOS_DIR, file.filename);
      const optimizedName = `opt_${file.filename.replace(/\.[^.]+$/, ".jpg")}`;
      const optimizedPath = path.join(PHOTOS_DIR, optimizedName);
      await sharp(filePath)
        .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toFile(optimizedPath);
      const stat = fs.statSync(optimizedPath);
      if (stat.size < file.size) {
        fs.unlinkSync(filePath);
        res.json({ url: `/api/uploads/photos/${optimizedName}` });
        return;
      } else {
        fs.unlinkSync(optimizedPath);
      }
    } catch (compErr) {
      req.log.warn({ err: compErr }, "Photo compression failed, using original");
    }

    const url = `/api/uploads/photos/${file.filename}`;
    res.json({ url });
  } catch (err) {
    req.log.error({ err }, "Upload photo error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


export default router;
