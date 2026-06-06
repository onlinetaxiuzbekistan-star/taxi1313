import { Router, type IRouter } from "express";
import { clog } from "../../lib/logger.js";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { db, usersTable, ridesTable, orderOffersTable, transactionsTable, ridePassengersTable, marketplaceListingsTable, photoRequestsTable, driverAuditLogsTable } from "@workspace/db";
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

router.get("/car-models", authMiddleware, requireRole("dispatcher", "admin"), async (_req: AuthRequest, res) => {
  try {
    const rows = await db
      .selectDistinct({ model: usersTable.carModel })
      .from(usersTable)
      .where(and(eq(usersTable.role, "driver"), sql`${usersTable.carModel} IS NOT NULL AND ${usersTable.carModel} <> ''`));
    const ALLOWED = ["Gentra", "Cobalt"];
    const present = new Set(rows.map(r => (r.model || "").trim()).filter(Boolean).map(m => m.toLowerCase()));
    const models = ALLOWED.filter(m => present.has(m.toLowerCase()));
    res.json(models);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "error" });
  }
});


router.patch("/profile", authMiddleware, requireRole("driver"), async (req: AuthRequest, res) => {
  try {
    const { name, carModel, carNumber, carColor } = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (name && typeof name === "string") updates.name = name.trim();
    if (carModel !== undefined) updates.carModel = carModel;
    if (carNumber !== undefined) updates.carNumber = carNumber;
    if (carColor !== undefined) updates.carColor = carColor;

    await db.update(usersTable).set(updates).where(eq(usersTable.id, req.userId!));
    const [driver] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
    const { passwordHash: _, ...safeDriver } = driver;
    res.json(safeDriver);
  } catch (err) {
    req.log.error({ err }, "Update driver profile error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.get("/my-rating-history", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;

    const completedRides = await db.select({
      id: ridesTable.id,
      fromCity: ridesTable.fromCity,
      toCity: ridesTable.toCity,
      price: ridesTable.price,
      driverRating: ridesTable.driverRating,
      riderName: ridesTable.riderName,
      passengers: ridesTable.passengers,
      createdAt: ridesTable.createdAt,
      status: ridesTable.status,
    }).from(ridesTable)
      .where(and(
        eq(ridesTable.driverId, driverId),
        eq(ridesTable.status, "completed"),
      ))
      .orderBy(desc(ridesTable.createdAt))
      .limit(100);

    const ratingTxns = await db.select({
      id: transactionsTable.id,
      type: transactionsTable.type,
      amount: transactionsTable.amount,
      description: transactionsTable.description,
      createdAt: transactionsTable.createdAt,
      rideId: transactionsTable.rideId,
    }).from(transactionsTable)
      .where(and(
        eq(transactionsTable.driverId, driverId),
        inArray(transactionsTable.type, ["bonus", "penalty"]),
      ))
      .orderBy(desc(transactionsTable.createdAt))
      .limit(100);

    const driver = await db.select({
      rating: usersTable.rating,
      totalRides: usersTable.totalRides,
      acceptedOrders: usersTable.acceptedOrders,
      cancelledOrders: usersTable.cancelledOrders,
      activityScore: usersTable.activityScore,
    }).from(usersTable).where(eq(usersTable.id, driverId)).limit(1);

    const rated = completedRides.filter(r => r.driverRating != null);
    const avgRating = rated.length > 0
      ? rated.reduce((sum, r) => sum + (r.driverRating || 0), 0) / rated.length
      : 5.0;

    const ratingBreakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } as Record<number, number>;
    for (const r of rated) {
      const star = Math.round(r.driverRating || 5);
      if (ratingBreakdown[star] !== undefined) ratingBreakdown[star]++;
    }

    const totalBonuses = ratingTxns.filter(t => t.type === "bonus").reduce((s, t) => s + Number(t.amount || 0), 0);
    const totalPenalties = ratingTxns.filter(t => t.type === "penalty").reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0);

    res.json({
      currentRating: driver[0]?.rating || 5.0,
      avgRating: Math.round(avgRating * 10) / 10,
      totalRated: rated.length,
      totalRides: driver[0]?.totalRides || 0,
      ratingBreakdown,
      totalBonuses,
      totalPenalties,
      recentRides: completedRides.slice(0, 30),
      recentTransactions: ratingTxns.slice(0, 30),
    });
  } catch (err) {
    req.log.error({ err }, "Get rating history error");
    res.status(500).json({ error: "server_error" });
  }
});


router.get("/my-activity-history", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;

    const offers = await db.select({
      id: orderOffersTable.id,
      rideId: orderOffersTable.rideId,
      status: orderOffersTable.status,
      offeredAt: orderOffersTable.offeredAt,
      respondedAt: orderOffersTable.respondedAt,
    }).from(orderOffersTable)
      .where(eq(orderOffersTable.driverId, driverId))
      .orderBy(desc(orderOffersTable.offeredAt))
      .limit(100);

    const offerRideIds = [...new Set(offers.map(o => o.rideId))];
    let offerRides: any[] = [];
    if (offerRideIds.length > 0) {
      offerRides = await db.select({
        id: ridesTable.id,
        fromCity: ridesTable.fromCity,
        toCity: ridesTable.toCity,
        price: ridesTable.price,
        passengers: ridesTable.passengers,
        status: ridesTable.status,
      }).from(ridesTable)
        .where(inArray(ridesTable.id, offerRideIds));
    }
    const rideMap = new Map(offerRides.map(r => [r.id, r]));

    const offersWithRides = offers.map(o => ({
      ...o,
      ride: rideMap.get(o.rideId) || null,
    }));

    const penaltyTxns = await db.select({
      id: transactionsTable.id,
      amount: transactionsTable.amount,
      description: transactionsTable.description,
      createdAt: transactionsTable.createdAt,
      rideId: transactionsTable.rideId,
      type: transactionsTable.type,
    }).from(transactionsTable)
      .where(and(
        eq(transactionsTable.driverId, driverId),
        eq(transactionsTable.type, "penalty"),
      ))
      .orderBy(desc(transactionsTable.createdAt))
      .limit(50);

    const driver = await db.select({
      activityScore: usersTable.activityScore,
      acceptedOrders: usersTable.acceptedOrders,
      cancelledOrders: usersTable.cancelledOrders,
      consecutiveIgnores: usersTable.consecutiveIgnores,
      bannedUntil: usersTable.bannedUntil,
      totalRides: usersTable.totalRides,
    }).from(usersTable).where(eq(usersTable.id, driverId)).limit(1);

    const accepted = offers.filter(o => o.status === "accepted").length;
    const rejected = offers.filter(o => o.status === "rejected").length;
    const expired = offers.filter(o => o.status === "expired").length;
    const total = offers.length;
    const acceptRate = total > 0 ? Math.round((accepted / total) * 100) : 0;

    res.json({
      activityScore: driver[0]?.activityScore || 0,
      acceptedOrders: driver[0]?.acceptedOrders || 0,
      cancelledOrders: driver[0]?.cancelledOrders || 0,
      consecutiveIgnores: driver[0]?.consecutiveIgnores || 0,
      bannedUntil: driver[0]?.bannedUntil || null,
      totalRides: driver[0]?.totalRides || 0,
      offerStats: { total, accepted, rejected, expired, acceptRate },
      recentOffers: offersWithRides.slice(0, 50),
      penalties: penaltyTxns,
    });
  } catch (err) {
    req.log.error({ err }, "Get activity history error");
    res.status(500).json({ error: "server_error" });
  }
});


router.get("/my-block-reason", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const user = await db.select({ bannedUntil: usersTable.bannedUntil }).from(usersTable).where(eq(usersTable.id, driverId)).then(r => r[0]);
    if (!user?.bannedUntil || new Date(user.bannedUntil) <= new Date()) {
      return res.json({ reason: null, bannedUntil: null });
    }
    const logs = await db.select().from(driverAuditLogsTable)
      .where(and(eq(driverAuditLogsTable.driverId, driverId), eq(driverAuditLogsTable.action, "block")))
      .orderBy(desc(driverAuditLogsTable.createdAt))
      .limit(1);
    let reason: string | null = null;
    if (logs[0]) {
      const details = logs[0].details || "";
      const match = details.match(/Причина:\s*(.+)/);
      reason = match ? match[1] : details || null;
    }
    res.json({ reason, bannedUntil: user.bannedUntil });
  } catch {
    res.json({ reason: null, bannedUntil: null });
  }
});


export default router;
