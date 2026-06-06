// @ts-nocheck
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
import { z } from "zod";

const passengerActionBodySchema = z.object({}).passthrough();

const rejectClientBodySchema = z.object({
  orderId: z.union([z.number(), z.string()]),
  clientId: z.union([z.number(), z.string()]),
}).passthrough();

const manualClientBodySchema = z.object({
  orderId: z.union([z.number(), z.string()]),
}).passthrough();

const router: IRouter = Router();

router.get("/trip-stops", authMiddleware, requireRole("driver"), async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;

    const rides = await db.select().from(ridesTable)
      .where(and(
        eq(ridesTable.driverId, driverId),
        inArray(ridesTable.status, ["accepted", "in_progress"]),
      ))
      .orderBy(ridesTable.createdAt);

    if (rides.length === 0) {
      res.json({ stops: [], nextStop: null, tripStatus: "no_trip" });
      return;
    }

    // Pick the same ride as /my-active-ride: most passengers > driver-route > oldest
    const paxCounts = await Promise.all(rides.map(async (r) => {
      const rows = await db.select({ cnt: sql<number>`count(*)` })
        .from(ridePassengersTable).where(eq(ridePassengersTable.rideId, r.id));
      return { ride: r, paxCount: Number(rows[0]?.cnt || 0) };
    }));
    paxCounts.sort((a, b) => {
      if (b.paxCount !== a.paxCount) return b.paxCount - a.paxCount;
      const aIsRoute = a.ride.riderPhone === null || a.ride.riderPhone === undefined ? 1 : 0;
      const bIsRoute = b.ride.riderPhone === null || b.ride.riderPhone === undefined ? 1 : 0;
      if (aIsRoute !== bIsRoute) return bIsRoute - aIsRoute;
      return new Date(a.ride.createdAt || 0).getTime() - new Date(b.ride.createdAt || 0).getTime();
    });
    const tripRide = paxCounts[0].ride;

    const passengers = await db.select().from(ridePassengersTable)
      .where(eq(ridePassengersTable.rideId, tripRide.id))
      .orderBy(ridePassengersTable.seatNumber);

    const allDroppedOff = passengers.length > 0 && passengers.every(p => p.status === "dropped_off");
    if (allDroppedOff) {
      clog.log(`[ROUTE] skipped - no active passengers, all ${passengers.length} dropped off for ride ${tripRide.id}`);
      res.json({
        stops: [],
        nextStop: null,
        tripStatus: "all_dropped_off",
        rideId: tripRide.id,
        passengers: passengers.map(p => ({
          id: p.id, name: p.name, phone: p.phone, seatNumber: p.seatNumber,
          status: p.status, pickupAddress: p.pickupAddress, dropoffAddress: p.dropoffAddress,
          price: p.price, baggageType: p.baggageType, gender: p.gender, source: p.source,
        })),
      });
      return;
    }

    const activePassengers = passengers.filter(p => p.status !== "dropped_off");
    if (activePassengers.length === 0 && passengers.length === 0) {
      clog.log(`[ROUTE] skipped - no passengers at all for ride ${tripRide.id}`);
      res.json({ stops: [], nextStop: null, tripStatus: tripRide.status, rideId: tripRide.id, passengers: [] });
      return;
    }

    const driverLat = parseFloat(req.query.lat as string) || tripRide.fromLat || 0;
    const driverLng = parseFloat(req.query.lng as string) || tripRide.fromLng || 0;

    const stops: Array<{
      id: number;
      passengerId: number;
      type: "pickup" | "dropoff";
      name: string;
      phone?: string | null;
      address?: string | null;
      lat: number;
      lng: number;
      seatNumber: number;
      passengerStatus: string;
      order: number;
    }> = [];

    for (const p of passengers) {
      if (p.status === "waiting" && p.pickupLat && p.pickupLng) {
        stops.push({
          id: p.id,
          passengerId: p.id,
          type: "pickup",
          name: p.name,
          phone: p.phone,
          address: p.pickupAddress,
          lat: p.pickupLat,
          lng: p.pickupLng,
          seatNumber: p.seatNumber,
          passengerStatus: p.status,
          order: 0,
        });
      }
      if (p.status === "picked_up") {
        const dLat = p.dropoffLat || tripRide.toLat;
        const dLng = p.dropoffLng || tripRide.toLng;
        if (dLat && dLng) {
          stops.push({
            id: p.id,
            passengerId: p.id,
            type: "dropoff",
            name: p.name,
            phone: p.phone,
            address: p.dropoffAddress,
            lat: dLat,
            lng: dLng,
            seatNumber: p.seatNumber,
            passengerStatus: p.status,
            order: 0,
          });
        }
      }
    }

    let current = { lat: driverLat, lng: driverLng };
    const ordered: typeof stops = [];
    const remaining = [...stops];

    while (remaining.length > 0) {
      const pickupsNeeded = new Set(
        remaining.filter(s => s.type === "pickup").map(s => s.passengerId)
      );

      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const s = remaining[i];
        if (s.type === "dropoff" && pickupsNeeded.has(s.passengerId) &&
            remaining.find(r => r.passengerId === s.passengerId && r.type === "pickup")) {
          continue;
        }
        const dist = haversineDistance(current.lat, current.lng, s.lat, s.lng);

        let priority = dist;
        if (s.type === "dropoff" && s.passengerStatus === "picked_up") {
          priority *= 0.7;
        }

        if (priority < bestDist) {
          bestDist = priority;
          bestIdx = i;
        }
      }

      const next = remaining.splice(bestIdx, 1)[0];
      next.order = ordered.length + 1;
      ordered.push(next);
      current = { lat: next.lat, lng: next.lng };
    }

    const nextStop = ordered.length > 0 ? ordered[0] : null;

    res.json({
      stops: ordered,
      nextStop,
      tripStatus: tripRide.status,
      rideId: tripRide.id,
      passengers: passengers.map(p => ({
        id: p.id,
        name: p.name,
        phone: p.phone,
        seatNumber: p.seatNumber,
        status: p.status,
        pickupAddress: p.pickupAddress,
        dropoffAddress: p.dropoffAddress,
        price: p.price,
        baggageType: p.baggageType,
        gender: p.gender,
        source: p.source,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Trip stops error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/passenger/:passengerId/reject", authMiddleware, validateBody(passengerActionBodySchema), async (req: AuthRequest, res) => {
  try {
    const passengerId = parseInt(req.params.passengerId);
    const driverId = req.userId!;
    if (isNaN(passengerId)) { res.status(400).json({ error: "invalid_passenger_id" }); return; }

    const [passenger] = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.id, passengerId));
    if (!passenger) { res.status(404).json({ error: "not_found", message: "Пассажир не найден" }); return; }

    const PERSONAL_SOURCES = new Set(["manual", "driver"]);
    if (!PERSONAL_SOURCES.has(passenger.source as string)) {
      res.status(403).json({ error: "not_personal", message: "Этого клиента может снять только диспетчер" });
      return;
    }

    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, passenger.rideId));
    if (!ride || ride.driverId !== driverId) {
      res.status(403).json({ error: "not_your_ride", message: "Это не ваш рейс" });
      return;
    }

    // Если в рейсе есть хотя бы один внешний пассажир (диспетчер/маркет) — запрещаем снимать любого, в т.ч. manual
    const ridePaxAll = await db.select({ source: ridePassengersTable.source })
      .from(ridePassengersTable).where(eq(ridePassengersTable.rideId, ride.id));
    const hasExternal = ridePaxAll.some(p => !PERSONAL_SOURCES.has(p.source as string));
    if (hasExternal) {
      res.status(403).json({
        error: "external_passengers_present",
        message: "Нельзя снять клиента — в рейсе есть заказы от диспетчера или маркета. Обратитесь к диспетчеру.",
      });
      return;
    }
    if (passenger.status !== "waiting") {
      res.status(400).json({ error: "invalid_status", message: "Можно снять только пока пассажир ждёт" });
      return;
    }

    await db.delete(ridePassengersTable).where(eq(ridePassengersTable.id, passengerId));

    const remaining = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, passenger.rideId));
    await db.update(ridesTable).set({
      passengers: Math.max(1, remaining.length),
      price: remaining.reduce((s, p) => s + (p.price || 0), 0) || 0,
      version: sql`COALESCE(${ridesTable.version}, 0) + 1`,
      updatedAt: new Date(),
    }).where(eq(ridesTable.id, passenger.rideId));

    broadcastToAll({ type: "ride_passenger_removed", rideId: passenger.rideId, passengerId });
    req.log.info({ driverId, passengerId, rideId: passenger.rideId }, "Driver rejected personal passenger");

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Driver reject passenger error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/passenger/:passengerId/pickup", authMiddleware, requireRole("driver"), validateBody(passengerActionBodySchema), async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const rawActionId = req.headers["x-action-id"] as string | undefined;
    const passengerId = parseInt(req.params.passengerId);
    if (isNaN(passengerId)) {
      res.status(400).json({ error: "validation_error", message: "Invalid passengerId" });
      return;
    }

    const ikey = rawActionId ? idempotencyKey(driverId, `pickup:${passengerId}`, rawActionId) : null;
    if (ikey) {
      const cached = await getIdempotentResult(ikey);
      if (cached) { res.status(cached.status).json({ ...cached.body, _rideVersion: cached.rideVersion, _replayed: true }); return; }
    }

    const [passenger] = await db.select().from(ridePassengersTable)
      .where(eq(ridePassengersTable.id, passengerId));

    if (!passenger) {
      res.status(404).json({ error: "not_found", message: "Пассажир не найден" });
      return;
    }

    const [ride] = await db.select().from(ridesTable)
      .where(eq(ridesTable.id, passenger.rideId));

    if (!ride || ride.driverId !== driverId) {
      res.status(403).json({ error: "forbidden", message: "Это не ваш рейс" });
      return;
    }

    const rideUpdateSet: Record<string, any> = {
      version: sql`COALESCE(${ridesTable.version}, 0) + 1`,
      updatedAt: new Date(),
    };
    // Switch to "in_progress" only when this pickup makes ALL passengers picked up
    // (i.e. last waiting passenger is this one). Until then keep status="accepted"
    // so the UI shows "Собирает клиентов" instead of "В пути".
    if (ride.status === "accepted") {
      const stillWaiting = await db.select({ id: ridePassengersTable.id })
        .from(ridePassengersTable)
        .where(and(
          eq(ridePassengersTable.rideId, ride.id),
          eq(ridePassengersTable.status, "waiting"),
          ne(ridePassengersTable.id, passengerId),
        ));
      if (stillWaiting.length === 0) {
        rideUpdateSet.status = "in_progress";
      }
    }

    const txResult = await db.transaction(async (tx) => {
      const updated = await tx.update(ridePassengersTable)
        .set({ status: "picked_up" })
        .where(and(eq(ridePassengersTable.id, passengerId), eq(ridePassengersTable.status, "waiting")))
        .returning();

      if (updated.length === 0) {
        return { error: "conflict" as const };
      }

      const [updatedRide] = await tx.update(ridesTable).set(rideUpdateSet)
        .where(and(eq(ridesTable.id, ride.id), eq(ridesTable.version, ride.version ?? 0)))
        .returning();

      if (!updatedRide) {
        tx.rollback();
        return { error: "version_conflict" as const };
      }

      return { updatedRide };
    });

    if ("error" in txResult) {
      if (txResult.error === "version_conflict") {
        res.status(409).json({ error: "version_conflict", message: "Данные изменились, обновите" });
      } else {
        res.status(409).json({ error: "conflict", message: "Пассажир уже подобран или высажен" });
      }
      return;
    }

    const { updatedRide } = txResult;

    const updatedPassengers = await db.select().from(ridePassengersTable)
      .where(eq(ridePassengersTable.rideId, ride.id));

    broadcastToUser(driverId, {
      type: "route_updated",
      rideId: ride.id,
      version: updatedRide.version,
      action: "passenger_picked_up",
      passengerId,
      passengerName: passenger.name,
      passengers: updatedPassengers,
    });
    broadcastToAll({ type: "ride_updated", ride: updatedRide });

    const responseBody = {
      success: true,
      message: `${passenger.name} подобран`,
      passenger: { ...passenger, status: "picked_up" },
    };
    if (ikey) await storeIdempotentResult(ikey, driverId, `pickup:${passengerId}`, 200, responseBody, updatedRide.version);
    res.json(responseBody);
  } catch (err) {
    req.log.error({ err }, "Passenger pickup error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/passenger/:passengerId/dropoff", authMiddleware, requireRole("driver"), validateBody(passengerActionBodySchema), async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const rawActionId = req.headers["x-action-id"] as string | undefined;
    const passengerId = parseInt(req.params.passengerId);
    if (isNaN(passengerId)) {
      res.status(400).json({ error: "validation_error", message: "Invalid passengerId" });
      return;
    }

    const ikey = rawActionId ? idempotencyKey(driverId, `dropoff:${passengerId}`, rawActionId) : null;
    if (ikey) {
      const cached = await getIdempotentResult(ikey);
      if (cached) { res.status(cached.status).json({ ...cached.body, _rideVersion: cached.rideVersion, _replayed: true }); return; }
    }

    const [passenger] = await db.select().from(ridePassengersTable)
      .where(eq(ridePassengersTable.id, passengerId));

    if (!passenger) {
      res.status(404).json({ error: "not_found", message: "Пассажир не найден" });
      return;
    }

    const [ride] = await db.select().from(ridesTable)
      .where(eq(ridesTable.id, passenger.rideId));

    if (!ride || ride.driverId !== driverId) {
      res.status(403).json({ error: "forbidden", message: "Это не ваш рейс" });
      return;
    }

    const txResult = await db.transaction(async (tx) => {
      const updated = await tx.update(ridePassengersTable)
        .set({ status: "dropped_off" })
        .where(and(eq(ridePassengersTable.id, passengerId), eq(ridePassengersTable.status, "picked_up")))
        .returning();

      if (updated.length === 0) {
        return { error: "conflict" as const };
      }

      const [updatedRide] = await tx.update(ridesTable).set({ version: sql`COALESCE(${ridesTable.version}, 0) + 1`, updatedAt: new Date() })
        .where(and(eq(ridesTable.id, ride.id), eq(ridesTable.version, ride.version ?? 0)))
        .returning();

      if (!updatedRide) {
        tx.rollback();
        return { error: "version_conflict" as const };
      }

      return { updatedRide };
    });

    if ("error" in txResult) {
      if (txResult.error === "version_conflict") {
        res.status(409).json({ error: "version_conflict", message: "Данные изменились, обновите" });
      } else {
        res.status(409).json({ error: "conflict", message: "Сначала нужно подобрать пассажира" });
      }
      return;
    }

    const updatedPassengers = await db.select().from(ridePassengersTable)
      .where(eq(ridePassengersTable.rideId, ride.id));

    const allDroppedOff = updatedPassengers.every(p => p.status === "dropped_off");

    broadcastToUser(driverId, {
      type: "route_updated",
      rideId: ride.id,
      version: txResult.updatedRide.version,
      action: "passenger_dropped_off",
      passengerId,
      passengerName: passenger.name,
      allDroppedOff,
      passengers: updatedPassengers,
    });

    if (allDroppedOff && updatedPassengers.length > 0) {
      clog.log(`[TRIP] auto-completing rideId=${ride.id}, all ${updatedPassengers.length} passengers dropped off`);

      const completionResult = await completeRide(ride.id);
      if (completionResult.success) {
        const linkedClientRides = await db.select().from(ridesTable)
          .where(and(
            eq(ridesTable.tripId, ride.id),
            inArray(ridesTable.status, ["pending", "offered", "accepted", "in_progress"]),
          ));
        for (const cr of linkedClientRides) {
          await db.update(ridesTable).set({ status: "completed", updatedAt: new Date() })
            .where(eq(ridesTable.id, cr.id));
          clog.log(`[TRIP] auto-completed linked client ride ${cr.id}`);
        }

        const [completedRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, ride.id));
        broadcastToAll({ type: "ride_updated", ride: completedRide });
        broadcastToAll({ type: "trip_completed", rideId: ride.id, driverId, version: completedRide?.version });
        broadcastToAll({ type: "driver_status", driverId, status: "online" });

        try {
          const autoCompRideIds = [ride.id, ...linkedClientRides.map(cr => cr.id)];
          for (const crid of autoCompRideIds) {
            const [mpL] = await db.select()
              .from(marketplaceListingsTable)
              .where(and(
                eq(marketplaceListingsTable.rideId, crid),
                inArray(marketplaceListingsTable.status, ["in_progress", "sold"]),
              ));
            if (mpL) {
              await db.update(marketplaceListingsTable).set({
                status: "completed",
                updatedAt: new Date(),
              }).where(eq(marketplaceListingsTable.id, mpL.id));
              broadcastToUser(mpL.sellerId, {
                type: "marketplace_order_completed",
                listingId: mpL.id,
                rideId: crid,
                earnings: mpL.price,
                buyerId: mpL.buyerId,
              });
              clog.log(`[MARKETPLACE] auto-complete listing ${mpL.id} → completed, seller=${mpL.sellerId}`);
            }
          }
        } catch (mpErr) { clog.error("[MARKETPLACE] auto-complete listing update failed:", mpErr); }

        try {
          const { returnToQueue: rtq } = await import("../../lib/driver-queue.js");
          const { getCachedDriver: gcd } = await import("../../lib/driver-cache.js");
          const cd2 = gcd(driverId);
          if (cd2 && cd2.status === "online" && cd2.balance >= getSettingNum("min_driver_balance", 0)) rtq(driverId);
        } catch (e) { clog.error("[QUEUE] auto-complete returnToQueue failed", e); }
        clog.log(`[TRIP] auto-completed rideId=${ride.id}, driverId=${driverId}, linked=${linkedClientRides.length}`);

        const autoBody = {
          success: true,
          message: `${passenger.name} высажен. Рейс завершён!`,
          passenger: { ...passenger, status: "dropped_off" },
          allDroppedOff: true,
          autoCompleted: true,
        };
        const [finalRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, ride.id));
        if (ikey) await storeIdempotentResult(ikey, driverId, `dropoff:${passengerId}`, 200, autoBody, finalRide?.version);
        res.json(autoBody);
        return;
      } else {
        clog.log(`[TRIP] auto-complete failed for rideId=${ride.id}: ${completionResult.error}`);
      }
    }

    const [refreshedRide] = await db.select().from(ridesTable)
      .where(eq(ridesTable.id, ride.id));
    broadcastToAll({ type: "ride_updated", ride: refreshedRide });

    const dropBody = {
      success: true,
      message: `${passenger.name} высажен`,
      passenger: { ...passenger, status: "dropped_off" },
      allDroppedOff,
    };
    if (ikey) await storeIdempotentResult(ikey, driverId, `dropoff:${passengerId}`, 200, dropBody, refreshedRide?.version);
    res.json(dropBody);
  } catch (err) {
    req.log.error({ err }, "Passenger dropoff error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.get("/pickup-route", authMiddleware, requireRole("driver"), async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const driverLat = parseFloat(req.query.lat as string);
    const driverLng = parseFloat(req.query.lng as string);

    if (isNaN(driverLat) || isNaN(driverLng)) {
      res.status(400).json({ error: "validation_error", message: "Driver lat/lng required" });
      return;
    }

    const rides = await db.select().from(ridesTable)
      .where(and(
        eq(ridesTable.driverId, driverId),
        inArray(ridesTable.status, ["accepted", "in_progress"]),
      ))
      .orderBy(ridesTable.createdAt);

    if (rides.length === 0) {
      res.json({ stops: [], geometry: null, totalDistance: 0, totalDuration: 0 });
      return;
    }

    // Pick the same ride as /my-active-ride: most passengers > driver-route > oldest
    const paxCounts = await Promise.all(rides.map(async (r) => {
      const rows = await db.select({ cnt: sql<number>`count(*)` })
        .from(ridePassengersTable).where(eq(ridePassengersTable.rideId, r.id));
      return { ride: r, paxCount: Number(rows[0]?.cnt || 0) };
    }));
    paxCounts.sort((a, b) => {
      if (b.paxCount !== a.paxCount) return b.paxCount - a.paxCount;
      const aIsRoute = a.ride.riderPhone === null || a.ride.riderPhone === undefined ? 1 : 0;
      const bIsRoute = b.ride.riderPhone === null || b.ride.riderPhone === undefined ? 1 : 0;
      if (aIsRoute !== bIsRoute) return bIsRoute - aIsRoute;
      return new Date(a.ride.createdAt || 0).getTime() - new Date(b.ride.createdAt || 0).getTime();
    });
    const ride = paxCounts[0].ride;

    const passengers = await db.select().from(ridePassengersTable)
      .where(eq(ridePassengersTable.rideId, ride.id))
      .orderBy(ridePassengersTable.seatNumber);

    const activePassengers = passengers.filter(p => p.status !== "dropped_off");
    const passengersWithCoords = activePassengers.filter(p => p.pickupLat != null && p.pickupLng != null);

    if (passengersWithCoords.length === 0) {
      if (activePassengers.length === 0 && passengers.length > 0) {
        clog.log(`[ROUTE] pickup-route skipped - all ${passengers.length} passengers dropped off for ride ${ride.id}`);
      }
      res.json({ stops: [], geometry: null, totalDistance: 0, totalDuration: 0 });
      return;
    }

    let sorted: typeof passengersWithCoords;
    if (passengersWithCoords.length <= 6) {
      sorted = optimizePickupOrder(passengersWithCoords, driverLat, driverLng, ride.toLat, ride.toLng);
    } else {
      sorted = nearestNeighborPickup(passengersWithCoords, driverLat, driverLng, ride.toLat, ride.toLng);
    }

    clog.log("[ROUTE OPTIMIZE] pickup-route:", {
      rideId: ride.id,
      driverPos: { lat: driverLat, lng: driverLng },
      passengers: passengersWithCoords.map(p => ({ id: p.id, name: p.name, lat: p.pickupLat, lng: p.pickupLng })),
      sortedOrder: sorted.map((p, i) => ({ order: i + 1, id: p.id, name: p.name, lat: p.pickupLat, lng: p.pickupLng })),
      method: passengersWithCoords.length <= 6 ? "brute_force" : "nearest_neighbor",
    });

    const waypoints: { lat: number; lng: number }[] = [
      { lat: driverLat, lng: driverLng },
      ...sorted.map(p => ({ lat: p.pickupLat!, lng: p.pickupLng! })),
    ];

    if (ride.toLat != null && ride.toLng != null) {
      waypoints.push({ lat: ride.toLat, lng: ride.toLng });
    }

    const stops = sorted.map((p, i) => ({
      order: i + 1,
      passengerId: p.id,
      seatNumber: p.seatNumber,
      name: p.name,
      phone: p.phone,
      pickupAddress: p.pickupAddress,
      lat: p.pickupLat!,
      lng: p.pickupLng!,
    }));

    const routeTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
    const osrmRoute = await Promise.race([getOsrmRoute(waypoints), routeTimeout]);

    const routeInfo = {
      fromCity: ride.fromCity,
      toCity: ride.toCity,
      fromDistrictName: ride.fromDistrictName || null,
      toDistrictName: ride.toDistrictName || null,
    };

    let totalDist = 0;
    if (osrmRoute) {
      res.json({
        stops,
        geometry: osrmRoute.geometry,
        totalDistance: osrmRoute.distance,
        totalDuration: osrmRoute.duration,
        ...routeInfo,
      });
    } else {
      for (let i = 0; i < waypoints.length - 1; i++) {
        totalDist += haversineDistance(waypoints[i].lat, waypoints[i].lng, waypoints[i + 1].lat, waypoints[i + 1].lng);
      }
      res.json({
        stops,
        geometry: null,
        totalDistance: totalDist,
        totalDuration: Math.round((totalDist / 60) * 60),
        ...routeInfo,
      });
    }
  } catch (err) {
    req.log.error({ err }, "Pickup route error");
    res.json({ stops: [], geometry: null, totalDistance: 0, totalDuration: 0 });
  }
});


router.post("/reject-client", authMiddleware, requireRole("driver"), validateBody(rejectClientBodySchema), async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const { orderId, clientId, reason } = req.body;
    if (!orderId || !clientId) {
      res.status(400).json({ error: "validation_error", message: "orderId and clientId required" });
      return;
    }

    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, orderId));
    if (!ride || ride.driverId !== driverId) {
      res.status(403).json({ error: "forbidden", message: "Это не ваш рейс" });
      return;
    }

    const [passenger] = await db.select().from(ridePassengersTable)
      .where(and(eq(ridePassengersTable.id, clientId), eq(ridePassengersTable.rideId, orderId)));
    if (!passenger) {
      res.status(404).json({ error: "not_found", message: "Пассажир не найден" });
      return;
    }

    if (passenger.status === "picked_up" || passenger.status === "dropped_off") {
      res.status(409).json({ error: "conflict", message: "Нельзя отклонить подобранного/высаженного пассажира" });
      return;
    }

    const txResult = await db.transaction(async (tx) => {
      const deleted = await tx.delete(ridePassengersTable)
        .where(and(eq(ridePassengersTable.id, clientId), eq(ridePassengersTable.status, "waiting")))
        .returning();

      if (deleted.length === 0) {
        return { error: "conflict" as const };
      }

      const remaining = await tx.select().from(ridePassengersTable)
        .where(eq(ridePassengersTable.rideId, orderId));

      await tx.update(ridesTable).set({
        seatsTaken: remaining.length,
        passengers: remaining.length,
        version: sql`COALESCE(${ridesTable.version}, 0) + 1`,
        updatedAt: new Date(),
      }).where(eq(ridesTable.id, orderId));

      return { remaining };
    });

    if ("error" in txResult) {
      res.status(409).json({ error: "conflict", message: "Пассажир уже подобран или высажен" });
      return;
    }

    const updatedPassengers = await db.select().from(ridePassengersTable)
      .where(eq(ridePassengersTable.rideId, orderId));

    const [updatedRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, orderId));

    broadcastToUser(driverId, {
      type: "route_updated",
      rideId: orderId,
      action: "client_rejected",
      passengerId: clientId,
      passengerName: passenger.name,
      reason: reason || "",
      passengers: updatedPassengers,
    });

    broadcastToAll({
      type: "order_updated",
      rideId: orderId,
      action: "client_rejected",
    });

    req.log.info({ rideId: orderId, clientId, driverId, reason }, "Driver rejected client");
    res.json({
      success: true,
      message: `${passenger.name} отклонён`,
      ride: updatedRide,
      passengers: updatedPassengers,
    });
  } catch (err) {
    req.log.error({ err }, "Reject client error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/manual-client", authMiddleware, requireRole("driver"), validateBody(manualClientBodySchema), async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const { orderId, name, phone, seatNumber: rawSeatNumber, gender } = req.body;
    if (!orderId) {
      res.status(400).json({ error: "validation_error", message: "orderId required" });
      return;
    }
    const seatNumber = rawSeatNumber ? Number(rawSeatNumber) : undefined;
    if (seatNumber !== undefined && (!Number.isInteger(seatNumber) || seatNumber < 1)) {
      res.status(400).json({ error: "validation_error", message: "Invalid seatNumber" });
      return;
    }
    if (gender && !["male", "female"].includes(gender)) {
      res.status(400).json({ error: "validation_error", message: "gender must be 'male' or 'female'" });
      return;
    }

    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, orderId));
    if (!ride || ride.driverId !== driverId) {
      res.status(403).json({ error: "forbidden", message: "Это не ваш рейс" });
      return;
    }

    const totalSeats = ride.seatsTotal || 4;
    const defaultPrice = ride.price || 0;

    const passengerName = name || (gender === "female" ? "Женщина" : "Мужчина");

    const txResult = await db.transaction(async (tx) => {
      const currentPassengers = await tx.select().from(ridePassengersTable)
        .where(eq(ridePassengersTable.rideId, orderId));

      if (currentPassengers.length >= totalSeats) {
        return { error: "overbooking" as const };
      }

      let targetSeat: number;
      if (seatNumber && seatNumber >= 1 && seatNumber <= totalSeats) {
        const seatOccupied = currentPassengers.some(p => p.seatNumber === seatNumber);
        if (seatOccupied) {
          return { error: "seat_taken" as const };
        }
        targetSeat = seatNumber;
      } else {
        const occupiedSeatNumbers = currentPassengers.map(p => p.seatNumber);
        targetSeat = 1;
        while (occupiedSeatNumbers.includes(targetSeat) && targetSeat <= totalSeats) targetSeat++;
        if (targetSeat > totalSeats) targetSeat = totalSeats;
      }

      const [newPassenger] = await tx.insert(ridePassengersTable).values({
        rideId: orderId,
        name: passengerName,
        phone: phone || null,
        seatNumber: targetSeat,
        price: defaultPrice,
        gender: gender || "male",
        source: "manual",
        status: "waiting",
        pickupAddress: ride.fromAddress || null,
        dropoffAddress: ride.toAddress || null,
        pickupLat: ride.fromLat,
        pickupLng: ride.fromLng,
        dropoffLat: ride.toLat,
        dropoffLng: ride.toLng,
      }).returning();

      const allPassengers = await tx.select().from(ridePassengersTable)
        .where(eq(ridePassengersTable.rideId, orderId));

      await tx.update(ridesTable).set({
        seatsTaken: allPassengers.length,
        passengers: allPassengers.length,
        version: sql`COALESCE(${ridesTable.version}, 0) + 1`,
        updatedAt: new Date(),
      }).where(eq(ridesTable.id, orderId));

      return { newPassenger, allPassengers };
    });

    if ("error" in txResult) {
      if (txResult.error === "seat_taken") {
        res.status(409).json({ error: "seat_taken", message: "Это место уже занято" });
      } else {
        res.status(409).json({ error: "overbooking", message: "Все места заняты" });
      }
      return;
    }

    const { newPassenger, allPassengers: updatedPassengers } = txResult;
    const [updatedRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, orderId));

    broadcastToUser(driverId, {
      type: "route_updated",
      rideId: orderId,
      action: "client_added",
      passengerId: newPassenger.id,
      passengerName: passengerName,
      passengers: updatedPassengers,
    });

    broadcastToAll({
      type: "order_updated",
      rideId: orderId,
      action: "client_added",
    });

    req.log.info({ rideId: orderId, passengerId: newPassenger.id, name: passengerName, seatNumber: newPassenger.seatNumber, driverId }, "Driver manually added client");
    res.json({
      success: true,
      message: `${passengerName} добавлен на место ${newPassenger.seatNumber}`,
      ride: updatedRide,
      passengers: updatedPassengers,
      newPassenger,
    });
  } catch (err: any) {
    if (err?.code === "23505" && err?.constraint?.includes("ride_seat")) {
      res.status(409).json({ error: "seat_taken", message: "Это место уже занято" });
      return;
    }
    req.log.error({ err }, "Manual client error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


export default router;
