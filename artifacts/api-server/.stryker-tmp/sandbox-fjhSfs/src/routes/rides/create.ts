// @ts-nocheck
import { errorMessage } from "../../lib/errors.js";
import { Router, type IRouter } from "express";
import { clog } from "../../lib/logger.js";
import { db, ridesTable, usersTable, tariffsTable, orderOffersTable, ridePassengersTable, districtsTable, settingsTable, routesTable, routeOptionsTable, transactionsTable, driverGroupsTable, citiesTable } from "@workspace/db";
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

const router: IRouter = Router();

router.post("/", validateBody(createRideBodySchema), async (req, res) => {
  try {
    const { fromCity, toCity, fromAddress, toAddress, scheduledAt, passengers, carClass, riderName, riderPhone, paymentType, comment, seats, fromDistrictId, toDistrictId, timeSlot, isUrgent, roundTrip, selectedOptions, gender, isMail, isMoney, requiredCarModel } = req.body;

    if (!fromCity || !toCity) {
      res.status(400).json({ error: "validation_error", message: "fromCity and toCity are required" });
      return;
    }

    let userRole: string | null = null;
    let creatorUserId: number | null = null;
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        if (token) {
          const decoded = jwt.verify(token, JWT_SECRET) as any;
          if (decoded && decoded.role && decoded.userId) {
            userRole = decoded.role;
            creatorUserId = Number(decoded.userId);
          }
        }
      }
    } catch (err) {
      if (config.isDevelopment) {
        clog.warn("JWT parse failed:", errorMessage(err));
      }
    }
    const isDispatcher = userRole === "dispatcher" || userRole === "admin";
    let creatorUserName: string | null = null;
    if (creatorUserId && isDispatcher) {
      try {
        const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, creatorUserId));
        if (u) creatorUserName = u.name;
      } catch {}
    }

    const mktCfg = await getMarketplaceSettings();

    if (!isDispatcher) {
      const maxActive = parseInt(mktCfg.max_active_orders) || 20;
      const maxPerDay = parseInt(mktCfg.max_orders_per_day) || 30;

      const [{ activeCount }] = await db.select({ activeCount: sql<number>`count(*)` })
        .from(ridesTable)
        .where(inArray(ridesTable.status, ["pending", "accepted", "in_progress"]));
      if (Number(activeCount) >= maxActive) {
        res.status(429).json({ error: "limit_exceeded", message: `Достигнут лимит активных заказов (${maxActive})` });
        return;
      }

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const [{ dayCount }] = await db.select({ dayCount: sql<number>`count(*)` })
        .from(ridesTable)
        .where(gte(ridesTable.createdAt, todayStart));
      if (Number(dayCount) >= maxPerDay) {
        res.status(429).json({ error: "limit_exceeded", message: `Достигнут суточный лимит заказов (${maxPerDay})` });
        return;
      }
    }

    const seatCount = Array.isArray(seats) ? seats.length : (passengers || 1);
    const tariff = carClass || "economy";
    const est = await calcPrice(fromCity, toCity, 1, tariff);

    let fromDistrictCharge = 0;
    let toDistrictCharge = 0;
    let fromDistrictData: any = null;
    let toDistrictData: any = null;

    if (fromDistrictId) {
      const [d] = await db.select().from(districtsTable).where(eq(districtsTable.id, Number(fromDistrictId)));
      if (d) { fromDistrictCharge = d.extraCharge; fromDistrictData = d; }
    }
    if (toDistrictId) {
      const [d] = await db.select().from(districtsTable).where(eq(districtsTable.id, Number(toDistrictId)));
      if (d) { toDistrictCharge = d.extraCharge; toDistrictData = d; }
    }

    const seatsArray = Array.isArray(seats) ? seats : [];
    const hasFrontSeat = seatsArray.some((s: any) => s.seatNumber === 1);
    const frontCount = hasFrontSeat ? 1 : 0;
    const backCount = seatsArray.filter((s: any) => s.seatNumber !== 1).length;

    let basePrice = 0;
    basePrice += frontCount * (est.priceFront || 0);
    basePrice += backCount * (est.priceBack || 0);
    if (basePrice <= 0 && seatCount > 0) {
      basePrice = seatCount * (est.priceBack || est.price || 0);
    }

    // MAIL ORDER: override price from route.priceMail, no seat occupancy
    const isMailOrder = isMail === true;
    if (isMailOrder) {
      try {
        const [matchedRoute] = await db.select().from(routesTable)
          .where(and(eq(routesTable.fromCity, fromCity), eq(routesTable.toCity, toCity)));
        const mailPrice = matchedRoute && (matchedRoute as any).priceMail ? (matchedRoute as any).priceMail : 0;
        basePrice = mailPrice;
      } catch (e) { req.log?.warn?.({ e }, "mail price lookup failed"); }
    }

    let optionsTotal = 0;
    let optionsCommission = 0;
    if (Array.isArray(selectedOptions) && selectedOptions.length > 0 && est.routeId) {
      const routeOpts = await db.select().from(routeOptionsTable)
        .where(and(
          eq(routeOptionsTable.routeId, est.routeId),
          eq(routeOptionsTable.tariffClass, tariff),
          eq(routeOptionsTable.isActive, true)
        ));
      const optsMap = new Map(routeOpts.map(o => [o.optionKey, o]));
      const validOptions = [...new Set(selectedOptions as string[])].filter((key: string) => optsMap.has(key));
      for (const key of validOptions) {
        const opt = optsMap.get(key);
        if (opt) { optionsTotal += opt.price; optionsCommission += (opt.commission || 0); }
      }
    }

    let finalPrice = basePrice + (fromDistrictCharge || 0) + (toDistrictCharge || 0) + optionsTotal;

    if (roundTrip === true) {
      const total = finalPrice * 2;
      let discountPercent = est.roundTripDiscountPercent ?? 0;
      if (discountPercent < 0) discountPercent = 0;
      if (discountPercent > 100) discountPercent = 100;
      const discountAmount = Math.round(total * (discountPercent / 100));
      finalPrice = total - discountAmount;
      if (finalPrice <= 0) finalPrice = total;
    }

    if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
      finalPrice = seatCount * (est.priceBack || est.price || 0);
    }

    clog.log("SAVE RIDE:", { seats: seatsArray.length, frontCount, backCount, priceFront: est.priceFront, priceBack: est.priceBack, basePrice, finalPrice, fromDistrictCharge, toDistrictCharge, optionsTotal, roundTrip });

    const fromCityData = findCity(fromCity);
    const toCityData = findCity(toCity);

    const fromLat = fromDistrictData?.lat || fromCityData?.lat || null;
    const fromLng = fromDistrictData?.lng || fromCityData?.lng || null;
    const toLat = toDistrictData?.lat || toCityData?.lat || null;
    const toLng = toDistrictData?.lng || toCityData?.lng || null;

    const scheduledDate = scheduledAt ? new Date(scheduledAt) : new Date();
    const msUntilScheduled = scheduledDate.getTime() - Date.now();
    const computedUrgent = isUrgent === true || (msUntilScheduled >= 0 && msUntilScheduled <= 10 * 60 * 1000);

    if (!est.distance || est.distance <= 0) {
      req.log.error({ fromCity, toCity, distance: est.distance }, "[ERROR] MATCH_FAILED: NO_PRICE — distance is zero or null");
      res.status(400).json({ error: "no_price", message: "Ошибка расчёта маршрута — расстояние не определено" });
      return;
    }

    const minOrderPrice = parseInt(mktCfg.min_order_price) || 0;
    const maxOrderPrice = parseInt(mktCfg.max_order_price) || 5000000;
    if (finalPrice < minOrderPrice) {
      res.status(400).json({ error: "price_too_low", message: `Цена заказа ниже минимума (${minOrderPrice.toLocaleString("ru-RU")} сум)` });
      return;
    }
    if (finalPrice > maxOrderPrice) {
      res.status(400).json({ error: "price_too_high", message: `Цена заказа превышает максимум (${maxOrderPrice.toLocaleString("ru-RU")} сум)` });
      return;
    }

    let requiredGroupLevel: number | null = null;
    if (tariff) {
      const [matchedGroup] = await db.select().from(driverGroupsTable).where(eq(driverGroupsTable.name, tariff));
      if (matchedGroup) {
        requiredGroupLevel = matchedGroup.level;
      }
    }

    {
      const __sc = await __getRequesterBranchScope(req);
      (req as any).__creatorBranchId = __sc.branchId;
    }
    const ride = await createRide({
      fromCity, toCity, fromAddress, toAddress,
      scheduledAt: scheduledDate,
      passengers: isMailOrder ? 0 : seatCount,
      carClass: tariff,
      status: "pending",
      price: finalPrice,
      isMail: isMailOrder,
      isMoney: isMailOrder && isMoney === true,
      requiredCarModel: (typeof requiredCarModel === "string" && requiredCarModel.trim()) ? requiredCarModel.trim() : null,
        branchId: (req as any).__creatorBranchId ?? null,
        optionsTotal: Math.round(optionsTotal || 0),
        optionsCommission: Math.round(optionsCommission || 0),
      distance: est.distance,
      duration: est.duration,
      riderName, riderPhone,
      paymentType: paymentType || "cash",
      comment: comment || null,
      fromLat, fromLng, toLat, toLng,
      fromDistrictId: fromDistrictData?.id || null,
      toDistrictId: toDistrictData?.id || null,
      fromDistrictName: fromDistrictData?.name || null,
      toDistrictName: toDistrictData?.name || null,
      fromDistrictCharge,
      toDistrictCharge,
      basePrice,
      timeSlot: timeSlot || null,
      isUrgent: computedUrgent,
      roundTrip: roundTrip === true,
      source: computedUrgent ? "urgent" : "dispatch",
      mode: computedUrgent ? "market" : "dispatch",
      requiredGroupLevel,
      selectedOptions: Array.isArray(selectedOptions) ? (selectedOptions as string[]).filter((k: any) => typeof k === "string") : [],
      createdByUserId: creatorUserId,
      createdByUserName: creatorUserName,
    });

    if (!isMailOrder && Array.isArray(seats) && seats.length > 0) {
      for (const seat of seats) {
        await db.insert(ridePassengersTable).values({
          rideId: ride.id,
          name: seat.name || "",
          phone: seat.phone || null,
          pickupAddress: seat.pickupAddress || null,
          dropoffAddress: seat.dropoffAddress || null,
          pickupLat: seat.pickupLat != null ? Number(seat.pickupLat) : null,
          pickupLng: seat.pickupLng != null ? Number(seat.pickupLng) : null,
          seatNumber: seat.seatNumber || 1,
          price: Number(seat.price) || 0,
          baggageType: seat.baggageType || "none",
          gender: seat.gender || gender || "male",
        });
      }
    } else if (seatCount > 0) {
      const perSeatPrice = Math.round(finalPrice / seatCount);
      for (let i = 1; i <= seatCount; i++) {
        await db.insert(ridePassengersTable).values({
          rideId: ride.id,
          name: riderName || "",
          phone: riderPhone || null,
          seatNumber: i,
          price: perSeatPrice,
          baggageType: "none",
          gender: gender || "male",
        });
      }
    }

    const ridePassengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, ride.id));

    clog.log("PASSENGERS:", {
      rideId: ride.id,
      seats: Array.isArray(seats) ? seats.length : 0,
      passengersCount: ridePassengers.length,
      seatCount,
      storedPassengers: ride.passengers,
    });

    broadcastToAll({ type: "new_ride", ride: { ...ride, seatPassengers: enrichPassengersWithRouteInfo(ridePassengers, ride) } });

    if (isBatchEnabled()) {
      req.log.info({ rideId: ride.id }, "Ride created, added to batch buffer");
      addToBuffer(ride.id, fromCity, toCity, carClass || "economy");
    } else {
      req.log.info({ rideId: ride.id, seats: ridePassengers.length }, "Ride created, dispatching");
      startAutoDispatch(ride.id, fromCity).catch(err =>
        req.log.error({ err, rideId: ride.id }, "Auto-dispatch error")
      );
    }

    res.status(201).json({ ...ride, seatPassengers: enrichPassengersWithRouteInfo(ridePassengers, ride) });
  } catch (err) {
    clog.error("CREATE RIDE ERROR:", err);
    req.log.error({ err }, "Create ride error");
    res.status(500).json({ error: "server_error", message: errorMessage(err) || "Internal server error" });
  }
});


export default router;
