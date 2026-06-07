import { Router, type IRouter } from "express";
import { clog } from "../../lib/logger.js";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { db, usersTable, ridesTable, orderOffersTable, transactionsTable, ridePassengersTable, marketplaceListingsTable, photoRequestsTable, driverAuditLogsTable, safeUserColumns} from "@workspace/db";
import { eq, and, ne, desc, sql, gte, lte, inArray, notInArray } from "drizzle-orm";
import { CITIES } from "../rides/index.js";
import { getOsrmRoute, haversineDistance } from "../../lib/osrm.js";
import { authMiddleware, requireRole, AuthRequest } from "../../middlewares/auth.js";
import { broadcastToAll, broadcastToUser, enqueueDriverStatusBroadcast } from "../../lib/websocket.js";
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

router.patch("/status", authMiddleware, validateBody(driverStatusBodySchema), async (req: AuthRequest, res) => {
  try {
    const { status } = req.body;

    if (status === "online") {
      const [d] = await db.select({
        balance: usersTable.balance,
        bannedUntil: usersTable.bannedUntil,
      }).from(usersTable).where(eq(usersTable.id, req.userId!));

      if (isDriverBanned(d)) {
        const remainMin = Math.ceil(getBanRemainingMs(d) / 60000);
        res.status(403).json({
          error: "driver_banned",
          message: `Временная блокировка. Осталось ${remainMin} мин.`,
          bannedUntil: d.bannedUntil,
        });
        return;
      }

      const balance = parseFloat(d?.balance?.toString() || "0");
      const balErr = checkMinBalance(balance, "online");
      if (balErr) {
        res.status(403).json({ error: "insufficient_balance", message: balErr });
        return;
      }

      const [latestPhotoReq] = await db.select({
        id: photoRequestsTable.id,
        status: photoRequestsTable.status,
        rejectReason: photoRequestsTable.rejectReason,
        retryCount: photoRequestsTable.retryCount,
      })
        .from(photoRequestsTable)
        .where(eq(photoRequestsTable.driverId, req.userId!))
        .orderBy(desc(photoRequestsTable.createdAt))
        .limit(1);
      if (latestPhotoReq) {
        const st = latestPhotoReq.status;
        const retry = latestPhotoReq.retryCount || 0;
        const photoBlocked = st === "pending" || st === "rejected_final" || st === "rejected_auto" || (st === "rejected" && retry >= 2);
        if (photoBlocked) {
          res.status(403).json({
            error: "photo_required",
            message: st === "rejected_final"
              ? "Доступ временно ограничен до одобрения фотоконтроля"
              : st === "rejected_auto"
                ? `Фото отклонены автоматически: ${latestPhotoReq.rejectReason || "Загрузите фото заново"}`
                : st === "rejected"
                  ? `Фото отклонены: ${latestPhotoReq.rejectReason || "Загрузите фото заново"}`
                  : "Необходимо пройти фотоконтроль перед выходом на линию",
          });
          return;
        }
      }
    }

    const toggleResult = await handleStatusToggle(req.userId!, status);

    await db.update(usersTable).set({ status, updatedAt: new Date() }).where(eq(usersTable.id, req.userId!));
    const [driver] = await db.select(safeUserColumns).from(usersTable).where(eq(usersTable.id, req.userId!));
    const safeDriver = driver;
    // Coalesced into the driver_status_batch stream — under a mass-online
    // event (notification ping, dispatcher orders, etc.) this used to emit
    // one full-driver broadcast per driver to every connected client. The
    // batched message carries {driverId, status}; consumers that need full
    // driver objects refetch on the batch tick.
    enqueueDriverStatusBroadcast(req.userId!, status);

    const { enqueueDriver, removeFromQueue, getQueuePosition } = await import("../../lib/driver-queue.js");
    if (status === "online") {
      enqueueDriver(req.userId!);
    } else {
      removeFromQueue(req.userId!);
    }

    const response: any = { success: true, message: "Status updated" };
    if (status === "online") {
      response.queuePosition = getQueuePosition(req.userId!);
    }
    if (toggleResult.penalized) {
      response.warning = "Частые переключения статуса снижают ваш приоритет в очереди заказов";
    }
    res.json(response);
  } catch (err) {
    req.log.error({ err }, "Update driver status error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.patch("/location", authMiddleware, validateBody(driverLocationBodySchema), async (req: AuthRequest, res) => {
  try {
    const { lat, lng } = req.body;
    if (typeof lat !== "number" || typeof lng !== "number") {
      res.status(400).json({ error: "validation_error", message: "lat and lng are required numbers" });
      return;
    }
    await db.update(usersTable).set({
      lat, lng,
      lastLocationUpdate: new Date(),
      updatedAt: new Date(),
    }).where(eq(usersTable.id, req.userId!));
    const { updateDriverLocation } = await import("../../lib/driver-cache.js");
    updateDriverLocation(req.userId!, lat, lng);
    broadcastToAll({ type: "driver_location", driverId: req.userId, lat, lng });
    res.json({ success: true, message: "Location updated" });
  } catch (err) {
    req.log.error({ err }, "Update location error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.get("/ws-fallback", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const events: any[] = [];

    const pendingOffers = await db.select({
      id: orderOffersTable.id,
      rideId: orderOffersTable.rideId,
      expiresAt: orderOffersTable.expiresAt,
    }).from(orderOffersTable).where(
      and(
        eq(orderOffersTable.driverId, driverId),
        eq(orderOffersTable.status, "pending"),
      )
    );

    for (const offer of pendingOffers) {
      const now = Date.now();
      const expiresAt = offer.expiresAt ? new Date(offer.expiresAt).getTime() : 0;
      if (expiresAt > 0 && expiresAt <= now) continue;
      const [ride] = await db.select().from(ridesTable).where(
        and(eq(ridesTable.id, offer.rideId), inArray(ridesTable.status, ["pending", "offered"]))
      );
      if (!ride) continue;
      const remainingMs = expiresAt > 0 ? expiresAt - now : 30000;
      events.push({ type: "new_order", offerId: offer.id, ride, expiresIn: remainingMs });
    }

    const activeRides = await db.select().from(ridesTable).where(
      and(
        eq(ridesTable.driverId, driverId),
        inArray(ridesTable.status, ["accepted", "in_progress"]),
      )
    );
    if (activeRides.length > 0) {
      const ride = activeRides[0];
      const passengers = await db.select().from(ridePassengersTable)
        .where(eq(ridePassengersTable.rideId, ride.id))
        .orderBy(ridePassengersTable.seatNumber);
      events.push({ type: "route_updated", rideId: ride.id, passengers, ride });
    }

    res.json({ events, ts: Date.now() });
  } catch (err) {
    req.log.error({ err }, "WS fallback error");
    res.status(500).json({ error: "server_error", events: [] });
  }
});


router.get("/queue-info", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;

    const myRides = await db.select().from(ridesTable)
      .where(and(
        eq(ridesTable.driverId, driverId),
        eq(ridesTable.status, "accepted"),
      ))
      .orderBy(ridesTable.createdAt);

    if (myRides.length === 0) {
      res.json({ position: 0, total: 0, avgWaitMinutes: 0 });
      return;
    }

    const myRide = myRides.find(r => !r.riderPhone) || myRides[0];

    const myScheduledMs = new Date(myRide.scheduledAt).getTime();
    const TIME_WINDOW_MS = 2 * 60 * 60 * 1000;
    const windowStart = new Date(myScheduledMs - TIME_WINDOW_MS);
    const windowEnd = new Date(myScheduledMs + TIME_WINDOW_MS);

    const sameRouteRides = await db.select({
      id: ridesTable.id,
      driverId: ridesTable.driverId,
      createdAt: ridesTable.createdAt,
      passengers: ridesTable.passengers,
    }).from(ridesTable)
      .where(and(
        eq(ridesTable.fromCity, myRide.fromCity),
        eq(ridesTable.toCity, myRide.toCity),
        eq(ridesTable.status, "accepted"),
        gte(ridesTable.scheduledAt, windowStart),
        lte(ridesTable.scheduledAt, windowEnd),
      ))
      .orderBy(ridesTable.createdAt);

    const allRideIds = sameRouteRides.map(r => r.id);
    const allPassengers = allRideIds.length > 0
      ? await db.select().from(ridePassengersTable).where(inArray(ridePassengersTable.rideId, allRideIds))
      : [];

    const rideSystemCounts: Record<number, number> = {};
    const rideTotalCounts: Record<number, number> = {};
    for (const p of allPassengers) {
      rideTotalCounts[p.rideId] = (rideTotalCounts[p.rideId] || 0) + 1;
      if (p.source === "system") {
        rideSystemCounts[p.rideId] = (rideSystemCounts[p.rideId] || 0) + 1;
      }
    }

    interface QueueEntry { rideId: number; driverId: number | null; basePos: number; systemPax: number; totalPax: number; priority: number; }
    const queue: QueueEntry[] = sameRouteRides.map((r, i) => {
      const sysPax = rideSystemCounts[r.id] || 0;
      let priority = 0;
      if (sysPax >= 4) priority = 3;
      else if (sysPax >= 3) priority = 2;
      else if (sysPax >= 2) priority = 1;
      return { rideId: r.id, driverId: r.driverId, basePos: i + 1, systemPax: sysPax, totalPax: rideTotalCounts[r.id] || 0, priority };
    });

    queue.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.basePos - b.basePos;
    });

    const myIdx = queue.findIndex(q => q.driverId === driverId);
    const position = myIdx >= 0 ? myIdx + 1 : 1;
    const total = queue.length;
    const myEntry = myIdx >= 0 ? queue[myIdx] : null;
    const mySystemPax = myEntry?.systemPax || 0;
    const myTotalPax = myEntry?.totalPax || 0;
    const canStartNow = mySystemPax >= 4;

    const completedRecently = await db.select({ count: sql<number>`count(*)` }).from(ridesTable)
      .where(and(
        eq(ridesTable.fromCity, myRide.fromCity),
        eq(ridesTable.toCity, myRide.toCity),
        eq(ridesTable.status, "completed"),
        gte(ridesTable.updatedAt, sql`NOW() - INTERVAL '6 hours'`),
      ));

    const recentCount = Number(completedRecently[0]?.count || 0);
    const avgWaitMinutes = recentCount > 0
      ? Math.max(1, Math.round((position * 6 * 60) / (recentCount + total)))
      : Math.max(5, position * 4);

    const scheduledTime = new Date(myRide.scheduledAt).getTime();
    const rideDurationMs = (myRide.duration || 60) * 60 * 1000;
    const expiresAt = scheduledTime + rideDurationMs;
    const isExpired = Date.now() > expiresAt && myTotalPax < 4;

    let hint = "";
    if (total > 5 && position > 3) hint = "long_queue";
    else if (position === 1) hint = "first_in_queue";
    else if (position <= 3) hint = "almost_your_turn";

    res.json({
      position: Math.max(1, position),
      total: Math.max(1, total),
      avgWaitMinutes: Math.max(1, avgWaitMinutes),
      filledSeats: myTotalPax,
      systemSeats: mySystemPax,
      manualSeats: myTotalPax - mySystemPax,
      canStartNow,
      isExpired,
      expiresAt,
      hint,
      priorityBoost: myEntry?.priority || 0,
      fromCity: myRide.fromCity,
      toCity: myRide.toCity,
      rideId: myRide.id,
    });
  } catch (err) {
    req.log.error({ err }, "Queue info error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


export default router;
