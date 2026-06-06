import { Router, type IRouter } from "express";
import { clog } from "../../lib/logger.js";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { db, usersTable, ridesTable, orderOffersTable, transactionsTable, ridePassengersTable, marketplaceListingsTable, photoRequestsTable, driverAuditLogsTable } from "@workspace/db";
import { eq, and, ne, desc, sql, gte, lte, inArray, notInArray } from "drizzle-orm";
import { CITIES } from "../rides.js";
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

router.post("/admin/create", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const {
      firstName, lastName, phone, password, city,
      carBrand, carModel, carYear, carNumber, carColor, carBodyType, carClass, seats,
      driverPhoto, carPhoto,
      hasAC, hasLuggage, isComfort, customOptions,
      balance, commissionRate,
    } = req.body;

    if (!firstName?.trim() || !lastName?.trim() || !phone?.trim()) {
      res.status(400).json({ error: "validation_error", message: "Имя, фамилия и телефон обязательны" });
      return;
    }
    const finalPassword = (password && password.length >= 6) ? password.trim() : Math.random().toString(36).slice(-8);

    const existing = await db.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.phone, phone), eq(usersTable.role, "driver"))).limit(1);
    if (existing.length > 0) {
      res.status(400).json({ error: "phone_taken", message: "Этот номер уже зарегистрирован" });
      return;
    }

    const name = `${firstName.trim()} ${lastName.trim()}`;
    const passwordHash = await hashPassword(finalPassword);

    const [driver] = await db.insert(usersTable).values({
      phone: phone.trim(),
      name,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      city: city?.trim() || null,
      passwordHash,
      role: "driver",
      branchId: parseBranchIdFromBody(req.body),
      status: "offline",
      carBrand: carBrand?.trim() || null,
      carModel: carModel?.trim() || null,
      carYear: carYear ? parseInt(carYear) : null,
      carNumber: carNumber?.trim() || null,
      carColor: carColor?.trim() || null,
      carBodyType: carBodyType || null,
      carClass: carClass || "economy",
      groupId: req.body.groupId ? parseInt(req.body.groupId) : null,
      seats: seats ? parseInt(seats) : 4,
      driverPhoto: driverPhoto || null,
      carPhoto: carPhoto || null,
      hasAC: hasAC || false,
      hasLuggage: hasLuggage || false,
      isComfort: isComfort || false,
      customOptions: customOptions || null,
      balance: balance ? String(balance) : "0.00",
      commissionRate: commissionRate ? parseFloat(commissionRate) : 10,
      referralCode: generateReferralCode(),
    }).returning();

    const { passwordHash: _, ...safe } = driver;
    broadcastToUser(driver.id, { type: "driver_update", driver: safe });
    await db.insert(driverAuditLogsTable).values({
      driverId: driver.id, actorId: req.userId!, action: "create",
      details: `Водитель создан: ${safe.name}`,
    }).catch(e => clog.warn("[AUDIT] insert failed:", e.message));
    res.status(201).json(safe);
  } catch (err) {
    req.log.error({ err }, "Admin create driver error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/admin/quick-create", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const { name, phone, carBrand, carModel, carNumber } = req.body;

    if (!name?.trim() || !phone?.trim()) {
      res.status(400).json({ error: "validation_error", message: "Имя и телефон обязательны" });
      return;
    }

    const digits = phone.replace(/\D/g, "");
    if (!/^998\d{9}$/.test(digits)) {
      res.status(400).json({ error: "validation_error", message: "Неверный формат телефона (+998 XX XXX XX XX)" });
      return;
    }
    const normalized = "+" + digits;

    const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, normalized)).limit(1);
    if (existing.length > 0) {
      res.status(400).json({ error: "phone_taken", message: "Этот номер уже зарегистрирован" });
      return;
    }

    const parts = name.trim().split(/\s+/);
    const firstName = parts[0] || "";
    const lastName = parts.slice(1).join(" ") || "";

    const { randomBytes } = await import("crypto");
    const randomPass = randomBytes(6).toString("base64url").slice(0, 10);
    const passwordHash = await hashPassword(randomPass);

    const [driver] = await db.insert(usersTable).values({
      phone: normalized,
      name: name.trim(),
      firstName,
      lastName,
      passwordHash,
      role: "driver",
      branchId: parseBranchIdFromBody(req.body),
      status: "offline",
      carBrand: carBrand?.trim() || null,
      carModel: carModel?.trim() || null,
      carNumber: carNumber?.trim() || null,
      carClass: "economy",
      seats: 4,
      balance: "0.00",
      commissionRate: 10,
      referralCode: generateReferralCode(),
    }).returning();

    const { passwordHash: _h, ...safe } = driver;
    broadcastToUser(driver.id, { type: "driver_update", driver: safe });
    res.status(201).json({ ...safe, generatedPassword: randomPass });
  } catch (err) {
    req.log.error({ err }, "Quick create driver error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.patch("/admin/:id", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) { res.status(400).json({ error: "invalid_id" }); return; }

    const [existing] = await db.select().from(usersTable)
      .where(and(eq(usersTable.id, driverId), eq(usersTable.role, "driver")));
    if (!existing) { res.status(404).json({ error: "not_found" }); return; }

    const {
      firstName, lastName, phone, city,
      carBrand, carModel, carYear, carNumber, carColor, carBodyType, carClass, seats,
      driverPhoto, carPhoto,
      hasAC, hasLuggage, isComfort, customOptions, cashCarrier,
      balance, commissionRate, password,
    } = req.body;

    const updates: Record<string, any> = { updatedAt: new Date() };

    if (firstName !== undefined && lastName !== undefined) {
      updates.firstName = firstName.trim();
      updates.lastName = lastName.trim();
      updates.name = `${firstName.trim()} ${lastName.trim()}`;
    } else if (firstName !== undefined) {
      updates.firstName = firstName.trim();
      updates.name = `${firstName.trim()} ${existing.lastName || ""}`.trim();
    } else if (lastName !== undefined) {
      updates.lastName = lastName.trim();
      updates.name = `${existing.firstName || ""} ${lastName.trim()}`.trim();
    }

    if (phone !== undefined) {
      const phoneTrimmed = phone.trim();
      if (phoneTrimmed !== existing.phone) {
        const [dup] = await db.select({ id: usersTable.id }).from(usersTable)
          .where(and(eq(usersTable.phone, phoneTrimmed), eq(usersTable.role, "driver"), ne(usersTable.id, driverId))).limit(1);
        if (dup) { res.status(400).json({ error: "phone_taken", message: "Этот номер уже используется" }); return; }
      }
      updates.phone = phoneTrimmed;
    }
    if (city !== undefined) updates.city = city?.trim() || null;
    if (carBrand !== undefined) updates.carBrand = carBrand?.trim() || null;
    if (carModel !== undefined) updates.carModel = carModel?.trim() || null;
    if (carYear !== undefined) updates.carYear = carYear ? parseInt(carYear) : null;
    if (carNumber !== undefined) updates.carNumber = carNumber?.trim() || null;
    if (carColor !== undefined) updates.carColor = carColor?.trim() || null;
    if (carBodyType !== undefined) updates.carBodyType = carBodyType || null;
    if (carClass !== undefined) updates.carClass = carClass || null;
    if (req.body.groupId !== undefined) updates.groupId = req.body.groupId ? parseInt(req.body.groupId) : null;
    if (seats !== undefined) updates.seats = seats ? parseInt(seats) : 4;
    if (driverPhoto !== undefined) updates.driverPhoto = driverPhoto || null;
    if (carPhoto !== undefined) updates.carPhoto = carPhoto || null;
    if (hasAC !== undefined) updates.hasAC = !!hasAC;
    if (hasLuggage !== undefined) updates.hasLuggage = !!hasLuggage;
    if (isComfort !== undefined) updates.isComfort = !!isComfort;
    if (customOptions !== undefined) updates.customOptions = customOptions || null;
    if (cashCarrier !== undefined) updates.cashCarrier = !!cashCarrier;
    if (balance !== undefined) {
      const bal = parseFloat(balance);
      if (!isFinite(bal)) { res.status(400).json({ error: "validation_error", message: "Некорректный баланс" }); return; }
      updates.balance = String(bal);
    }
    if (commissionRate !== undefined) {
      const cr = parseFloat(commissionRate);
      if (!isFinite(cr) || cr < 0 || cr > 100) { res.status(400).json({ error: "validation_error", message: "Комиссия должна быть 0-100%" }); return; }
      updates.commissionRate = cr;
    }
    if (password) {
      if (password.trim().length < 6) { res.status(400).json({ error: "validation_error", message: "Пароль мин. 6 символов" }); return; }
      updates.passwordHash = await hashPassword(password.trim());
    }

    await db.update(usersTable).set(updates).where(eq(usersTable.id, driverId));
    const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, driverId));
    const { passwordHash: _, ...safe } = updated;
    broadcastToUser(driverId, { type: "driver_update", driver: safe });

    const actorId = (req as AuthRequest).userId!;
    const auditFields: Array<{ field: string; old: any; new_: any }> = [];
    const trackFields = ["phone", "carBrand", "carModel", "carNumber", "carColor", "carClass", "carYear", "seats", "city", "firstName", "lastName", "balance", "commissionRate"];
    for (const f of trackFields) {
      if ((req.body as any)[f] !== undefined && String((existing as any)[f] || "") !== String((req.body as any)[f] || "")) {
        auditFields.push({ field: f, old: (existing as any)[f], new_: (req.body as any)[f] });
      }
    }
    if (password) auditFields.push({ field: "password", old: "***", new_: "***" });
    if (auditFields.length > 0) {
      const auditRows = auditFields.map(a => ({
        driverId, actorId, action: "edit" as string, field: a.field,
        oldValue: a.old != null ? String(a.old) : null, newValue: a.new_ != null ? String(a.new_) : null,
      }));
      await db.insert(driverAuditLogsTable).values(auditRows).catch(e => clog.warn("[AUDIT] insert failed:", e.message));
    }

    res.json(safe);
  } catch (err) {
    req.log.error({ err }, "Admin update driver error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.patch("/admin/:id/password", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) { res.status(400).json({ error: "invalid_id" }); return; }

    const { password } = req.body;
    if (!password || password.trim().length < 6) {
      res.status(400).json({ error: "validation_error", message: "Пароль обязателен (мин. 6 символов)" });
      return;
    }

    const [existing] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(eq(usersTable.id, driverId), eq(usersTable.role, "driver"))).limit(1);
    if (!existing) { res.status(404).json({ error: "not_found", message: "Водитель не найден" }); return; }

    const newHash = await hashPassword(password.trim());
    await db.update(usersTable).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(usersTable.id, driverId));

    clog.log("PASSWORD RESET: driver", driverId, "password updated by", (req as AuthRequest).userId);
    res.json({ success: true, message: "Пароль обновлён" });
  } catch (err) {
    req.log.error({ err }, "Password reset error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/admin/block/:id", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) { res.status(400).json({ error: "invalid_id" }); return; }
    const [driver] = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable)
      .where(and(eq(usersTable.id, driverId), eq(usersTable.role, "driver"))).limit(1);
    if (!driver) { res.status(404).json({ error: "not_found" }); return; }
    const hours = Math.min(Math.max(parseInt(req.body.hours) || 24, 1), 8760);
    const reason = req.body.reason || "Manual block";
    const bannedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
    await db.update(usersTable).set({ bannedUntil, updatedAt: new Date() }).where(eq(usersTable.id, driverId));
    await db.insert(driverAuditLogsTable).values({
      driverId, actorId: req.userId!, action: "block",
      details: `Заблокирован на ${hours}ч. Причина: ${reason}`,
    }).catch(e => req.log.warn({ err: e }, "Audit log insert failed"));
    broadcastToUser(driverId, { type: "driver_blocked", bannedUntil: bannedUntil.toISOString(), reason });
    res.json({ ok: true, bannedUntil });
  } catch (err) {
    req.log.error({ err }, "Block driver error");
    res.status(500).json({ error: "server_error" });
  }
});


router.post("/admin/unblock/:id", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) { res.status(400).json({ error: "invalid_id" }); return; }
    const [driver] = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable)
      .where(and(eq(usersTable.id, driverId), eq(usersTable.role, "driver"))).limit(1);
    if (!driver) { res.status(404).json({ error: "not_found" }); return; }
    await db.update(usersTable).set({ bannedUntil: null, updatedAt: new Date() }).where(eq(usersTable.id, driverId));
    await db.insert(driverAuditLogsTable).values({
      driverId, actorId: req.userId!, action: "unblock",
      details: "Разблокирован",
    }).catch(e => req.log.warn({ err: e }, "Audit log insert failed"));
    broadcastToUser(driverId, { type: "driver_unblocked" });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Unblock driver error");
    res.status(500).json({ error: "server_error" });
  }
});


router.get("/admin/:id/audit", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) { res.status(400).json({ error: "invalid_id" }); return; }
    const logs = await db.select({
      id: driverAuditLogsTable.id,
      action: driverAuditLogsTable.action,
      field: driverAuditLogsTable.field,
      oldValue: driverAuditLogsTable.oldValue,
      newValue: driverAuditLogsTable.newValue,
      details: driverAuditLogsTable.details,
      createdAt: driverAuditLogsTable.createdAt,
      actorId: driverAuditLogsTable.actorId,
      actorName: usersTable.name,
    }).from(driverAuditLogsTable)
      .leftJoin(usersTable, eq(driverAuditLogsTable.actorId, usersTable.id))
      .where(eq(driverAuditLogsTable.driverId, driverId))
      .orderBy(desc(driverAuditLogsTable.createdAt))
      .limit(100);
    res.json(logs);
  } catch (err) {
    req.log.error({ err }, "Get audit logs error");
    res.status(500).json({ error: "server_error" });
  }
});


router.delete("/admin/delete/:id", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) { res.status(400).json({ error: "invalid_id" }); return; }
    const driver = await getDriver(driverId);
    if (!driver) { res.status(404).json({ error: "not_found", message: "Водитель не найден" }); return; }
    if (driver.status === "busy") { res.status(400).json({ error: "driver_busy", message: "Нельзя удалить водителя в поездке" }); return; }
    await db.delete(driverAuditLogsTable).where(eq(driverAuditLogsTable.driverId, driverId));
    await db.delete(usersTable).where(eq(usersTable.id, driverId));
    broadcastToAll({ type: "driver_removed", driverId });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Delete driver error");
    res.status(500).json({ error: "server_error", message: "Ошибка удаления" });
  }
});


export default router;
