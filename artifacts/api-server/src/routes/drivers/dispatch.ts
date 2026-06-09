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
import { stopDispatchLoop, citiesMatch, enrichRideForOffer, isInUnassignCooldown } from "../../lib/autodispatch.js";
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

const rideIdBodySchema = z.object({
  rideId: z.union([z.number(), z.string()]),
}).passthrough();

const acceptRideLegacyBodySchema = z.object({}).passthrough();

const createDriverRideBodySchema = z.object({
  fromCity: z.string(),
  toCity: z.string(),
}).passthrough();

const router: IRouter = Router();

router.get("/available-rides", async (req, res) => {
  try {
    const rides = await db.select().from(ridesTable)
      .where(eq(ridesTable.status, "pending"))
      .orderBy(desc(ridesTable.createdAt))
      .limit(20);
    res.json({ rides, total: rides.length });
  } catch (err) {
    req.log.error({ err }, "Get available rides error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.get("/my-rides", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const rides = await db.select().from(ridesTable)
      .where(eq(ridesTable.driverId, req.userId!))
      .orderBy(desc(ridesTable.createdAt))
      .limit(50);

    const rideIds = rides.map(r => r.id);
    let allPassengers: any[] = [];
    if (rideIds.length > 0) {
      allPassengers = await db.select().from(ridePassengersTable)
        .where(inArray(ridePassengersTable.rideId, rideIds))
        .orderBy(ridePassengersTable.seatNumber);
    }

    const passengersByRide = new Map<number, any[]>();
    for (const p of allPassengers) {
      if (!passengersByRide.has(p.rideId)) passengersByRide.set(p.rideId, []);
      passengersByRide.get(p.rideId)!.push(p);
    }

    const ridesWithPassengers = rides.map(r => ({
      ...r,
      seatPassengers: enrichPassengersWithRouteInfo(passengersByRide.get(r.id) || [], r),
      passengers: passengersByRide.has(r.id) ? passengersByRide.get(r.id)!.length : (r.passengers || 0),
    }));

    res.json({ rides: ridesWithPassengers, total: ridesWithPassengers.length });
  } catch (err) {
    req.log.error({ err }, "Get driver rides error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/accept", authMiddleware, validateBody(rideIdBodySchema), async (req: AuthRequest, res) => {
  try {
    const { rideId } = req.body;
    const driverId = req.userId!;

    if (!rideId) {
      res.status(400).json({ error: "validation_error", message: "rideId is required" });
      return;
    }

    if (req.userRole !== "driver") {
      res.status(403).json({ error: "forbidden", message: "Only drivers can accept orders" });
      return;
    }

    const [driver] = await db.select(safeUserColumns).from(usersTable).where(eq(usersTable.id, driverId));
    if (!driver) {
      res.status(404).json({ error: "not_found", message: "Driver not found" });
      return;
    }

    if (isDriverBanned(driver)) {
      const remainMin = Math.ceil(getBanRemainingMs(driver) / 60000);
      res.status(403).json({ error: "driver_banned", message: `Временная блокировка. Осталось ${remainMin} мин.` });
      return;
    }

    const balance = parseFloat(driver.balance?.toString() || "0");
    const balErr = checkMinBalance(balance, "accept");
    if (balErr) {
      res.status(403).json({ error: "insufficient_balance", message: balErr });
      return;
    }

    const [existing] = await db.select().from(ridesTable).where(eq(ridesTable.id, Number(rideId)));
    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Ride not found" });
      return;
    }

    if (existing.driverId === driverId && ["accepted", "in_progress"].includes(existing.status as string)) {
      clog.log(`[IDEMPOTENT] rideId=${rideId}, driverId=${driverId}, status=${existing.status} — already accepted by this driver`);
      res.json({ success: true, ride: existing, idempotent: true });
      return;
    }

    // Block re-accepting a ride the dispatcher JUST unassigned from this driver.
    // The unassign cooldown is otherwise only enforced inside auto-dispatch's
    // candidate selection; the urgent/market accept path (skipOffer) reaches here
    // directly, so without this guard the driver could re-grab the same order the
    // operator just pulled off them.
    if (await isInUnassignCooldown(Number(rideId), driverId)) {
      res.status(409).json({
        error: "unassign_cooldown",
        message: "Этот заказ был снят с вас диспетчером. Попробуйте позже.",
      });
      return;
    }

    let matchedRouteRide: typeof existing | null = null;

    {
      const activeRouteRides = await db.select().from(ridesTable).where(
        and(eq(ridesTable.driverId, driverId), inArray(ridesTable.status, ["accepted", "in_progress"]))
      );
      if (activeRouteRides.length > 0) {
        matchedRouteRide = activeRouteRides.find(r =>
          citiesMatch(r.fromCity, existing.fromCity) && citiesMatch(r.toCity, existing.toCity)
        ) || null;

        if (!matchedRouteRide) {
          res.status(409).json({ error: "driver_busy", message: "У вас уже есть активный рейс по другому маршруту. Завершите его перед принятием нового." });
          return;
        }
        if (matchedRouteRide) {
          const routePassengers = await db.select({ id: ridePassengersTable.id })
            .from(ridePassengersTable)
            .where(eq(ridePassengersTable.rideId, matchedRouteRide.id));
          const totalSeats = driver.seats || 4;
          if (routePassengers.length >= totalSeats) {
            res.status(409).json({ error: "no_seats", message: "Нет свободных мест в рейсе" });
            return;
          }
          clog.log(`[ACCEPT] driver ${driverId} has active route ${matchedRouteRide.id} (${matchedRouteRide.fromCity}→${matchedRouteRide.toCity}), ${totalSeats - routePassengers.length}/${totalSeats} free — adding passenger`);
        }
      }
    }

    if (!["pending", "offered"].includes(existing.status as string)) {
      res.status(409).json({ error: "already_taken", message: "Заказ уже принят другим водителем" });
      return;
    }

    const rideMode = existing.mode || "dispatch";
    const rideSource = existing.source || "dispatch";
    const skipOffer = rideMode === "market" || existing.isUrgent === true;

    if (rideSource === "marketplace") {
      const [soldListing] = await db.select()
        .from(marketplaceListingsTable)
        .where(and(
          eq(marketplaceListingsTable.rideId, Number(rideId)),
          eq(marketplaceListingsTable.status, "sold"),
        ));
      if (soldListing && soldListing.buyerId && soldListing.buyerId !== driverId) {
        res.status(403).json({ error: "not_buyer", message: "Этот заказ уже продан другому водителю" });
        return;
      }
    }

    if (rideMode === "dispatch" && driver.status === "online" && !matchedRouteRide) {
      const inProgressTrips = await db.select({ id: ridesTable.id }).from(ridesTable).where(
        and(eq(ridesTable.driverId, driverId), inArray(ridesTable.status, ["accepted", "in_progress"]))
      );
      if (inProgressTrips.length > 0) {
        clog.log(`[FINAL CHECK] driverId=${driverId}, rideId=${rideId}, rejected=active_trip (${inProgressTrips.map(t => t.id).join(",")})`);
        res.status(409).json({ error: "driver_busy", message: "У вас есть активный рейс" });
        return;
      }
    }

    clog.log(`[ACCEPT] rideId=${rideId}, mode=${rideMode}, source=${rideSource}, isUrgent=${existing.isUrgent}, skipOffer=${skipOffer}, driverId=${driverId}`);
    let acceptedOffer: any = null;

    if (!skipOffer) {
      const [pendingOffer] = await db.select().from(orderOffersTable).where(
        and(
          eq(orderOffersTable.rideId, Number(rideId)),
          eq(orderOffersTable.driverId, driverId),
          eq(orderOffersTable.status, "pending"),
        )
      );
      if (!pendingOffer) {
        clog.error(`[BLOCKED] driver ${driverId} tried to accept ride ${rideId} without pending offer`);
        res.status(403).json({ error: "MUST_ACCEPT_OFFER_FIRST", message: "У вас нет активного предложения на этот заказ" });
        return;
      }

      const [ao] = await db.update(orderOffersTable)
        .set({ status: "accepted", respondedAt: new Date() })
        .where(and(
          eq(orderOffersTable.id, pendingOffer.id),
          eq(orderOffersTable.status, "pending"),
        ))
        .returning();

      if (!ao) {
        res.status(409).json({ error: "offer_expired", message: "Предложение истекло" });
        return;
      }
      acceptedOffer = ao;
    } else {
      clog.log(`[ACCEPT] ride ${rideId} mode=${rideMode} source=${rideSource} — skipping offer requirement for driver ${driverId}`);
    }

    const [ride] = await db.update(ridesTable).set({
      driverId,
      driverName: driver.name,
      driverPhone: driver.phone,
      driverCar: driver.carModel,
      driverCarNumber: driver.carNumber,
      driverRating: driver.rating,
      status: "accepted",
      version: sql`COALESCE(${ridesTable.version}, 0) + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(ridesTable.id, Number(rideId)), inArray(ridesTable.status, ["pending", "offered"])))
    .returning();

    if (!ride) {
      clog.log(`[SAFE ACCEPT] rideId=${rideId}, driverId=${driverId}, success=false (already taken)`);
      if (acceptedOffer) {
        await db.update(orderOffersTable).set({ status: "expired", respondedAt: new Date() })
          .where(eq(orderOffersTable.id, acceptedOffer.id));
      }
      res.status(409).json({ error: "already_taken", message: "Заказ уже принят другим водителем" });
      return;
    }

    await db.update(orderOffersTable)
      .set({ status: "expired", respondedAt: new Date() })
      .where(and(
        eq(orderOffersTable.rideId, Number(rideId)),
        eq(orderOffersTable.status, "pending"),
        ne(orderOffersTable.driverId, driverId),
      ));

    clog.log(`[SAFE ACCEPT] rideId=${rideId}, driverId=${driverId}, success=true, mode=${rideMode}, source=${rideSource}`);

    // Auto-cancel any OTHER empty driver-routes belonging to this driver (avoid dual-active-ride state)
    // IMPORTANT: never cancel the route we are about to merge into (matchedRouteRide.id)
    try {
      const excludeIds = [Number(rideId)];
      if (matchedRouteRide) excludeIds.push(matchedRouteRide.id);
      const otherRoutes = await db.select().from(ridesTable)
        .where(and(
          eq(ridesTable.driverId, driverId),
          notInArray(ridesTable.id, excludeIds),
          inArray(ridesTable.status, ["accepted", "in_progress"]),
          eq(ridesTable.source, "driver"),
        ));
      for (const r of otherRoutes) {
        const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)` })
          .from(ridePassengersTable).where(eq(ridePassengersTable.rideId, r.id));
        if (Number(cnt) === 0) {
          await db.update(ridesTable)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(eq(ridesTable.id, r.id));
          clog.log(`[AUTO-CANCEL] empty driver-route ${r.id} cancelled (driver ${driverId} accepted ${rideId})`);
          broadcastToAll({ type: "ride_updated", ride: { ...r, status: "cancelled" } });
        }
      }
    } catch (e) {
      clog.error("[AUTO-CANCEL] failed:", e);
    }

    if (matchedRouteRide) {
      const totalSeats = driver.seats || 4;
      const insertResult = await db.transaction(async (tx) => {
        // [ADVISORY_LOCK] сериализация accept на уровне driver
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${driverId})`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${Number(rideId)})`);
        const routePassengers = await tx.select({ id: ridePassengersTable.id, seatNumber: ridePassengersTable.seatNumber })
          .from(ridePassengersTable).where(eq(ridePassengersTable.rideId, matchedRouteRide.id));

        const ridePaxRows = await tx.select()
          .from(ridePassengersTable).where(eq(ridePassengersTable.rideId, Number(rideId)));
        const rideSeats = ridePaxRows.length > 0 ? ridePaxRows.length : (existing.passengers || 1);

        if (routePassengers.length + rideSeats > totalSeats) return null;

        // Найти первое свободное место (а не просто length+1, т.к. ручной booking мог занять seat=4 при пустых 1..3)
        const occupiedSeats = new Set<number>(routePassengers.map(p => p.seatNumber).filter(n => n != null));
        function nextFreeSeat(): number {
          for (let i = 1; i <= totalSeats; i++) {
            if (!occupiedSeats.has(i)) { occupiedSeats.add(i); return i; }
          }
          return -1;
        }
        let lastAssigned = -1;

        if (ridePaxRows.length > 0) {
          for (const pax of ridePaxRows) {
            let assignedSeat: number;
            if (pax.seatNumber != null && pax.seatNumber >= 1 && pax.seatNumber <= totalSeats && !occupiedSeats.has(pax.seatNumber)) {
              assignedSeat = pax.seatNumber;
              occupiedSeats.add(pax.seatNumber);
            } else {
              assignedSeat = nextFreeSeat();
            }
            lastAssigned = assignedSeat;
            await tx.insert(ridePassengersTable).values({
              rideId: matchedRouteRide.id,
              name: pax.name || existing.riderName || "Пассажир",
              phone: pax.phone || existing.riderPhone || "",
              pickupAddress: pax.pickupAddress || (existing.fromDistrictName ? `${existing.fromDistrictName} (${existing.fromCity})` : null) || existing.fromAddress || existing.fromCity,
              dropoffAddress: pax.dropoffAddress || (existing.toDistrictName ? `${existing.toDistrictName} (${existing.toCity})` : null) || existing.toAddress || existing.toCity,
              pickupLat: pax.pickupLat != null ? Number(pax.pickupLat) : (existing.fromLat ? Number(existing.fromLat) : null),
              pickupLng: pax.pickupLng != null ? Number(pax.pickupLng) : (existing.fromLng ? Number(existing.fromLng) : null),
              seatNumber: assignedSeat,
              price: Number(pax.price) || 0,
              baggageType: pax.baggageType || "none",
              source: "autodispatch",
              // Unique per source passenger so a multi-passenger child ride does
              // not self-collide on the (ride_id, external_key) unique index, and
              // re-accepting the same ride is idempotent (skips already-merged).
              externalKey: `merged-ride-${Number(rideId)}-pax-${pax.id}`,
            }).onConflictDoNothing();
          }
        } else {
          const perSeatPrice = Math.round((Number(existing.price) || 0) / rideSeats);
          for (let i = 0; i < rideSeats; i++) {
            const seatToUse = nextFreeSeat();
            lastAssigned = seatToUse;
            await tx.insert(ridePassengersTable).values({
              rideId: matchedRouteRide.id,
              name: existing.riderName || "Пассажир",
              phone: existing.riderPhone || "",
              pickupAddress: (existing.fromDistrictName ? `${existing.fromDistrictName} (${existing.fromCity})` : null) || existing.fromAddress || existing.fromCity,
              dropoffAddress: (existing.toDistrictName ? `${existing.toDistrictName} (${existing.toCity})` : null) || existing.toAddress || existing.toCity,
              pickupLat: existing.fromLat ? Number(existing.fromLat) : null,
              pickupLng: existing.fromLng ? Number(existing.fromLng) : null,
              seatNumber: seatToUse,
              price: perSeatPrice,
              baggageType: "none",
              source: "autodispatch",
              // Unique per seat (see note above) — avoids self-collision on the
              // (ride_id, external_key) unique index and makes re-accept idempotent.
              externalKey: `merged-ride-${Number(rideId)}-seat-${seatToUse}`,
            }).onConflictDoNothing();
          }
        }

        await tx.update(ridesTable).set({
          tripId: matchedRouteRide.id,
          status: "merged",
          updatedAt: new Date(),
        }).where(eq(ridesTable.id, Number(rideId)));
        clog.log(`[MERGE] ride ${rideId} marked as merged into trip ${matchedRouteRide.id}`);

        const newCount = routePassengers.length + rideSeats;
        await tx.update(ridesTable)
          .set({ passengers: newCount, seatsTaken: newCount, updatedAt: new Date() })
          .where(eq(ridesTable.id, matchedRouteRide.id));

        return { nextSeat: lastAssigned, newCount, addedSeats: rideSeats };
      });

      if (!insertResult) {
        await db.update(ridesTable).set({
          driverId: null, driverName: null, driverPhone: null,
          driverCar: null, driverCarNumber: null, driverRating: null,
          status: "pending", updatedAt: new Date(),
        }).where(eq(ridesTable.id, Number(rideId)));
        if (acceptedOffer) {
          await db.update(orderOffersTable).set({ status: "expired", respondedAt: new Date() })
            .where(eq(orderOffersTable.id, acceptedOffer.id));
        }
        res.status(409).json({ error: "no_seats", message: "Места заняты другим пассажиром" });
        return;
      }

      clog.log(`[ACCEPT] ${insertResult.addedSeats} passenger(s) attached to route ${matchedRouteRide.id}, lastSeat=${insertResult.nextSeat}, total=${insertResult.newCount}`);
      req.log.info({ rideId, driverId, routeRideId: matchedRouteRide.id, seatNumber: insertResult.nextSeat }, "Passenger attached to route ride");

      const [updatedRoute] = await db.select().from(ridesTable).where(eq(ridesTable.id, matchedRouteRide.id));
      broadcastToAll({ type: "ride_updated", ride: updatedRoute });
      broadcastToAll({ type: "queue_update", fromCity: matchedRouteRide.fromCity, toCity: matchedRouteRide.toCity, reason: "passenger_added" });
    } else {
      await db.update(usersTable)
        .set({ status: "busy", updatedAt: new Date() })
        .where(eq(usersTable.id, driverId));

      const existingPax = await db.select({ id: ridePassengersTable.id })
        .from(ridePassengersTable).where(eq(ridePassengersTable.rideId, ride.id));

      if (existingPax.length === 0) {
        const paxCount = existing.passengers || 1;
        const perSeatPrice = Math.round((Number(existing.price) || 0) / paxCount);
        for (let i = 1; i <= paxCount; i++) {
          await db.insert(ridePassengersTable).values({
            rideId: ride.id,
            name: existing.riderName || "Пассажир",
            phone: existing.riderPhone || "",
            pickupAddress: (existing.fromDistrictName ? `${existing.fromDistrictName} (${existing.fromCity})` : null) || existing.fromAddress || existing.fromCity,
            dropoffAddress: (existing.toDistrictName ? `${existing.toDistrictName} (${existing.toCity})` : null) || existing.toAddress || existing.toCity,
            pickupLat: existing.fromLat ? Number(existing.fromLat) : null,
            pickupLng: existing.fromLng ? Number(existing.fromLng) : null,
            seatNumber: i,
            price: perSeatPrice,
            baggageType: "none",
            source: "system",
          });
        }
      }

      const allPax = await db.select({ id: ridePassengersTable.id })
        .from(ridePassengersTable).where(eq(ridePassengersTable.rideId, ride.id));

      const finalPaxCount = allPax.length > 0 ? allPax.length : (existing.passengers || 1);
      await db.update(ridesTable).set({
        passengers: finalPaxCount,
        seatsTaken: finalPaxCount,
        seatsTotal: driver.seats || 4,
        updatedAt: new Date(),
      }).where(eq(ridesTable.id, ride.id));

      clog.log(`[ACCEPT] ride ${ride.id}, existingPax=${existingPax.length}, finalPax=${finalPaxCount}`);
    }

    resetConsecutiveIgnores(driverId);

    await db.update(orderOffersTable)
      .set({ status: "expired", respondedAt: new Date() })
      .where(and(
        eq(orderOffersTable.rideId, Number(rideId)),
        eq(orderOffersTable.status, "pending"),
      ));

    stopDispatchLoop(Number(rideId));

    try {
      const [mpListing] = await db.select()
        .from(marketplaceListingsTable)
        .where(and(
          eq(marketplaceListingsTable.rideId, Number(rideId)),
          inArray(marketplaceListingsTable.status, ["active", "sold"]),
        ));
      if (mpListing) {
        await db.update(marketplaceListingsTable).set({
          buyerId: driverId,
          status: "in_progress",
          updatedAt: new Date(),
        }).where(eq(marketplaceListingsTable.id, mpListing.id));
        broadcastToUser(mpListing.sellerId, {
          type: "marketplace_order_accepted",
          listingId: mpListing.id,
          rideId: Number(rideId),
          buyerId: driverId,
          buyerName: driver.name,
          buyerPhone: driver.phone,
          buyerCar: driver.carModel,
          buyerCarNumber: driver.carNumber,
        });
        broadcastToAll({ type: "marketplace_listing_sold", listingId: mpListing.id });
        clog.log(`[MARKETPLACE] listing ${mpListing.id} → in_progress, buyer=${driverId}, seller=${mpListing.sellerId}`);
      }
    } catch (mpErr) { clog.error("[MARKETPLACE] update listing on accept failed:", mpErr); }

    const [freshRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, Number(rideId)));
    broadcastToAll({ type: "ride_updated", ride: freshRide || ride });
    enqueueDriverStatusBroadcast(driverId, "busy");
    notifyOrderAccepted(Number(rideId), driver.name).catch(() => {});

    if (matchedRouteRide) {
      const [freshTrip] = await db.select().from(ridesTable).where(eq(ridesTable.id, matchedRouteRide.id));
      if (freshTrip) {
        const tripPax = await db.select().from(ridePassengersTable)
          .where(eq(ridePassengersTable.rideId, matchedRouteRide.id))
          .orderBy(ridePassengersTable.seatNumber);
        const totalSeatsNow = driver.seats || 4;
        const occupiedNow = tripPax.length;
        const freeNow = totalSeatsNow - occupiedNow;
        broadcastToAll({
          type: "trip_updated",
          trip: { ...freshTrip, seatPassengers: tripPax },
          passengers: tripPax,
          occupiedSeats: occupiedNow,
          freeSeats: freeNow,
        });
        broadcastToUser(driverId, {
          type: "route_updated",
          rideId: matchedRouteRide.id,
          version: freshTrip?.version,
          passengers: tripPax,
          occupiedSeats: occupiedNow,
          freeSeats: freeNow,
          reason: "passenger_added",
        });

        if (freeNow <= 0) {
          clog.log(`[ACCEPT] car FULL for driver ${driverId}, trip ${matchedRouteRide.id} — expiring all pending offers`);
          await db.update(orderOffersTable)
            .set({ status: "expired", respondedAt: new Date() })
            .where(and(
              eq(orderOffersTable.driverId, driverId),
              eq(orderOffersTable.status, "pending"),
            ));
        }
      }
    }

    const expiredOffers = await db.select({ driverId: orderOffersTable.driverId })
      .from(orderOffersTable)
      .where(and(eq(orderOffersTable.rideId, Number(rideId)), eq(orderOffersTable.status, "expired")));
    for (const offer of expiredOffers) {
      if (offer.driverId !== driverId) {
        broadcastToUser(offer.driverId, { type: "order_expired", rideId: Number(rideId) });
        notifyOrderTaken(offer.driverId, Number(rideId)).catch(() => {});
      }
    }

    const offerCreatedAt = acceptedOffer?.createdAt ? new Date(acceptedOffer.createdAt).getTime() : 0;
    const responseMs = offerCreatedAt > 0 ? Date.now() - offerCreatedAt : 0;
    recordDriverAccept(driverId, responseMs);

    try { const { markAssigned: mqAssign } = await import("../../lib/driver-queue.js"); mqAssign(driverId, responseMs); } catch (e) { clog.error("[QUEUE] markAssigned failed", e); }

    try { const { refreshOccupiedSeats } = await import("../../lib/driver-queue.js"); await refreshOccupiedSeats(); } catch (e) { clog.error("[QUEUE] refreshOccupiedSeats after accept failed", e); }

    req.log.info({ rideId, driverId }, "Driver accepted ride via POST /accept");
    notifyRideStatusChange(Number(rideId), "accepted").catch(() => {});
    res.json(ride);
  } catch (err) {
    req.log.error({ err }, "Accept ride error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/:id/accept-ride/:rideId", authMiddleware, validateBody(acceptRideLegacyBodySchema), async (req: AuthRequest, res) => {
  // [LEGACY REDIRECT] заменено: дублирующая логика удалена, форвард на /accept
  try {
    const { rideId } = req.params;
    req.body = { ...(req.body || {}), rideId: Number(rideId) };
    req.url = req.url.replace(`/${req.params.id}/accept-ride/${req.params.rideId}`, '/accept');
    req.log.info({ rideId, driverId: req.userId }, '[LEGACY] forwarded to /accept');
    res.status(308).json({ error: 'use_new_endpoint', message: 'Use POST /api/drivers/accept', rideId: Number(rideId) });
  } catch (err) {
    req.log.error({ err }, '[LEGACY] redirect failed');
    res.status(500).json({ error: 'server_error' });
  }

});


router.post("/start", authMiddleware, validateBody(rideIdBodySchema), async (req: AuthRequest, res) => {
  try {
    const { rideId } = req.body;
    const driverId = req.userId!;
    const rawActionId = req.headers["x-action-id"] as string | undefined;
    const ikey = rawActionId ? idempotencyKey(driverId, "start", rawActionId) : null;

    if (ikey) {
      const cached = await getIdempotentResult(ikey);
      if (cached) { res.status(cached.status).json({ ...cached.body, _rideVersion: cached.rideVersion, _replayed: true }); return; }
    }

    if (!rideId) {
      res.status(400).json({ error: "validation_error", message: "rideId is required" });
      return;
    }

    const [existing] = await db.select().from(ridesTable).where(eq(ridesTable.id, Number(rideId)));
    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Ride not found" });
      return;
    }

    if (existing.driverId !== driverId) {
      res.status(403).json({ error: "forbidden", message: "Это не ваш заказ" });
      return;
    }

    if (existing.status !== "accepted") {
      res.status(400).json({ error: "invalid_status", message: "Заказ должен быть в статусе 'Принят' для начала поездки" });
      return;
    }

    const [ride] = await db.update(ridesTable).set({
      status: "in_progress",
      version: sql`COALESCE(${ridesTable.version}, 0) + 1`,
      updatedAt: new Date(),
    }).where(and(eq(ridesTable.id, Number(rideId)), eq(ridesTable.version, existing.version ?? 0))).returning();

    if (!ride) {
      res.status(409).json({ error: "version_conflict", message: "Данные изменились, обновите" });
      return;
    }

    broadcastToAll({ type: "ride_updated", ride });

    try {
      await db.update(marketplaceListingsTable).set({
        status: "in_progress",
        updatedAt: new Date(),
      }).where(and(
        eq(marketplaceListingsTable.rideId, Number(rideId)),
        eq(marketplaceListingsTable.status, "sold")
      ));
    } catch {}

    req.log.info({ rideId, driverId }, "Driver started ride");
    if (ikey) await storeIdempotentResult(ikey, driverId, "start", 200, ride, ride.version);
    res.json(ride);
  } catch (err) {
    req.log.error({ err }, "Driver start ride error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/complete", authMiddleware, validateBody(rideIdBodySchema), async (req: AuthRequest, res) => {
  try {
    const { rideId } = req.body;
    const driverId = req.userId!;

    if (!rideId) {
      res.status(400).json({ error: "validation_error", message: "rideId is required" });
      return;
    }

    const [existing] = await db.select().from(ridesTable).where(eq(ridesTable.id, Number(rideId)));
    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Ride not found" });
      return;
    }

    if (existing.driverId !== driverId) {
      res.status(403).json({ error: "forbidden", message: "Это не ваш заказ" });
      return;
    }

    if (existing.status !== "in_progress") {
      res.status(400).json({ error: "invalid_status", message: "Заказ должен быть в статусе 'В пути' для завершения" });
      return;
    }

    const passengers = await db.select().from(ridePassengersTable)
      .where(eq(ridePassengersTable.rideId, Number(rideId)));
    if (passengers.length > 0) {
      const notDropped = passengers.filter(p => p.status !== "dropped_off");
      if (notDropped.length > 0) {
        res.status(400).json({
          error: "passengers_not_dropped",
          message: `Сначала высадите всех пассажиров (осталось: ${notDropped.length})`,
          remaining: notDropped.map(p => ({ id: p.id, name: p.name, status: p.status })),
        });
        return;
      }
    }

    const result = await completeRide(Number(rideId));
    if (!result.success) {
      const statusCode = result.error === "no_driver" || result.error === "no_price" ? 409 : 400;
      res.status(statusCode).json({ error: result.error || "completion_error", message: result.message || result.error || "Ошибка завершения" });
      return;
    }

    const linkedClientRides = await db.select().from(ridesTable)
      .where(and(
        eq(ridesTable.tripId, Number(rideId)),
        inArray(ridesTable.status, ["pending", "offered", "accepted", "in_progress"]),
      ));
    for (const cr of linkedClientRides) {
      await db.update(ridesTable).set({ status: "completed", updatedAt: new Date() })
        .where(eq(ridesTable.id, cr.id));
      req.log.info({ clientRideId: cr.id, tripRideId: rideId }, "[TRIP] completed linked client ride");
    }

    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, Number(rideId)));
    broadcastToAll({ type: "ride_updated", ride });
    broadcastToAll({ type: "trip_completed", rideId: Number(rideId), driverId, version: ride?.version });
    enqueueDriverStatusBroadcast(driverId, "online");

    try {
      const completedRideIds = [Number(rideId), ...linkedClientRides.map(cr => cr.id)];
      for (const crid of completedRideIds) {
        const [mpListing] = await db.select()
          .from(marketplaceListingsTable)
          .where(and(
            eq(marketplaceListingsTable.rideId, crid),
            inArray(marketplaceListingsTable.status, ["in_progress", "sold"]),
          ));
        if (mpListing) {
          await db.update(marketplaceListingsTable).set({
            status: "completed",
            updatedAt: new Date(),
          }).where(eq(marketplaceListingsTable.id, mpListing.id));
          const earnings = mpListing.price;
          broadcastToUser(mpListing.sellerId, {
            type: "marketplace_order_completed",
            listingId: mpListing.id,
            rideId: crid,
            earnings,
            buyerId: mpListing.buyerId,
          });
          clog.log(`[MARKETPLACE] listing ${mpListing.id} → completed, seller=${mpListing.sellerId}, earnings=${earnings}`);
        }
      }
    } catch (mpErr) { clog.error("[MARKETPLACE] update listing on complete failed:", mpErr); }

    try {
      const { returnToQueue, getQueuePosition: gqp } = await import("../../lib/driver-queue.js");
      const { getCachedDriver } = await import("../../lib/driver-cache.js");
      const cd = getCachedDriver(driverId);
      if (cd && cd.status === "online" && cd.balance >= getSettingNum("min_driver_balance", 0)) {
        returnToQueue(driverId);
        clog.log(`[TRIP] completed rideId=${rideId}, driverId=${driverId}, linked=${linkedClientRides.length}, queuePos=${gqp(driverId)}`);
      } else {
        clog.log(`[TRIP] completed rideId=${rideId}, driverId=${driverId}, skipped queue return (status=${cd?.status}, balance=${cd?.balance})`);
      }
    } catch (e) { clog.error("[QUEUE] returnToQueue failed", e); }
    req.log.info({ rideId, driverId, linkedRides: linkedClientRides.length }, "Driver completed ride");
    res.json(ride);

  } catch (err) {
    req.log.error({ err }, "Driver complete ride error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/cancel", authMiddleware, validateBody(rideIdBodySchema), async (req: AuthRequest, res) => {
  try {
    const { rideId } = req.body;
    const driverId = req.userId!;
    const rawActionId = req.headers["x-action-id"] as string | undefined;
    const ikey = rawActionId ? idempotencyKey(driverId, "cancel", rawActionId) : null;

    if (ikey) {
      const cached = await getIdempotentResult(ikey);
      if (cached) { res.status(cached.status).json({ ...cached.body, _rideVersion: cached.rideVersion, _replayed: true }); return; }
    }

    if (!rideId) {
      res.status(400).json({ error: "validation_error", message: "rideId is required" });
      return;
    }

    const [existing] = await db.select().from(ridesTable).where(eq(ridesTable.id, Number(rideId)));
    if (!existing || existing.driverId !== driverId) {
      res.status(404).json({ error: "not_found", message: "Ride not found or not yours" });
      return;
    }

    if (!["accepted", "in_progress"].includes(existing.status as string)) {
      res.status(400).json({ error: "invalid_status", message: "Заказ нельзя отменить в текущем статусе" });
      return;
    }

    const ridePassengers = await db.select({ source: ridePassengersTable.source })
      .from(ridePassengersTable)
      .where(eq(ridePassengersTable.rideId, Number(rideId)));
    const PERSONAL_SOURCES = new Set(["manual", "driver"]);
    const externalPassengers = ridePassengers.filter(p => !PERSONAL_SOURCES.has(p.source as string));

    if (externalPassengers.length > 0) {
      res.status(403).json({
        error: "external_passengers_present",
        message: "Нельзя снять рейс — есть клиенты от диспетчера или маркета. Обратитесь к диспетчеру.",
      });
      return;
    }

    const [ride] = await db.update(ridesTable).set({
      status: "cancelled",
      driverId: null,
      driverName: null,
      driverPhone: null,
      version: sql`COALESCE(${ridesTable.version}, 0) + 1`,
      updatedAt: new Date(),
    }).where(and(eq(ridesTable.id, Number(rideId)), eq(ridesTable.version, existing.version ?? 0))).returning();

    if (ride) {
      // Все клиенты тут только personal (manual/driver) — удаляем их вместе с рейсом
      try {
        await db.delete(ridePassengersTable).where(eq(ridePassengersTable.rideId, Number(rideId)));
      } catch (e) { clog.error("[cancel] failed to delete ride_passengers:", e); }
    }

    if (!ride) {
      res.status(409).json({ error: "version_conflict", message: "Данные изменились, обновите" });
      return;
    }

    await db.update(usersTable).set({ status: "online", updatedAt: new Date() }).where(eq(usersTable.id, driverId));

    broadcastToAll({ type: "ride_updated", ride });
    enqueueDriverStatusBroadcast(driverId, "online");
    req.log.info({ rideId, driverId }, "Driver cancelled ride with penalty");
    if (ikey) await storeIdempotentResult(ikey, driverId, "cancel", 200, ride, ride.version);
    res.json(ride);
  } catch (err) {
    req.log.error({ err }, "Driver cancel error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/create-ride", authMiddleware, validateBody(createDriverRideBodySchema), async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const { fromCity, toCity, departureTime, urgent, timeSlot: bodyTimeSlot } = req.body;
    const isUrgentRoute = urgent === true;

    if (!fromCity || !toCity || fromCity === toCity) {
      res.status(400).json({ error: "validation_error", message: "Выберите разные города" });
      return;
    }

    const [driver] = await db.select(safeUserColumns).from(usersTable).where(eq(usersTable.id, driverId));
    if (!driver || driver.role !== "driver") {
      res.status(403).json({ error: "forbidden", message: "Доступ только для водителей" });
      return;
    }

    if (driver.status !== "online" && driver.status !== "busy") {
      res.status(400).json({ error: "offline", message: "Выйдите на линию, чтобы создать рейс" });
      return;
    }

    const existingRides = await db.select().from(ridesTable)
      .where(and(
        eq(ridesTable.driverId, driverId),
        inArray(ridesTable.status, ["accepted", "in_progress"]),
      ));

    if (existingRides.length > 0) {
      res.status(409).json({ error: "already_has_ride", message: "У вас уже есть активный рейс" });
      return;
    }

    const fromCityData = CITIES[fromCity];
    const toCityData = CITIES[toCity];

    if (!fromCityData || !toCityData) {
      res.status(400).json({ error: "validation_error", message: "Неизвестный город" });
      return;
    }

    const scheduledAt = isUrgentRoute ? new Date() : (departureTime ? new Date(departureTime) : new Date());
    if (isNaN(scheduledAt.getTime())) {
      res.status(400).json({ error: "validation_error", message: "Неверное время отправления" });
      return;
    }

    const osrmResult = await getOsrmRoute([
      { lat: fromCityData.lat, lng: fromCityData.lng },
      { lat: toCityData.lat, lng: toCityData.lng },
    ]);
    const distance = osrmResult?.distance || haversineDistance(fromCityData.lat, fromCityData.lng, toCityData.lat, toCityData.lng);
    const duration = osrmResult?.duration || Math.round((distance / 80) * 60);

    const driverSeats = driver.seats ?? 4;

    const initialWaypoints = [
      { lat: fromCityData.lat, lng: fromCityData.lng, type: "origin" as const, label: fromCity },
      { lat: toCityData.lat, lng: toCityData.lng, type: "destination" as const, label: toCity },
    ];

    const [ride] = await db.insert(ridesTable).values({
      fromCity, toCity,
      scheduledAt,
      passengers: 0,
      carClass: driver.carClass || "economy",
      status: "accepted",
      price: 0,
      distance,
      duration,
      driverId,
      driverName: driver.name,
      driverPhone: driver.phone,
      driverCar: driver.carModel,
      driverCarNumber: driver.carNumber,
      driverRating: driver.rating,
      fromLat: fromCityData?.lat || null,
      fromLng: fromCityData?.lng || null,
      toLat: toCityData?.lat || null,
      toLng: toCityData?.lng || null,
      seatsTotal: driverSeats,
      seatsTaken: 0,
      waypoints: initialWaypoints,
      routePolyline: osrmResult?.geometry ?? null,
      routeDuration: duration,
      routeDistance: distance,
      source: "driver",
      isUrgent: isUrgentRoute,
      timeSlot: isUrgentRoute ? null : (() => {
        if (typeof bodyTimeSlot === "string" && /^\d{2}:00-\d{2}:00$/.test(bodyTimeSlot)) return bodyTimeSlot;
        // Fallback for legacy clients: derive HH:00-HH+2:00 in Asia/Tashkent (UTC+5)
        const tashkentMs = scheduledAt.getTime() + 5 * 60 * 60 * 1000;
        const h = new Date(tashkentMs).getUTCHours();
        const end = (h + 2) % 24;
        return `${String(h).padStart(2, "0")}:00-${String(end).padStart(2, "0")}:00`;
      })(),
      comment: isUrgentRoute ? "Срочный рейс водителя" : `Рейс водителя: ${bodyTimeSlot || departureTime || "сейчас"}`,
    }).returning();

    await db.update(usersTable).set({ status: "busy", updatedAt: new Date() }).where(eq(usersTable.id, driverId));
    broadcastToAll({ type: "ride_updated", ride });
    enqueueDriverStatusBroadcast(driverId, "busy");
    broadcastToAll({ type: "queue_update", fromCity, toCity, reason: "driver_joined" });

    req.log.info({ rideId: ride.id, driverId }, "Driver created ride");
    res.status(201).json(ride);
  } catch (err) {
    req.log.error({ err }, "Driver create ride error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.get("/my-active-ride", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const rides = await db.select().from(ridesTable)
      .where(and(
        eq(ridesTable.driverId, driverId),
        inArray(ridesTable.status, ["accepted", "in_progress"]),
      ))
      .orderBy(ridesTable.createdAt);

    if (rides.length === 0) {
      res.json({ ride: null, passengers: [] });
      return;
    }

    // Pick ride with the most actual passengers; tiebreak: prefer driver-route (riderPhone null), then oldest.
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

    clog.log("SEAT SYNC:", {
      rideId: tripRide.id,
      ridePassengersField: tripRide.passengers,
      dbPassengers: passengers.length,
      seats: passengers.map(p => p.seatNumber),
    });

    const [driverRow] = await db.select({ seats: usersTable.seats }).from(usersTable).where(eq(usersTable.id, driverId));
    const totalSeatsForDriver = driverRow?.seats || 4;
    const realPassengerCount = passengers.length > 0 ? passengers.length : (tripRide.passengers || 0);
    const correctedRide = {
      ...tripRide,
      passengers: realPassengerCount,
      seatsTaken: realPassengerCount,
      seatsTotal: totalSeatsForDriver,
      freeSeats: totalSeatsForDriver - realPassengerCount,
      passengerStatuses: {
        waiting: passengers.filter(p => p.status === "waiting").length,
        picked_up: passengers.filter(p => p.status === "picked_up").length,
        dropped_off: passengers.filter(p => p.status === "dropped_off").length,
      },
    };

    if (passengers.length > 0 && (tripRide.passengers !== passengers.length || tripRide.seatsTaken !== passengers.length)) {
      await db.update(ridesTable).set({
        passengers: passengers.length,
        seatsTaken: passengers.length,
        version: sql`COALESCE(${ridesTable.version}, 0) + 1`,
        updatedAt: new Date(),
      }).where(eq(ridesTable.id, tripRide.id));
    }

    res.json({ ride: correctedRide, passengers, version: (tripRide.version ?? 0) });
  } catch (err) {
    req.log.error({ err }, "Get active ride error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.get("/by-route", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { fromCity, toCity, timeSlot } = req.query as Record<string, string>;
    const filterTimeSlot = (timeSlot && timeSlot.trim()) ? timeSlot.trim() : null;

    const onlineDrivers = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      phone: usersTable.phone,
      carModel: usersTable.carModel,
      carNumber: usersTable.carNumber,
      carClass: usersTable.carClass,
      rating: usersTable.rating,
      status: usersTable.status,
    }).from(usersTable)
      .where(and(eq(usersTable.role, "driver"), inArray(usersTable.status, ["busy", "online"])));

    const activeRides = await db.select().from(ridesTable)
      .where(and(
        inArray(ridesTable.status, ["accepted", "in_progress", "pending"]),
        ...(fromCity ? [eq(ridesTable.fromCity, fromCity)] : []),
        ...(toCity ? [eq(ridesTable.toCity, toCity)] : []),
      ));

    const result: any[] = [];
    const driverIdsWithRides = new Set<number>();

    const sortedRides = [...activeRides]
      .filter(r => r.driverId)
      .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    const queueMap = new Map<number, number>();
    sortedRides.forEach((r, i) => {
      if (r.driverId && !queueMap.has(r.driverId)) {
        queueMap.set(r.driverId, i + 1);
      }
    });

    for (const ride of activeRides) {
      if (!ride.driverId) continue;
      const driver = onlineDrivers.find(d => d.id === ride.driverId);
      if (!driver) continue;
      // Time-slot filter: only show drivers whose active route matches the requested time interval.
      // Driver routes WITHOUT a slot (urgent) are always shown.
      if (filterTimeSlot) {
        const routeSlot = (ride as any).timeSlot ? String((ride as any).timeSlot).trim() : null;
        if (routeSlot && routeSlot !== filterTimeSlot) continue;
      }
      driverIdsWithRides.add(driver.id);

      const passengers = await db.select().from(ridePassengersTable)
        .where(eq(ridePassengersTable.rideId, ride.id));

      const seatsTotal = ride.seatsTotal || 4;
      const occupiedSeats = passengers.map(p => (p as any).seatNumber as number).filter(n => n != null).sort((a, b) => a - b);

      result.push({
        driver,
        ride: {
          id: ride.id,
          fromCity: ride.fromCity,
          toCity: ride.toCity,
          scheduledAt: ride.scheduledAt,
          status: ride.status,
          price: ride.price,
          passengers: ride.passengers,
          carClass: ride.carClass || "economy",
        },
        seatsTaken: passengers.length,
        seatsTotal,
        seatsFree: seatsTotal - passengers.length,
        totalEarnings: passengers.reduce((sum, p) => sum + (p.price || 0), 0),
        occupiedSeats,
        queuePosition: queueMap.get(ride.driverId!) || null,
        queueTotal: sortedRides.length,
      });
    }

    const allDriverRides = await db.select({ driverId: ridesTable.driverId })
      .from(ridesTable)
      .where(and(
        inArray(ridesTable.status, ["accepted", "in_progress"]),
      ));
    const busyDriverIds = new Set(allDriverRides.map(r => r.driverId).filter(Boolean));

    for (const driver of onlineDrivers) {
      if (driverIdsWithRides.has(driver.id)) continue;
      if (busyDriverIds.has(driver.id)) continue;
      result.push({
        driver,
        ride: null,
        seatsTaken: 0,
        seatsTotal: 4,
        seatsFree: 4,
        totalEarnings: 0,
        occupiedSeats: [],
        queuePosition: null,
        queueTotal: sortedRides.length,
      });
    }

    result.sort((a, b) => {
      if (a.queuePosition && b.queuePosition) return a.queuePosition - b.queuePosition;
      if (a.queuePosition) return -1;
      if (b.queuePosition) return 1;
      return 0;
    });

    res.json({ drivers: result });
  } catch (err) {
    req.log.error({ err }, "Get drivers by route error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/extend-ride", authMiddleware, validateBody(rideIdBodySchema), async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const { rideId } = req.body;

    const [ride] = await db.select().from(ridesTable)
      .where(and(eq(ridesTable.id, Number(rideId)), eq(ridesTable.driverId, driverId), eq(ridesTable.status, "accepted")));

    if (!ride) {
      res.status(404).json({ error: "not_found", message: "Рейс не найден" });
      return;
    }

    const newScheduledAt = new Date(new Date(ride.scheduledAt).getTime() + 30 * 60 * 1000);
    await db.update(ridesTable).set({ scheduledAt: newScheduledAt, updatedAt: new Date() }).where(eq(ridesTable.id, ride.id));

    const passengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, ride.id));
    const systemPax = passengers.filter(p => p.source === "system").length;

    if (systemPax < 3) {
      req.log.info({ rideId: ride.id, driverId, systemPax }, "Extend penalty: system pax < 3");
    }

    broadcastToAll({ type: "queue_update", fromCity: ride.fromCity, toCity: ride.toCity, reason: "extend" });
    res.json({ success: true, newScheduledAt });
  } catch (err) {
    req.log.error({ err }, "Extend ride error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/reject", authMiddleware, validateBody(rideIdBodySchema), async (req: AuthRequest, res) => {
  try {
    const { rideId } = req.body;
    const driverId = req.userId!;

    if (!rideId) {
      res.status(400).json({ error: "validation_error", message: "rideId is required" });
      return;
    }

    await db.update(orderOffersTable)
      .set({ status: "rejected", respondedAt: new Date() })
      .where(and(
        eq(orderOffersTable.rideId, Number(rideId)),
        eq(orderOffersTable.driverId, driverId),
        eq(orderOffersTable.status, "pending"),
      ));

    recordDriverReject(driverId);

    req.log.info({ rideId, driverId }, "Driver rejected offer");
    res.json({ success: true, message: "Offer rejected" });
  } catch (err) {
    req.log.error({ err }, "Driver reject error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.get("/pending-offers", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;

    const activeRoutes = await db.select({ id: ridesTable.id })
      .from(ridesTable)
      .where(and(
        eq(ridesTable.driverId, driverId),
        inArray(ridesTable.status, ["accepted", "in_progress"]),
      ))
      .limit(1);

    const hasActiveRoute = activeRoutes.length > 0;

    const offers = await db.select()
      .from(orderOffersTable)
      .where(and(
        eq(orderOffersTable.driverId, driverId),
        eq(orderOffersTable.status, "pending"),
      ));

    const now = Date.now();
    const liveOffers = offers.filter((o) => !(o.expiresAt && now > o.expiresAt.getTime()));
    const expiredByTime = offers.filter((o) => o.expiresAt && now > o.expiresAt.getTime());

    // Batch-fetch the rides for all live offers (was one SELECT per offer).
    const offerRideIds = [...new Set(liveOffers.map((o) => o.rideId).filter(Boolean) as number[])];
    const rides = offerRideIds.length
      ? await db.select().from(ridesTable).where(inArray(ridesTable.id, offerRideIds))
      : [];
    const rideMap = new Map(rides.map((r) => [r.id, r]));

    const validOffers = liveOffers.filter((o) => {
      const ride = rideMap.get(o.rideId);
      return ride && ["pending", "offered"].includes(ride.status as string);
    });
    const staleOfferIds = [
      ...expiredByTime.map((o) => o.id),
      ...liveOffers.filter((o) => !validOffers.includes(o)).map((o) => o.id),
    ];
    if (staleOfferIds.length) {
      await db.update(orderOffersTable)
        .set({ status: "expired", respondedAt: new Date() })
        .where(inArray(orderOffersTable.id, staleOfferIds));
    }

    // Batch the enrichment (market listing + passengers) for all valid rides in 2 queries.
    const validRideIds = [...new Set(validOffers.map((o) => o.rideId) as number[])];
    const mlistings = validRideIds.length
      ? await db.select({ rideId: marketplaceListingsTable.rideId, comment: marketplaceListingsTable.comment, baggageType: marketplaceListingsTable.baggageType })
          .from(marketplaceListingsTable)
          .where(and(inArray(marketplaceListingsTable.rideId, validRideIds), eq(marketplaceListingsTable.status, "active")))
      : [];
    const listingMap = new Map(mlistings.map((m) => [m.rideId, m]));
    const paxRows = validRideIds.length
      ? await db.select({ rideId: ridePassengersTable.rideId, seatNumber: ridePassengersTable.seatNumber, gender: ridePassengersTable.gender, baggageType: ridePassengersTable.baggageType })
          .from(ridePassengersTable).where(inArray(ridePassengersTable.rideId, validRideIds))
      : [];
    const paxByRide = new Map<number, any[]>();
    for (const p of paxRows) {
      const arr = paxByRide.get(p.rideId) ?? [];
      arr.push(p);
      paxByRide.set(p.rideId, arr);
    }

    const result = validOffers.map((offer) => {
      const ride = rideMap.get(offer.rideId)!;
      const ml = listingMap.get(ride.id);
      const passengers = paxByRide.get(ride.id) ?? [];
      const expiresIn = offer.expiresAt ? Math.max(0, offer.expiresAt.getTime() - Date.now()) : 0;
      return {
        ride: {
          ...ride,
          comment: ml?.comment ?? (ride as any).comment ?? null,
          baggageType: ml?.baggageType ?? passengers[0]?.baggageType ?? null,
          seatPassengers: passengers,
        },
        expiresIn,
        offerId: offer.id,
      };
    });

    res.json({ offers: result, noRoute: !hasActiveRoute });
  } catch (err) {
    req.log.error({ err }, "Get pending offers error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


export default router;
