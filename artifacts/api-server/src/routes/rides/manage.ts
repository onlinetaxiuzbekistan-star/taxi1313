import { Router, type IRouter } from "express";
import { clog } from "../../lib/logger.js";
import { db, ridesTable, usersTable, tariffsTable, orderOffersTable, ridePassengersTable, districtsTable, settingsTable, routesTable, routeOptionsTable, transactionsTable, driverGroupsTable, citiesTable, safeUserColumns} from "@workspace/db";
import { eq, desc, asc, and, sql, inArray, gte, lte, like, or, ilike } from "drizzle-orm";
import { broadcastToAll, broadcastToUser } from "../../lib/websocket.js";
import { startAutoDispatch, getOfferStatus, stopDispatchLoop, citiesMatch, addUnassignCooldown } from "../../lib/autodispatch.js";
import { addToBuffer, isBatchEnabled } from "../../lib/ride-buffer.js";
import { completeRide } from "../../lib/completion.js";
import { authMiddleware, requireRole, AuthRequest } from "../../middlewares/auth.js";
import { validateBody } from "../../middlewares/validate.js";
import { createRideBodySchema, updateRideBodySchema } from "../../middlewares/request-schemas.js";
import { createRide, getRide } from "../../lib/services/rides.service.js";
import { config } from "../../lib/config.js";
import { getMarketplaceSettings } from "../../lib/settings.js";
import { getSettingNum, getSettingBool, getSetting } from "../../lib/settingsCache.js";
import { applySurgeToPrice, isRevenueAIProdEnabled, enableRevenueAIProd, getRevenueAIProdSurge } from "../../lib/revenue-ai-prod.js";
import { notifyRideStatusChange } from "../../lib/sms-notifications.js";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../../lib/jwt-secret.js";
import { getOsrmRoute, haversineDistance, type OsrmRoute } from "../../lib/osrm.js";
import { JWT_SECRET as __JWT_SECRET_FOR_BRANCH } from "../../lib/jwt-secret.js";
import { db as __db_branch, usersTable as __users_branch } from "@workspace/db";
import { eq as __eq_branch } from "drizzle-orm";
import { enrichPassengersWithRouteInfo,SURGE_DEFAULTS,parseTime,isInTimeRange,getDemandSupplyRatio,getSurgeMultiplier,CITIES,CITIES_RU_MAP,findCity,__branchOfUserCache,__getRequesterBranchScope,__getRequesterIdentity,calcDistanceFallback,calcRouteDistance,calcPrice,Waypoint,TripMatch,PickupDropoffPair,extractPairs,wpKey,buildPairMap,isValidOrder,generateValidPermutations,estimateRouteDist,calcDetour,optimizeRouteOrder,pointProgressAlongLine,isAlongRoute,perpendicularDistKm,findMatchingTrip } from "./shared.js";
import { z } from "zod";

const rideTransactionBodySchema = z.object({
  type: z.string(),
  amount: z.union([z.number(), z.string()]),
}).passthrough();

const updateRideTransactionBodySchema = z.object({}).passthrough();

const addPassengerBodySchema = z.object({
  name: z.string(),
}).passthrough();

const updatePassengerBodySchema = z.object({}).passthrough();

const cancelRideBodySchema = z.object({}).passthrough();

const unassignDriverBodySchema = z.object({}).passthrough();

const optimizeRouteBodySchema = z.object({}).passthrough();

const router: IRouter = Router();

router.post("/:id/transactions", authMiddleware, requireRole("dispatcher", "admin"), validateBody(rideTransactionBodySchema), async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.params.id);
    if (isNaN(rideId)) return res.status(400).json({ error: "invalid_ride_id" });
    const { type, amount, comment } = req.body;
    if (!type || amount == null) return res.status(400).json({ error: "type_and_amount_required" });
    const validTypes = ["income", "commission", "bonus", "penalty", "adjust", "refund", "withdraw"];
    if (!validTypes.includes(type)) return res.status(400).json({ error: "invalid_type" });
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) return res.status(400).json({ error: "invalid_amount" });

    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
    if (!ride) return res.status(404).json({ error: "ride_not_found" });

    const driverId = ride.driverId;
    let balanceBefore: string | null = null;
    let balanceAfter: string | null = null;

    if (driverId) {
      const result = await db.transaction(async (tx) => {
        const [driver] = await tx.select(safeUserColumns).from(usersTable).where(eq(usersTable.id, driverId)).for("update");
        if (!driver) return null;
        balanceBefore = driver.balance?.toString() || "0";
        const newBalance = parseFloat(balanceBefore) + numAmount;
        balanceAfter = newBalance.toFixed(2);
        await tx.update(usersTable).set({ balance: balanceAfter }).where(eq(usersTable.id, driverId));
        const [inserted] = await tx.insert(transactionsTable).values({
          driverId,
          rideId,
          type,
          amount: numAmount.toFixed(2),
          balanceBefore,
          balanceAfter,
          description: comment || null,
          updatedBy: (req as AuthRequest).userId || null,
        }).returning();
        return inserted;
      });
      if (!result) return res.status(404).json({ error: "driver_not_found" });
      res.json({ transaction: result, driverBalance: balanceAfter });
    } else {
      const [inserted] = await db.insert(transactionsTable).values({
        driverId: null,
        rideId,
        type,
        amount: numAmount.toFixed(2),
        description: comment || null,
        updatedBy: (req as AuthRequest).userId || null,
      }).returning();
      res.json({ transaction: inserted });
    }
  } catch (err) {
    req.log.error({ err }, "Create ride transaction error");
    res.status(500).json({ error: "server_error" });
  }
});


router.patch("/:rideId/transactions/:txId", authMiddleware, requireRole("dispatcher", "admin"), validateBody(updateRideTransactionBodySchema), async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.params.rideId);
    const txId = parseInt(req.params.txId);
    if (isNaN(rideId) || isNaN(txId)) return res.status(400).json({ error: "invalid_ids" });
    const { amount, comment } = req.body;
    if (amount !== undefined && isNaN(parseFloat(amount))) return res.status(400).json({ error: "invalid_amount" });

    let driverBalance: string | null = null;

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(transactionsTable)
        .where(and(eq(transactionsTable.id, txId), eq(transactionsTable.rideId, rideId)))
        .for("update");
      if (!existing) return null;

      const updates: Partial<typeof transactionsTable.$inferInsert> = { updatedBy: req.userId, updatedAt: new Date() };
      if (comment !== undefined) updates.description = comment;

      if (amount !== undefined && existing.driverId) {
        const newAmount = parseFloat(amount);
        const oldAmount = parseFloat(existing.amount);
        const diff = newAmount - oldAmount;

        const [driver] = await tx.select(safeUserColumns).from(usersTable).where(eq(usersTable.id, existing.driverId)).for("update");
        if (!driver) throw new Error("driver_not_found");
        const currentBalance = parseFloat(driver.balance?.toString() || "0");
        const updatedBalance = (currentBalance + diff).toFixed(2);
        await tx.update(usersTable).set({ balance: updatedBalance }).where(eq(usersTable.id, existing.driverId));
        updates.amount = newAmount.toFixed(2);
        updates.balanceAfter = updatedBalance;
        driverBalance = updatedBalance;
      } else if (amount !== undefined) {
        updates.amount = parseFloat(amount).toFixed(2);
      }

      await tx.update(transactionsTable).set(updates).where(eq(transactionsTable.id, txId));
      const [updated] = await tx.select().from(transactionsTable).where(eq(transactionsTable.id, txId));
      return updated;
    });

    if (!result) return res.status(404).json({ error: "transaction_not_found" });
    res.json({ transaction: result, driverBalance });
  } catch (err) {
    req.log.error({ err }, "Update ride transaction error");
    res.status(500).json({ error: "server_error" });
  }
});


router.patch("/:id", authMiddleware, requireRole("dispatcher", "admin"), validateBody(updateRideBodySchema), async (req: AuthRequest, res) => {
  try {
    const { status, driverId, fromCity, toCity, fromAddress, toAddress,
            passengers, carClass, price, comment, riderName, riderPhone, paymentType,
            fromDistrictId, toDistrictId } = req.body;
    const rideId = parseInt(req.params.id);

    const [existing] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Заказ не найден" });
      return;
    }

    if (["completed", "cancelled"].includes(existing.status as string) && !status) {
      res.status(400).json({ error: "invalid_state", message: "Нельзя редактировать завершённый или отменённый заказ" });
      return;
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };

    if (status) updateData.status = status;
    if (fromCity !== undefined) {
      updateData.fromCity = fromCity;
      const c = CITIES[fromCity.toLowerCase()];
      if (c) { updateData.fromLat = c.lat; updateData.fromLng = c.lng; }
    }
    if (toCity !== undefined) {
      updateData.toCity = toCity;
      const c = CITIES[toCity.toLowerCase()];
      if (c) { updateData.toLat = c.lat; updateData.toLng = c.lng; }
    }
    if (fromAddress !== undefined) updateData.fromAddress = fromAddress;
    if (toAddress !== undefined) updateData.toAddress = toAddress;
    if (passengers !== undefined) {
      const p = parseInt(passengers);
      if (p < 1 || p > 8) {
        res.status(400).json({ error: "validation_error", message: "Количество пассажиров: от 1 до 8" });
        return;
      }
      updateData.passengers = p;
    }
    if (carClass !== undefined) {
      if (!["economy", "comfort", "business"].includes(carClass)) {
        res.status(400).json({ error: "validation_error", message: "Недопустимый класс авто" });
        return;
      }
      updateData.carClass = carClass;
    }
    if (fromDistrictId !== undefined) {
      if (fromDistrictId === null || fromDistrictId === "") {
        updateData.fromDistrictId = null;
        updateData.fromDistrictName = null;
        updateData.fromDistrictCharge = 0;
      } else {
        const [d] = await db.select().from(districtsTable).where(eq(districtsTable.id, Number(fromDistrictId)));
        if (d) {
          updateData.fromDistrictId = d.id;
          updateData.fromDistrictName = d.name;
          updateData.fromDistrictCharge = d.extraCharge || 0;
          if (d.lat && d.lng) { updateData.fromLat = d.lat; updateData.fromLng = d.lng; }
        }
      }
    }
    if (toDistrictId !== undefined) {
      if (toDistrictId === null || toDistrictId === "") {
        updateData.toDistrictId = null;
        updateData.toDistrictName = null;
        updateData.toDistrictCharge = 0;
      } else {
        const [d] = await db.select().from(districtsTable).where(eq(districtsTable.id, Number(toDistrictId)));
        if (d) {
          updateData.toDistrictId = d.id;
          updateData.toDistrictName = d.name;
          updateData.toDistrictCharge = d.extraCharge || 0;
          if (d.lat && d.lng) { updateData.toLat = d.lat; updateData.toLng = d.lng; }
        }
      }
    }
        if (price !== undefined) {
      const pr = parseFloat(price);
      if (pr < 0) {
        res.status(400).json({ error: "validation_error", message: "Цена не может быть отрицательной" });
        return;
      }
      updateData.price = pr;
    }
    if (comment !== undefined) updateData.comment = comment;
    if (riderName !== undefined) updateData.riderName = riderName;
    if (riderPhone !== undefined) updateData.riderPhone = riderPhone;
    if (paymentType !== undefined) {
      if (!["cash", "card", "transfer"].includes(paymentType)) {
        res.status(400).json({ error: "validation_error", message: "Недопустимый тип оплаты" });
        return;
      }
      updateData.paymentType = paymentType;
    }

    if (driverId && status !== "accepted") {
      clog.log("DISPATCH MODE:", { rideId, mode: "offer-only", assigned: false, requestedDriverId: driverId });
      clog.error(`[BLOCKED] dispatcher tried to directly assign driver ${driverId} to ride ${rideId} — use offer flow instead`);
    }

    if (status === "accepted" && !existing.driverId) {
      res.status(400).json({ error: "no_driver", message: "Нельзя принять рейс без назначения водителя. Используйте кнопку 'Отправить заказ'" });
      return;
    }

    if (status === "in_progress" && existing.driverId) {
      await db.update(usersTable).set({ status: "busy" }).where(eq(usersTable.id, existing.driverId));
    }

    if (status === "completed") {
      const result = await completeRide(rideId);
      if (!result.success) {
        const statusCode = result.error === "no_driver" || result.error === "no_price" ? 409 : 400;
        res.status(statusCode).json({ error: result.error || "completion_error", message: result.message || result.error || "Ошибка завершения" });
        return;
      }
      const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
      const seatPassengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, rideId));
      broadcastToAll({ type: "ride_updated", ride: { ...ride, seatPassengers: enrichPassengersWithRouteInfo(seatPassengers, ride) } });
      notifyRideStatusChange(rideId, "completed").catch(() => {});
      res.json({ ...ride, seatPassengers: enrichPassengersWithRouteInfo(seatPassengers, ride) });
      return;
    }

    const [ride] = await db.update(ridesTable).set(updateData).where(eq(ridesTable.id, rideId)).returning();
    const seatPassengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, rideId));
    broadcastToAll({ type: "ride_updated", ride: { ...ride, seatPassengers: enrichPassengersWithRouteInfo(seatPassengers, ride) } });
    if (status && ["accepted", "in_progress", "cancelled"].includes(status)) {
      notifyRideStatusChange(rideId, status).catch(() => {});
    }
    res.json({ ...ride, seatPassengers: enrichPassengersWithRouteInfo(seatPassengers, ride) });
  } catch (err) {
    req.log.error({ err }, "Update ride error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/:id/passengers", authMiddleware, requireRole("dispatcher", "admin"), validateBody(addPassengerBodySchema), async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.params.id);
    const { name, phone, pickupAddress, dropoffAddress, pickupLat, pickupLng, seatNumber, price, baggageType, source } = req.body;

    if (!name) {
      res.status(400).json({ error: "validation_error", message: "Имя пассажира обязательно" });
      return;
    }

    const seat = Number(seatNumber) || 1;
    if (seat < 1 || seat > 4) {
      res.status(400).json({ error: "validation_error", message: "Номер места: от 1 до 4" });
      return;
    }

    const existing = await db.select().from(ridePassengersTable)
      .where(and(eq(ridePassengersTable.rideId, rideId), eq(ridePassengersTable.seatNumber, seat)));
    if (existing.length > 0) {
      res.status(409).json({ error: "seat_taken", message: `Место ${seat} уже занято` });
      return;
    }

    const passengerSource = source === "manual" ? "manual" : "system";
    const [passenger] = await db.insert(ridePassengersTable).values({
      rideId,
      name,
      phone: phone || null,
      pickupAddress: pickupAddress || null,
      dropoffAddress: dropoffAddress || null,
      pickupLat: pickupLat != null ? Number(pickupLat) : null,
      pickupLng: pickupLng != null ? Number(pickupLng) : null,
      seatNumber: seat,
      price: Number(price) || 0,
      baggageType: baggageType || "none",
      source: passengerSource,
    }).returning();

    const allPassengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, rideId));
    await db.update(ridesTable).set({
      passengers: allPassengers.length,
      price: allPassengers.reduce((s, p) => s + (p.price || 0), 0),
      updatedAt: new Date(),
    }).where(eq(ridesTable.id, rideId));

    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
    if (ride) {
      broadcastToAll({ type: "queue_update", fromCity: ride.fromCity, toCity: ride.toCity, reason: "passenger_added" });
      broadcastToAll({ type: "ride_updated", ride: { ...ride, seatPassengers: enrichPassengersWithRouteInfo(allPassengers, ride) } });
    }

    res.status(201).json(passenger);
  } catch (err) {
    req.log.error({ err }, "Add passenger error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.patch("/:id/passengers/:passengerId", authMiddleware, requireRole("dispatcher", "admin"), validateBody(updatePassengerBodySchema), async (req: AuthRequest, res) => {
  try {
    const passengerId = parseInt(req.params.passengerId);
    const { name, phone, pickupAddress, dropoffAddress, pickupLat, pickupLng, seatNumber, price, baggageType } = req.body;

    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (pickupAddress !== undefined) updateData.pickupAddress = pickupAddress;
    if (dropoffAddress !== undefined) updateData.dropoffAddress = dropoffAddress;
    if (pickupLat !== undefined) updateData.pickupLat = pickupLat != null ? Number(pickupLat) : null;
    if (pickupLng !== undefined) updateData.pickupLng = pickupLng != null ? Number(pickupLng) : null;
    if (seatNumber !== undefined) updateData.seatNumber = Number(seatNumber);
    if (price !== undefined) updateData.price = Number(price);
    if (baggageType !== undefined) updateData.baggageType = baggageType;

    // Seat-change validation: check duplicate in same ride and in driver's other accepted rides
    if (seatNumber !== undefined) {
      const newSeat = Number(seatNumber);
      if (newSeat < 1 || newSeat > 4) {
        res.status(400).json({ error: "validation_error", message: "Номер места: от 1 до 4" });
        return;
      }
      const [current] = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.id, passengerId));
      if (!current) {
        res.status(404).json({ error: "not_found", message: "Пассажир не найден" });
        return;
      }
      if (current.seatNumber !== newSeat) {
        const sameRideConflict = await db.select().from(ridePassengersTable)
          .where(and(eq(ridePassengersTable.rideId, current.rideId), eq(ridePassengersTable.seatNumber, newSeat)));
        if (sameRideConflict.some(r => r.id !== passengerId)) {
          res.status(409).json({ error: "seat_taken", message: `Место ${newSeat} в этом заказе уже занято` });
          return;
        }
        const [thisRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, current.rideId));
        // If this is a child of a merged trip, also check seat conflicts on the parent trip
        if (thisRide?.tripId) {
          const mirrorKey = `merged-ride-${thisRide.id}`;
          const parentSeats = await db.select().from(ridePassengersTable)
            .where(and(eq(ridePassengersTable.rideId, thisRide.tripId), eq(ridePassengersTable.seatNumber, newSeat)));
          if (parentSeats.some(r => r.externalKey !== mirrorKey)) {
            res.status(409).json({ error: "seat_taken_trip", message: `Место ${newSeat} занято пассажиром этого рейса` });
            return;
          }
        }
        if (thisRide?.driverId) {
          const otherRides = await db.select().from(ridesTable)
            .where(and(eq(ridesTable.driverId, thisRide.driverId), eq(ridesTable.status, "accepted")));
          const otherRideIds = otherRides.map(r => r.id).filter(id => id !== current.rideId);
          if (otherRideIds.length > 0) {
            const otherSeats = await db.select().from(ridePassengersTable)
              .where(and(inArray(ridePassengersTable.rideId, otherRideIds), eq(ridePassengersTable.seatNumber, newSeat)));
            if (otherSeats.length > 0) {
              res.status(409).json({ error: "seat_taken_driver", message: `Место ${newSeat} занято пассажиром другого заказа этого водителя` });
              return;
            }
          }
        }
      }
    }

    const [passenger] = await db.update(ridePassengersTable)
      .set(updateData)
      .where(eq(ridePassengersTable.id, passengerId))
      .returning();

    if (!passenger) {
      res.status(404).json({ error: "not_found", message: "Пассажир не найден" });
      return;
    }

    // Mirror the change onto the parent trip's merged passenger row (if this ride is a child of a merged trip)
    try {
      const [childRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, passenger.rideId));
      if (childRide?.tripId) {
        const mirrorKey = `merged-ride-${childRide.id}`;
        const mirrorUpdate: Record<string, any> = {};
        if (updateData.seatNumber !== undefined) mirrorUpdate.seatNumber = updateData.seatNumber;
        if (updateData.name !== undefined) mirrorUpdate.name = updateData.name;
        if (updateData.phone !== undefined) mirrorUpdate.phone = updateData.phone;
        if (updateData.pickupAddress !== undefined) mirrorUpdate.pickupAddress = updateData.pickupAddress;
        if (updateData.dropoffAddress !== undefined) mirrorUpdate.dropoffAddress = updateData.dropoffAddress;
        if (updateData.pickupLat !== undefined) mirrorUpdate.pickupLat = updateData.pickupLat;
        if (updateData.pickupLng !== undefined) mirrorUpdate.pickupLng = updateData.pickupLng;
        if (updateData.price !== undefined) mirrorUpdate.price = updateData.price;
        if (updateData.baggageType !== undefined) mirrorUpdate.baggageType = updateData.baggageType;
        if (Object.keys(mirrorUpdate).length > 0) {
          await db.update(ridePassengersTable)
            .set(mirrorUpdate)
            .where(and(eq(ridePassengersTable.rideId, childRide.tripId), eq(ridePassengersTable.externalKey, mirrorKey)));
        }
      }
    } catch (e) { req.log?.warn?.({ e }, "mirror passenger to parent trip failed"); }

    // Recompute total ride price based on new seat distribution (front seat costs more)
    try {
      if (updateData.seatNumber !== undefined) {
        const [thisRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, passenger.rideId));
        if (thisRide && !thisRide.isMail) {
          const [route] = await db.select().from(routesTable)
            .where(and(eq(routesTable.fromCity, thisRide.fromCity), eq(routesTable.toCity, thisRide.toCity)));
          if (route) {
            const cls = (thisRide.carClass || "economy") as "economy" | "comfort" | "business";
            const priceBack: number = (route as any)[`price${cls.charAt(0).toUpperCase()+cls.slice(1)}`] || 0;
            const priceFront: number = (route as any)[`priceFront${cls.charAt(0).toUpperCase()+cls.slice(1)}`] || priceBack;
            const allP = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, thisRide.id));
            const frontCount = allP.filter(p => p.seatNumber === 1).length;
            const backCount = allP.filter(p => p.seatNumber !== 1).length;
            let basePrice = frontCount * priceFront + backCount * priceBack;
            const optionsTotal = (thisRide as any).optionsTotal || 0;
            const fromCharge = (thisRide as any).fromDistrictCharge || 0;
            const toCharge = (thisRide as any).toDistrictCharge || 0;
            let finalPrice = basePrice + fromCharge + toCharge + optionsTotal;
            if (thisRide.roundTrip) {
              const [est] = await db.select().from(routesTable)
                .where(and(eq(routesTable.fromCity, thisRide.fromCity), eq(routesTable.toCity, thisRide.toCity)));
              let dp = (est as any)?.roundTripDiscountPercent ?? 0;
              if (dp < 0) dp = 0; if (dp > 100) dp = 100;
              const total = finalPrice * 2;
              finalPrice = total - Math.round(total * (dp/100));
              if (finalPrice <= 0) finalPrice = total;
            }
            if (Number.isFinite(finalPrice) && finalPrice > 0) {
              await db.update(ridesTable)
                .set({ basePrice, price: finalPrice, updatedAt: new Date() })
                .where(eq(ridesTable.id, thisRide.id));
              // Update each passenger's individual price based on their (possibly new) seat
              const tripMul = thisRide.roundTrip ? 2 : 1;
              for (const pp of allP) {
                const newPrice = (pp.seatNumber === 1 ? priceFront : priceBack) * tripMul;
                if (Number.isFinite(newPrice) && newPrice > 0 && newPrice !== pp.price) {
                  await db.update(ridePassengersTable)
                    .set({ price: newPrice })
                    .where(eq(ridePassengersTable.id, pp.id));
                }
              }
              clog.log(`[SEAT-CHANGE] ride ${thisRide.id} price recomputed: front=${frontCount} back=${backCount} basePrice=${basePrice} final=${finalPrice} tripMul=${tripMul}`);
            }
          }
        }
      }
    } catch (e) { req.log?.warn?.({ e }, "price recompute after seat change failed"); }

    // Bump ride version so driver app does NOT discard refresh as "stale", then broadcast for child + parent trip
    try {
      const ridesToNotify: number[] = [passenger.rideId];
      const [childRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, passenger.rideId));
      if (childRide?.tripId) ridesToNotify.push(childRide.tripId);
      for (const rid of ridesToNotify) {
        const [bumped] = await db.update(ridesTable)
          .set({ version: sql`COALESCE(${ridesTable.version}, 0) + 1`, updatedAt: new Date() })
          .where(eq(ridesTable.id, rid))
          .returning();
        const ride = bumped;
        if (!ride) continue;
        if (ride.id === passenger.rideId) (req as any).finalRideForResponse = ride;
        const allPassengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, ride.id));
        const enriched = enrichPassengersWithRouteInfo(allPassengers, ride);
        const payload = { type: "ride_updated", rideId: ride.id, version: ride.version, ride: { ...ride, seatPassengers: enriched } };
        broadcastToAll(payload);
        if (ride.driverId) {
          broadcastToUser(ride.driverId, payload);
          broadcastToUser(ride.driverId, { type: "passenger_seat_changed", rideId: ride.id, passengerId: passenger.id, seatNumber: passenger.seatNumber, version: ride.version });
        }
      }
    } catch (e) { req.log?.warn?.({ e }, "broadcast after seat change failed"); }

    res.json({ ...passenger, ride: (req as any).finalRideForResponse || null });
  } catch (err) {
    req.log.error({ err }, "Update passenger error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.delete("/:id/passengers/:passengerId", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.params.id);
    const passengerId = parseInt(req.params.passengerId);

    const [deleted] = await db.delete(ridePassengersTable)
      .where(eq(ridePassengersTable.id, passengerId))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "not_found", message: "Пассажир не найден" });
      return;
    }

    const allPassengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, rideId));
    await db.update(ridesTable).set({
      passengers: Math.max(1, allPassengers.length),
      price: allPassengers.reduce((s, p) => s + (p.price || 0), 0) || 0,
      updatedAt: new Date(),
    }).where(eq(ridesTable.id, rideId));

    // Notify clients so the removed seat disappears in real time. Previously this
    // handler emitted no WS events, so a passenger the operator removed lingered
    // on the driver's seat map until the next poll. Mirrors the add-passenger
    // broadcast at POST /:id/passengers, plus a targeted hint to the driver.
    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
    if (ride) {
      broadcastToAll({ type: "ride_updated", ride: { ...ride, seatPassengers: enrichPassengersWithRouteInfo(allPassengers, ride) } });
      if (ride.driverId) {
        broadcastToUser(ride.driverId, { type: "passenger_removed", rideId, passengerId });
      }
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete passenger error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/:id/cancel", authMiddleware, requireRole("dispatcher", "admin"), validateBody(cancelRideBodySchema), async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.params.id);
    const [existing] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));

    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Заказ не найден" });
      return;
    }

    if (["completed", "cancelled"].includes(existing.status as string)) {
      res.status(400).json({ error: "invalid_state", message: "Заказ уже завершён или отменён" });
      return;
    }

    stopDispatchLoop(rideId);

    const reasonRaw = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    const cancelReason = reasonRaw ? reasonRaw.slice(0, 500) : null;

    const [ride] = await db.update(ridesTable)
      .set({ status: "cancelled", cancelReason, updatedAt: new Date() })
      .where(eq(ridesTable.id, rideId))
      .returning();

    if (existing.tripId) {
      const externalKey = `merged-ride-${rideId}`;
      const deleted = await db.delete(ridePassengersTable)
        .where(and(eq(ridePassengersTable.rideId, existing.tripId), eq(ridePassengersTable.externalKey, externalKey)))
        .returning({ id: ridePassengersTable.id });
      const removedCount = deleted.length || (existing.passengers || 1);
      req.log.info({ tripId: existing.tripId, childRideId: rideId, removedPassengers: deleted.length }, "Removed merged passengers from parent trip on cancel");

      const remaining = await db.select({ cnt: sql<number>`count(*)` })
        .from(ridePassengersTable).where(eq(ridePassengersTable.rideId, existing.tripId));
      const remainingCount = Number(remaining[0]?.cnt || 0);

      const [parentTrip] = await db.select().from(ridesTable).where(eq(ridesTable.id, existing.tripId));
      const tripUpdateFields: Record<string, any> = {
        seatsTaken: remainingCount,
        passengers: remainingCount,
        updatedAt: new Date(),
      };

      if (parentTrip?.waypoints && Array.isArray(parentTrip.waypoints)) {
        const cleanedWps = (parentTrip.waypoints as any[]).filter(
          (wp: any) => wp.rideId !== rideId
        );

        if (parentTrip.fromLat && parentTrip.fromLng && parentTrip.toLat && parentTrip.toLng) {
          const origin = { lat: parentTrip.fromLat, lng: parentTrip.fromLng };
          const dest = { lat: parentTrip.toLat, lng: parentTrip.toLng };
          const optimized = await optimizeRouteOrder(origin, dest, cleanedWps);
          if (optimized) {
            tripUpdateFields.waypoints = optimized.optimizedWaypoints;
            tripUpdateFields.routePolyline = optimized.route.geometry;
            tripUpdateFields.routeDuration = optimized.route.duration;
            tripUpdateFields.routeDistance = optimized.route.distance;
          } else {
            tripUpdateFields.waypoints = cleanedWps;
          }
        } else {
          tripUpdateFields.waypoints = cleanedWps;
        }
      }

      await db.update(ridesTable).set(tripUpdateFields).where(eq(ridesTable.id, existing.tripId));
      req.log.info({ tripId: existing.tripId, releasedSeats: removedCount }, "Released seats on trip after ride cancel");

      const [updatedTrip] = await db.select().from(ridesTable).where(eq(ridesTable.id, existing.tripId));
      if (updatedTrip) broadcastToAll({ type: "trip_updated", trip: updatedTrip });
    }

    if (existing.driverId && !existing.tripId) {
      await db.update(usersTable)
        .set({ status: "online", cancelledOrders: sql`cancelled_orders + 1`, updatedAt: new Date() })
        .where(eq(usersTable.id, existing.driverId));
    }

    await db.update(orderOffersTable)
      .set({ status: "expired", respondedAt: new Date() })
      .where(and(eq(orderOffersTable.rideId, rideId), eq(orderOffersTable.status, "pending")));

    broadcastToAll({ type: "ride_updated", ride });
    notifyRideStatusChange(rideId, "cancelled").catch(() => {});
    res.json(ride);
  } catch (err) {
    req.log.error({ err }, "Cancel ride error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/:id/unassign-driver", authMiddleware, requireRole("dispatcher", "admin"), validateBody(unassignDriverBodySchema), async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.params.id);
    const [existing] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));

    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Заказ не найден" });
      return;
    }

    if (!existing.driverId) {
      res.status(400).json({ error: "no_driver", message: "На заказе нет водителя" });
      return;
    }

    // Allow unassign while the trip is still in progress too. The driver may have
    // already started ("В рейсе") but the dispatcher still needs to pull them off
    // and return the order to the efir. Passengers stay on the ride (not deleted);
    // steps below reset it to pending + free the driver + re-broadcast.
    if (!["offered", "accepted", "merged", "in_progress"].includes(existing.status as string)) {
      res.status(400).json({
        error: "invalid_state",
        message: "Снять водителя можно только до завершения поездки. Используйте полную отмену.",
      });
      return;
    }

    const previousDriverId = existing.driverId;

    // 0. НЕ предлагать тот же заказ этому же водителю в течение cooldown (2 мин).
    //    Read-side (isInUnassignCooldown) уже проверяется при подборе кандидатов
    //    в autodispatch — здесь активируем запись, которая ранее не вызывалась.
    if (previousDriverId != null) {
      // Await: the write must land in Redis BEFORE startAutoDispatch (below) reads
      // it, otherwise the just-removed driver could be re-offered the same ride.
      await addUnassignCooldown(rideId, previousDriverId);
    }

    // 1. остановим текущий dispatch loop (если ещё крутится)
    stopDispatchLoop(rideId);

    // 2. expire все pending offers по этому заказу
    await db.update(orderOffersTable)
      .set({ status: "expired", respondedAt: new Date() })
      .where(and(eq(orderOffersTable.rideId, rideId), eq(orderOffersTable.status, "pending")));

    // 3. освободим водителя (status=online), счётчик отказов НЕ инкрементируем (это диспетчер снял)
    await db.update(usersTable)
      .set({ status: "online", updatedAt: new Date() })
      .where(eq(usersTable.id, previousDriverId));

    // 4. сбросим заказ в pending без водителя
    const [ride] = await db.update(ridesTable)
      .set({ driverId: null, status: "pending", updatedAt: new Date() })
      .where(eq(ridesTable.id, rideId))
      .returning();

    // 5. точечно уведомим бывшего водителя (у него заказ должен исчезнуть с подсказкой)
    broadcastToUser(previousDriverId, {
      type: "ride_unassigned_by_dispatcher",
      rideId,
      message: "Диспетчер снял с вас этот заказ",
    });

    // 6. broadcast обновления заказа всем (диспетчерам)
    broadcastToAll({ type: "ride_updated", ride });

    // 7. перезапустим автодиспетчинг — заказ снова уйдёт другим водителям
    if (ride.fromCity) {
      startAutoDispatch(rideId, ride.fromCity).catch(err =>
        req.log.error({ err, rideId }, "Failed to restart auto-dispatch after unassign")
      );
    }

    req.log.info({ rideId, previousDriverId }, "Driver unassigned by dispatcher, ride re-queued");
    res.json(ride);
  } catch (err) {
    req.log.error({ err }, "Unassign driver error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/:id/optimize-route", authMiddleware, requireRole("dispatcher", "admin"), validateBody(optimizeRouteBodySchema), async (req: AuthRequest, res) => {
  try {
    const tripId = parseInt(req.params.id);
    const [trip] = await db.select().from(ridesTable).where(eq(ridesTable.id, tripId));

    if (!trip) {
      res.status(404).json({ error: "not_found", message: "Рейс не найден" });
      return;
    }

    if (!trip.fromLat || !trip.fromLng || !trip.toLat || !trip.toLng) {
      res.status(400).json({ error: "missing_coords", message: "У рейса нет координат" });
      return;
    }

    const waypoints = (Array.isArray(trip.waypoints) ? trip.waypoints : []) as Waypoint[];
    const origin = { lat: trip.fromLat, lng: trip.fromLng };
    const dest = { lat: trip.toLat, lng: trip.toLng };

    const optimized = await optimizeRouteOrder(origin, dest, waypoints);
    if (!optimized) {
      res.status(500).json({ error: "optimization_failed", message: "Не удалось оптимизировать маршрут" });
      return;
    }

    const [updated] = await db.update(ridesTable)
      .set({
        waypoints: optimized.optimizedWaypoints,
        routePolyline: optimized.route.geometry,
        routeDuration: optimized.route.duration,
        routeDistance: optimized.route.distance,
        updatedAt: new Date(),
      })
      .where(eq(ridesTable.id, tripId))
      .returning();

    broadcastToAll({ type: "trip_updated", trip: updated });
    req.log.info({ tripId, duration: optimized.route.duration, stops: optimized.optimizedWaypoints.length }, "Route optimized");

    res.json({
      trip: updated,
      optimization: {
        duration: optimized.route.duration,
        distance: optimized.route.distance,
        waypointCount: optimized.optimizedWaypoints.length,
        previousDuration: trip.routeDuration,
        savedMinutes: (trip.routeDuration ?? 0) - optimized.route.duration,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Optimize route error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


export default router;
