import { Router } from "express";
import { db, marketplaceListingsTable, ridesTable, usersTable, transactionsTable, routesTable, districtsTable, ridePassengersTable, orderOffersTable } from "@workspace/db";
import { eq, and, ne, sql, desc, count, isNull, isNotNull, inArray } from "drizzle-orm";
import { authMiddleware, requireRole, AuthRequest } from "../middlewares/auth.js";
import { broadcastToUser, broadcastToAll } from "../lib/websocket.js";
import { logger } from "../lib/logger.js";
import { resolveCitySlug } from "../lib/route-match.js";
import { getSettingNum } from "../lib/settingsCache.js";
import { getMarketplaceSettings } from "../lib/settings.js";
import { startMarketplaceDispatch, stopDispatchLoop } from "../lib/autodispatch.js";
import { getSettingNum } from "../lib/settingsCache.js";

const CITIES_RU_TO_ID: Record<string, string> = {
  "бухара": "bukhara", "самарканд": "samarkand", "ташкент": "tashkent",
  "наманган": "namangan", "андижан": "andijan", "фергана": "fergana",
  "нукус": "nukus", "ургенч": "urgench", "карши": "qarshi",
  "термез": "termez", "джиззах": "jizzakh", "навои": "navoiy",
};
function routeCityToId(cityName: string): string {
  return CITIES_RU_TO_ID[cityName.toLowerCase()] || cityName.toLowerCase();
}

const router = Router();

const MAX_ACTIVE_SALES = 20;

router.post("/sell", authMiddleware, requireRole("driver"), async (req: AuthRequest, res) => {
  try {
    const sellerId = req.userId!;
    const { rideId, price, comment } = req.body;

    if (!rideId || !price || price <= 0) {
      return res.status(400).json({ message: "rideId and positive price required" });
    }

    const result = await db.transaction(async (tx) => {
      const [ride] = await tx.select().from(ridesTable).where(eq(ridesTable.id, rideId)).for("update");
      if (!ride) return { error: "Ride not found", status: 404 };
      if (ride.driverId !== sellerId) return { error: "You can only sell your own rides", status: 403 };
      if (ride.status !== "accepted" && ride.status !== "pending") {
        return { error: "Can only sell rides with status accepted or pending", status: 400 };
      }

      const [existing] = await tx.select().from(marketplaceListingsTable)
        .where(and(
          eq(marketplaceListingsTable.rideId, rideId),
          eq(marketplaceListingsTable.status, "active")
        ));
      if (existing) return { error: "This ride is already listed for sale", status: 400 };

      const [{ cnt }] = await tx.select({ cnt: count() }).from(marketplaceListingsTable)
        .where(and(
          eq(marketplaceListingsTable.sellerId, sellerId),
          eq(marketplaceListingsTable.status, "active")
        ));
      if (Number(cnt) >= MAX_ACTIVE_SALES) {
        return { error: `Maximum ${MAX_ACTIVE_SALES} active listings allowed`, status: 400 };
      }

      const [listing] = await tx.insert(marketplaceListingsTable).values({
        rideId,
        sellerId,
        price,
        comment: comment || null,
        status: "active",
        fromCity: ride.fromCity,
        toCity: ride.toCity,
        scheduledAt: ride.scheduledAt,
        seatsCount: ride.passengers,
      }).returning();

      return { listing };
    });

    if ("error" in result) {
      return res.status(result.status || 400).json({ message: result.error });
    }

    broadcastToAll({ type: "marketplace_new_listing", listing: result.listing });
    logger.info({ rideId, sellerId, price }, "New marketplace listing created");

    res.json({ listing: result.listing });
  } catch (err) {
    logger.error({ err }, "Error creating marketplace listing");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/sell-order", authMiddleware, requireRole("driver"), async (req: AuthRequest, res) => {
  try {
    const sellerId = req.userId!;
    const { routeId, fromDistrictId, toDistrictId, scheduledAt, clientPhone, seatsCount, baggageType, price, comment, gender, genders } = req.body;

    if (!routeId) {
      return res.status(400).json({ message: "routeId required" });
    }
    const [route] = await db.select().from(routesTable).where(eq(routesTable.id, Number(routeId)));
    if (!route || !route.isActive) {
      return res.status(400).json({ message: "Invalid or inactive route" });
    }
    if (!clientPhone || typeof clientPhone !== "string" || clientPhone.trim().length < 9) {
      return res.status(400).json({ message: "Client phone required" });
    }
    if (scheduledAt && isNaN(new Date(scheduledAt).getTime())) {
      return res.status(400).json({ message: "Valid scheduledAt required" });
    }
    const seats = Array.isArray(seatsCount) ? seatsCount.map(Number).filter(n => n >= 1 && n <= 4) : [];
    if (seats.length === 0) {
      return res.status(400).json({ message: "Select at least one seat (1-4)" });
    }
    const totalSeats = seats.length;

    let fromDistrictCharge = 0;
    let toDistrictCharge = 0;
    const fromCityId = routeCityToId(route.fromCity);
    const toCityId = routeCityToId(route.toCity);

    if (fromDistrictId) {
      const [d] = await db.select().from(districtsTable).where(eq(districtsTable.id, Number(fromDistrictId)));
      if (!d || !d.isActive) return res.status(400).json({ message: "Invalid from-district" });
      if (d.cityId !== fromCityId) return res.status(400).json({ message: "From-district does not match route origin city" });
      fromDistrictCharge = d.extraCharge;
    }
    if (toDistrictId) {
      const [d] = await db.select().from(districtsTable).where(eq(districtsTable.id, Number(toDistrictId)));
      if (!d || !d.isActive) return res.status(400).json({ message: "Invalid to-district" });
      if (d.cityId !== toCityId) return res.status(400).json({ message: "To-district does not match route destination city" });
      toDistrictCharge = d.extraCharge;
    }

    const perSeatPrice = (route.priceEconomy || 0) + fromDistrictCharge + toDistrictCharge;
    const minPrice = perSeatPrice * totalSeats;

    const parsedPrice = parseFloat(price);
    if (!parsedPrice || parsedPrice < minPrice) {
      return res.status(400).json({ message: `Price must be at least ${minPrice} сум`, minPrice });
    }

    const [{ cnt }] = await db.select({ cnt: count() }).from(marketplaceListingsTable)
      .where(and(
        eq(marketplaceListingsTable.sellerId, sellerId),
        eq(marketplaceListingsTable.status, "active")
      ));
    if (Number(cnt) >= MAX_ACTIVE_SALES) {
      return res.status(400).json({ message: `Maximum ${MAX_ACTIVE_SALES} active listings allowed` });
    }

    const scheduledDate = scheduledAt ? new Date(scheduledAt) : new Date();

    const { ride, listing } = await db.transaction(async (tx) => {
      const [ride] = await tx.insert(ridesTable).values({
        fromCity: route.fromCity,
        toCity: route.toCity,
        scheduledAt: scheduledDate,
        passengers: totalSeats,
        status: "pending",
        price: parsedPrice,
        riderPhone: clientPhone.trim(),
        riderName: "",
        fromDistrictId: fromDistrictId ? Number(fromDistrictId) : null,
        toDistrictId: toDistrictId ? Number(toDistrictId) : null,
        basePrice: minPrice,
        source: "marketplace",
        mode: "market",
        isUrgent: true,
        paymentType: "cash",
      }).returning();

      const normalizeGender = (g: any): "male" | "female" | null => {
        if (g === "male" || g === "female") return g;
        return null;
      };
      const perSeatGender: ("male" | "female" | null)[] = Array.isArray(genders)
        ? seats.map((_, i) => normalizeGender(genders[i]))
        : seats.map(() => normalizeGender(gender));

      for (let i = 0; i < totalSeats; i++) {
        await tx.insert(ridePassengersTable).values({
          rideId: ride.id,
          name: "",
          phone: clientPhone.trim(),
          seatNumber: seats[i] || (i + 1),
          price: Math.round(parsedPrice / totalSeats),
          baggageType: baggageType || "none",
          gender: perSeatGender[i] ?? "male",
        });
      }

      const [listing] = await tx.insert(marketplaceListingsTable).values({
        sellerId,
        rideId: ride.id,
        price: parsedPrice,
        comment: comment || null,
        status: "active",
        fromCity: route.fromCity,
        toCity: route.toCity,
        scheduledAt: scheduledDate,
        clientPhone: clientPhone.trim(),
        seatsCount: totalSeats,
        baggageType: baggageType || null,
        fromDistrictId: fromDistrictId ? Number(fromDistrictId) : null,
        toDistrictId: toDistrictId ? Number(toDistrictId) : null,
        routeId: route.id,
        basePrice: minPrice,
      }).returning();

      return { ride, listing };
    });

    broadcastToAll({ type: "marketplace_new_listing", listing });
    broadcastToAll({ type: "new_ride", ride });

    startMarketplaceDispatch(ride.id, route.fromCity, listing.id).catch(err =>
      logger.error({ err, rideId: ride.id }, "Marketplace auto-dispatch error")
    );

    logger.info({ sellerId, rideId: ride.id, listingId: listing.id, price: parsedPrice, fromCity: route.fromCity, toCity: route.toCity, seats }, "New marketplace listing created with ride + auto-dispatch");

    res.json({ listing: { ...listing, rideId: ride.id } });
  } catch (err) {
    logger.error({ err }, "Error creating standalone marketplace listing");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/buy", authMiddleware, requireRole("driver"), async (req: AuthRequest, res) => {
  try {
    const buyerId = req.userId!;
    const { listingId } = req.body;

    if (!listingId) return res.status(400).json({ message: "listingId required" });

    const [buyer] = await db.select().from(usersTable).where(eq(usersTable.id, buyerId));
    if (!buyer) return res.status(404).json({ message: "Driver not found" });

    const balance = parseFloat(buyer.balance?.toString() || "0");
    const minBalance = getSettingNum("min_driver_balance", 0);
    if (balance < minBalance) {
      const balStr = Math.floor(balance).toLocaleString("ru-RU");
      const minStr = minBalance.toLocaleString("ru-RU");
      return res.status(403).json({ message: `Недостаточно средств (${balStr} сум). Минимум для работы: ${minStr} сум.` });
    }

    class BuyError extends Error { constructor(msg: string) { super(msg); } }

    let result: { listing: any; ride: any; matchedRouteRide: any };
    try {
      result = await db.transaction(async (tx) => {
      // [ADVISORY_LOCK] сериализация buy на уровне buyer
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${buyerId})`);
        const [listing] = await tx.select().from(marketplaceListingsTable)
          .where(and(
            eq(marketplaceListingsTable.id, listingId),
            eq(marketplaceListingsTable.status, "active")
          ))
          .for("update");

        if (!listing) throw new BuyError("Объявление уже продано или недоступно");
        if (listing.sellerId === buyerId) throw new BuyError("Нельзя купить своё объявление");

        if (listing.rideId) {
          const [ride] = await tx.select().from(ridesTable)
            .where(and(
              eq(ridesTable.id, listing.rideId),
              inArray(ridesTable.status, ["pending", "offered"]),
            ))
            .for("update");

          if (!ride) throw new BuyError("Заказ уже принят другим водителем");

          const [acceptedRide] = await tx.update(ridesTable).set({
            driverId: buyerId,
            driverName: buyer.name,
            driverPhone: buyer.phone,
            driverCar: buyer.carModel,
            driverCarNumber: buyer.carNumber,
            driverRating: buyer.rating ? parseFloat(buyer.rating) : null,
            status: "accepted",
            version: sql`COALESCE(${ridesTable.version}, 0) + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(ridesTable.id, listing.rideId), inArray(ridesTable.status, ["pending", "offered"])))
          .returning();

          if (!acceptedRide) throw new BuyError("Заказ уже принят другим водителем");

          await tx.update(marketplaceListingsTable).set({
            buyerId,
            status: "sold",
            updatedAt: new Date(),
          }).where(eq(marketplaceListingsTable.id, listingId));

          const { citiesMatch } = await import("../lib/autodispatch.js");
          const buyerActiveRoutes = await tx.select().from(ridesTable).where(
            and(eq(ridesTable.driverId, buyerId), eq(ridesTable.status, "accepted"), ne(ridesTable.id, listing.rideId))
          );
          const matchedRouteRide = buyerActiveRoutes.find(r =>
            citiesMatch(r.fromCity, ride.fromCity) && citiesMatch(r.toCity, ride.toCity)
          ) || null;

          if (matchedRouteRide) {
            const [lockedRoute] = await tx.select().from(ridesTable)
              .where(eq(ridesTable.id, matchedRouteRide.id))
              .for("update");

            if (lockedRoute) {
              const routePassengers = await tx.select({ id: ridePassengersTable.id })
                .from(ridePassengersTable).where(eq(ridePassengersTable.rideId, lockedRoute.id));
              const ridePaxRows = await tx.select()
                .from(ridePassengersTable).where(eq(ridePassengersTable.rideId, listing.rideId));
              const rideSeats = ridePaxRows.length > 0 ? ridePaxRows.length : (ride.passengers || 1);
              const totalSeats = buyer.seats || 4;

              if (routePassengers.length + rideSeats <= totalSeats) {
                const occupiedSeatsMkt = new Set<number>(
                  (await tx.select({ seatNumber: ridePassengersTable.seatNumber })
                    .from(ridePassengersTable).where(eq(ridePassengersTable.rideId, lockedRoute.id)))
                    .map(p => p.seatNumber).filter((n): n is number => n != null)
                );
                function nextFreeMkt(): number {
                  for (let i = 1; i <= totalSeats; i++) {
                    if (!occupiedSeatsMkt.has(i)) { occupiedSeatsMkt.add(i); return i; }
                  }
                  return -1;
                }
                if (ridePaxRows.length > 0) {
                  for (const pax of ridePaxRows) {
                    let seatToAssign: number;
                    if (pax.seatNumber != null && pax.seatNumber >= 1 && pax.seatNumber <= totalSeats && !occupiedSeatsMkt.has(pax.seatNumber)) {
                      seatToAssign = pax.seatNumber;
                      occupiedSeatsMkt.add(pax.seatNumber);
                    } else {
                      seatToAssign = nextFreeMkt();
                    }
                    await tx.insert(ridePassengersTable).values({
                      rideId: lockedRoute.id,
                      name: pax.name || ride.riderName || "Пассажир",
                      phone: pax.phone || ride.riderPhone || "",
                      pickupAddress: pax.pickupAddress || (ride.fromDistrictName ? `${ride.fromDistrictName} (${ride.fromCity})` : null) || ride.fromAddress || ride.fromCity,
                      dropoffAddress: pax.dropoffAddress || (ride.toDistrictName ? `${ride.toDistrictName} (${ride.toCity})` : null) || ride.toAddress || ride.toCity,
                      pickupLat: pax.pickupLat != null ? Number(pax.pickupLat) : (ride.fromLat ? Number(ride.fromLat) : null),
                      pickupLng: pax.pickupLng != null ? Number(pax.pickupLng) : (ride.fromLng ? Number(ride.fromLng) : null),
                      seatNumber: seatToAssign,
                      price: Number(pax.price) || 0,
                      baggageType: pax.baggageType || "none",
                      source: "marketplace",
                      externalKey: `merged-ride-${listing.rideId}`,
                    });
                  }
                } else {
                  const perSeatPrice = Math.round((Number(ride.price) || 0) / rideSeats);
                  for (let i = 0; i < rideSeats; i++) {
                    const seatToAssign = nextFreeMkt();
                    await tx.insert(ridePassengersTable).values({
                      rideId: lockedRoute.id,
                      name: ride.riderName || "Пассажир",
                      phone: ride.riderPhone || "",
                      pickupAddress: (ride.fromDistrictName ? `${ride.fromDistrictName} (${ride.fromCity})` : null) || ride.fromAddress || ride.fromCity,
                      dropoffAddress: (ride.toDistrictName ? `${ride.toDistrictName} (${ride.toCity})` : null) || ride.toAddress || ride.toCity,
                      seatNumber: seatToAssign,
                      price: perSeatPrice,
                      baggageType: "none",
                      source: "marketplace",
                      externalKey: `merged-ride-${listing.rideId}`,
                    });
                  }
                }

                await tx.update(ridesTable).set({
                  tripId: lockedRoute.id,
                  status: "merged" as any,
                  updatedAt: new Date(),
                }).where(eq(ridesTable.id, listing.rideId));
                console.log(`[MERGE-MARKET] ride ${listing.rideId} marked as merged into trip ${lockedRoute.id}`);

                const actualCount = await tx.select({ cnt: count() })
                  .from(ridePassengersTable).where(eq(ridePassengersTable.rideId, lockedRoute.id));
                const newCount = Number(actualCount[0]?.cnt) || 0;
                await tx.update(ridesTable)
                  .set({ passengers: newCount, seatsTaken: newCount, updatedAt: new Date() })
                  .where(eq(ridesTable.id, lockedRoute.id));

                logger.info({ rideId: listing.rideId, tripId: lockedRoute.id, newCount }, "Marketplace buy: merged into existing trip");
              }
            }
          }

          await tx.update(orderOffersTable)
            .set({ status: "expired", respondedAt: new Date() })
            .where(and(
              eq(orderOffersTable.rideId, listing.rideId),
              eq(orderOffersTable.status, "pending"),
            ));

          const [updatedRide] = await tx.select().from(ridesTable).where(eq(ridesTable.id, listing.rideId));
          return { listing: { ...listing, buyerId, status: "sold" as const }, ride: updatedRide, matchedRouteRide };
        }

        await tx.update(marketplaceListingsTable).set({
          buyerId,
          status: "sold",
          updatedAt: new Date(),
        }).where(eq(marketplaceListingsTable.id, listingId));

        return { listing: { ...listing, buyerId, status: "sold" as const }, ride: null, matchedRouteRide: null };
      });
    } catch (err) {
      if (err instanceof BuyError) {
        return res.status(400).json({ message: err.message });
      }
      throw err;
    }

    if (result.listing.rideId) {
      stopDispatchLoop(result.listing.rideId);
    }

    if (!result.matchedRouteRide) {
      await db.update(usersTable).set({ status: "busy", updatedAt: new Date() }).where(eq(usersTable.id, buyerId));
    }

    broadcastToUser(result.listing.sellerId, {
      type: "marketplace_order_sold",
      listingId,
      buyerId,
      rideId: result.listing.rideId,
    });
    broadcastToAll({ type: "marketplace_listing_sold", listingId });
    if (result.ride) {
      broadcastToAll({ type: "ride_updated", ride: result.ride });
    }
    if (result.matchedRouteRide) {
      const [parentTrip] = await db.select().from(ridesTable).where(eq(ridesTable.id, result.matchedRouteRide.id));
      if (parentTrip) {
        broadcastToAll({ type: "ride_updated", ride: parentTrip });
        broadcastToUser(buyerId, { type: "route_updated", ride: parentTrip });
      }
    }

    logger.info({ listingId, buyerId, rideId: result.listing.rideId }, "Marketplace order bought and accepted");
    res.json({ message: "Order bought successfully", listing: result.listing, ride: result.ride });
  } catch (err) {
    logger.error({ err }, "Error buying marketplace listing");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/listings", authMiddleware, requireRole("driver"), async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const listings = await db.select({
      id: marketplaceListingsTable.id,
      rideId: marketplaceListingsTable.rideId,
      sellerId: marketplaceListingsTable.sellerId,
      price: marketplaceListingsTable.price,
      comment: marketplaceListingsTable.comment,
      status: marketplaceListingsTable.status,
      createdAt: marketplaceListingsTable.createdAt,
      fromCity: marketplaceListingsTable.fromCity,
      toCity: marketplaceListingsTable.toCity,
      scheduledAt: marketplaceListingsTable.scheduledAt,
      seatsCount: marketplaceListingsTable.seatsCount,
      clientName: marketplaceListingsTable.clientName,
      clientPhone: marketplaceListingsTable.clientPhone,
      baggageType: marketplaceListingsTable.baggageType,
      basePrice: marketplaceListingsTable.basePrice,
      routeId: marketplaceListingsTable.routeId,
      fromDistrictId: marketplaceListingsTable.fromDistrictId,
      toDistrictId: marketplaceListingsTable.toDistrictId,
      rideFromCity: ridesTable.fromCity,
      rideToCity: ridesTable.toCity,
      rideScheduledAt: ridesTable.scheduledAt,
      passengers: ridesTable.passengers,
      carClass: ridesTable.carClass,
      ridePrice: ridesTable.price,
      sellerName: usersTable.name,
      sellerPhone: usersTable.phone,
      sellerCar: usersTable.carModel,
      sellerCarNumber: usersTable.carNumber,
      sellerRating: usersTable.rating,
    })
    .from(marketplaceListingsTable)
    .leftJoin(ridesTable, eq(marketplaceListingsTable.rideId, ridesTable.id))
    .innerJoin(usersTable, eq(marketplaceListingsTable.sellerId, usersTable.id))
    .where(and(
      eq(marketplaceListingsTable.status, "active"),
      ne(marketplaceListingsTable.sellerId, userId)
    ))
    .orderBy(desc(marketplaceListingsTable.createdAt));

    // Фильтр: показываем листинг только водителям, чей активный маршрут (или последний маршрут)
    // совпадает по from/to и попадает во временное окно листинга.
    const driverRoutes = await db.select({
      fromCity: ridesTable.fromCity,
      toCity: ridesTable.toCity,
      scheduledAt: ridesTable.scheduledAt,
      timeSlot: ridesTable.timeSlot,
    })
      .from(ridesTable)
      .where(and(
        eq(ridesTable.driverId, userId),
        inArray(ridesTable.status, ["accepted", "in_progress"]),
      ));

    const windowMin = getSettingNum("time_window_minutes", 60);
    const windowMs = windowMin * 60 * 1000;

    function timeSlotRangeMs(slot: string | null, base: Date): [number, number] | null {
      if (!slot) return null;
      const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(slot);
      if (!m) return null;
      const start = new Date(base); start.setHours(parseInt(m[1],10), parseInt(m[2],10), 0, 0);
      const end   = new Date(base); end.setHours(parseInt(m[3],10), parseInt(m[4],10), 0, 0);
      return [start.getTime(), end.getTime()];
    }

    function listingMatchesAnyRoute(l: any): boolean {
      if (driverRoutes.length === 0) return false;
      const lFrom = resolveCitySlug(l.fromCity || l.rideFromCity || "");
      const lTo   = resolveCitySlug(l.toCity   || l.rideToCity   || "");
      if (!lFrom || !lTo) return false;
      const lSched = l.scheduledAt || l.rideScheduledAt;
      const lSchedMs = lSched ? new Date(lSched).getTime() : null;
      for (const r of driverRoutes) {
        const rFrom = resolveCitySlug(r.fromCity || "");
        const rTo   = resolveCitySlug(r.toCity   || "");
        if (rFrom !== lFrom || rTo !== lTo) continue;
        // Время: если у обоих time_slot — не критично здесь, фронт уже знает; иначе ±windowMin
        const rSchedMs = r.scheduledAt ? new Date(r.scheduledAt).getTime() : null;
        if (lSchedMs == null || rSchedMs == null) return true; // без времени — match по cities
        if (Math.abs(rSchedMs - lSchedMs) <= windowMs) return true;
        // time_slot пересечение
        const lRange = timeSlotRangeMs(null, new Date(lSchedMs));
        const rRange = r.timeSlot ? timeSlotRangeMs(r.timeSlot, new Date(rSchedMs)) : null;
        if (rRange && lSchedMs >= rRange[0] - windowMs && lSchedMs <= rRange[1] + windowMs) return true;
      }
      return false;
    }

    const filtered = listings.filter(listingMatchesAnyRoute);

    const normalized = filtered.map(l => ({
      ...l,
      fromCity: l.fromCity || l.rideFromCity,
      toCity: l.toCity || l.rideToCity,
      scheduledAt: l.scheduledAt || l.rideScheduledAt,
      passengers: l.seatsCount || l.passengers,
    }));

    res.json({ listings: normalized });
  } catch (err) {
    logger.error({ err }, "Error fetching marketplace listings");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/my-sales", authMiddleware, requireRole("driver"), async (req: AuthRequest, res) => {
  try {
    const sellerId = req.userId!;
    const listings = await db.select({
      id: marketplaceListingsTable.id,
      rideId: marketplaceListingsTable.rideId,
      sellerId: marketplaceListingsTable.sellerId,
      buyerId: marketplaceListingsTable.buyerId,
      price: marketplaceListingsTable.price,
      comment: marketplaceListingsTable.comment,
      status: marketplaceListingsTable.status,
      createdAt: marketplaceListingsTable.createdAt,
      updatedAt: marketplaceListingsTable.updatedAt,
      fromCity: marketplaceListingsTable.fromCity,
      toCity: marketplaceListingsTable.toCity,
      scheduledAt: marketplaceListingsTable.scheduledAt,
      clientName: marketplaceListingsTable.clientName,
      clientPhone: marketplaceListingsTable.clientPhone,
      seatsCount: marketplaceListingsTable.seatsCount,
      baggageType: marketplaceListingsTable.baggageType,
      basePrice: marketplaceListingsTable.basePrice,
      routeId: marketplaceListingsTable.routeId,
      fromDistrictId: marketplaceListingsTable.fromDistrictId,
      toDistrictId: marketplaceListingsTable.toDistrictId,
      rideFromCity: ridesTable.fromCity,
      rideToCity: ridesTable.toCity,
      rideScheduledAt: ridesTable.scheduledAt,
      passengers: ridesTable.passengers,
      rideStatus: ridesTable.status,
      ridePrice: ridesTable.price,
    })
    .from(marketplaceListingsTable)
    .leftJoin(ridesTable, eq(marketplaceListingsTable.rideId, ridesTable.id))
    .where(and(
      eq(marketplaceListingsTable.sellerId, sellerId),
      sql`(${marketplaceListingsTable.status} != 'cancelled' OR ${marketplaceListingsTable.cancelledAt} IS NULL OR ${marketplaceListingsTable.cancelledAt} >= NOW() - INTERVAL '1 hour')`
    ))
    .orderBy(desc(marketplaceListingsTable.createdAt));

    const normalized = await Promise.all(listings.map(async (l) => {
      let buyerName = null;
      let buyerPhone = null;
      let buyerCar = null;
      let buyerCarNumber = null;
      if (l.buyerId) {
        const [buyer] = await db.select({ name: usersTable.name, phone: usersTable.phone, carModel: usersTable.carModel, carNumber: usersTable.carNumber })
          .from(usersTable).where(eq(usersTable.id, l.buyerId));
        buyerName = buyer?.name || null;
        buyerPhone = buyer?.phone || null;
        buyerCar = buyer?.carModel || null;
        buyerCarNumber = buyer?.carNumber || null;
      }
      return {
        ...l,
        fromCity: l.fromCity || l.rideFromCity,
        toCity: l.toCity || l.rideToCity,
        scheduledAt: l.scheduledAt || l.rideScheduledAt,
        passengers: l.seatsCount || l.passengers,
        buyerName,
        buyerPhone,
        buyerCar,
        buyerCarNumber,
      };
    }));

    res.json({ listings: normalized });
  } catch (err) {
    logger.error({ err }, "Error fetching my sales");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/cancel/:id", authMiddleware, requireRole("driver"), async (req: AuthRequest, res) => {
  try {
    const sellerId = req.userId!;
    const listingId = parseInt(req.params.id);

    const [listing] = await db.select().from(marketplaceListingsTable)
      .where(and(
        eq(marketplaceListingsTable.id, listingId),
        eq(marketplaceListingsTable.sellerId, sellerId)
      ));

    if (!listing) return res.status(404).json({ message: "Listing not found" });
    if (listing.status !== "active") {
      return res.status(400).json({ message: "Can only cancel active listings" });
    }

    await db.update(marketplaceListingsTable).set({
      status: "cancelled",
      cancelledAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(marketplaceListingsTable.id, listingId));

    if (listing.rideId) {
      stopDispatchLoop(listing.rideId);
      const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, listing.rideId));
      if (ride && ["pending", "offered"].includes(ride.status as string)) {
        await db.update(ridesTable).set({
          status: "cancelled",
          updatedAt: new Date(),
        }).where(eq(ridesTable.id, listing.rideId));
        broadcastToAll({ type: "ride_updated", ride: { ...ride, status: "cancelled" } });
        logger.info({ rideId: listing.rideId, listingId }, "Cancelled marketplace ride on listing cancel");
      }
    }

    broadcastToAll({ type: "marketplace_listing_cancelled", listingId });
    logger.info({ listingId, sellerId }, "Marketplace listing cancelled");

    res.json({ message: "Listing cancelled" });
  } catch (err) {
    logger.error({ err }, "Error cancelling listing");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/listing/:id", authMiddleware, requireRole("driver"), async (req: AuthRequest, res) => {
  try {
    const listingId = parseInt(req.params.id);
    const [listing] = await db.select({
      id: marketplaceListingsTable.id,
      rideId: marketplaceListingsTable.rideId,
      sellerId: marketplaceListingsTable.sellerId,
      buyerId: marketplaceListingsTable.buyerId,
      price: marketplaceListingsTable.price,
      comment: marketplaceListingsTable.comment,
      status: marketplaceListingsTable.status,
      createdAt: marketplaceListingsTable.createdAt,
      updatedAt: marketplaceListingsTable.updatedAt,
      fromCity: marketplaceListingsTable.fromCity,
      toCity: marketplaceListingsTable.toCity,
      scheduledAt: marketplaceListingsTable.scheduledAt,
      clientName: marketplaceListingsTable.clientName,
      clientPhone: marketplaceListingsTable.clientPhone,
      seatsCount: marketplaceListingsTable.seatsCount,
      baggageType: marketplaceListingsTable.baggageType,
      basePrice: marketplaceListingsTable.basePrice,
      routeId: marketplaceListingsTable.routeId,
      fromDistrictId: marketplaceListingsTable.fromDistrictId,
      toDistrictId: marketplaceListingsTable.toDistrictId,
      rideFromCity: ridesTable.fromCity,
      rideToCity: ridesTable.toCity,
      rideScheduledAt: ridesTable.scheduledAt,
      passengers: ridesTable.passengers,
      rideStatus: ridesTable.status,
      ridePrice: ridesTable.price,
    })
    .from(marketplaceListingsTable)
    .leftJoin(ridesTable, eq(marketplaceListingsTable.rideId, ridesTable.id))
    .where(eq(marketplaceListingsTable.id, listingId));

    if (!listing) return res.status(404).json({ message: "Listing not found" });

    let buyerInfo = null;
    if (listing.buyerId) {
      const [buyer] = await db.select({
        id: usersTable.id, name: usersTable.name, phone: usersTable.phone,
        city: usersTable.city, carBrand: usersTable.carBrand, carModel: usersTable.carModel,
        carColor: usersTable.carColor, carNumber: usersTable.carNumber,
      }).from(usersTable).where(eq(usersTable.id, listing.buyerId));
      buyerInfo = buyer;
    }

    let sellerInfo = null;
    const [seller] = await db.select({
      id: usersTable.id, name: usersTable.name, phone: usersTable.phone,
      city: usersTable.city, carBrand: usersTable.carBrand, carModel: usersTable.carModel,
      carColor: usersTable.carColor, carNumber: usersTable.carNumber,
    }).from(usersTable).where(eq(usersTable.id, listing.sellerId));
    sellerInfo = seller;

    const normalized = {
      ...listing,
      fromCity: listing.fromCity || listing.rideFromCity,
      toCity: listing.toCity || listing.rideToCity,
      scheduledAt: listing.scheduledAt || listing.rideScheduledAt,
      passengers: listing.seatsCount || listing.passengers,
    };

    res.json({ listing: normalized, buyerInfo, sellerInfo });
  } catch (err) {
    logger.error({ err }, "Error fetching listing detail");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/history", authMiddleware, requireRole("driver"), async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const listings = await db.select({
      id: marketplaceListingsTable.id,
      rideId: marketplaceListingsTable.rideId,
      sellerId: marketplaceListingsTable.sellerId,
      buyerId: marketplaceListingsTable.buyerId,
      price: marketplaceListingsTable.price,
      comment: marketplaceListingsTable.comment,
      status: marketplaceListingsTable.status,
      createdAt: marketplaceListingsTable.createdAt,
      updatedAt: marketplaceListingsTable.updatedAt,
      fromCity: marketplaceListingsTable.fromCity,
      toCity: marketplaceListingsTable.toCity,
      scheduledAt: marketplaceListingsTable.scheduledAt,
      clientPhone: marketplaceListingsTable.clientPhone,
      seatsCount: marketplaceListingsTable.seatsCount,
      baggageType: marketplaceListingsTable.baggageType,
      basePrice: marketplaceListingsTable.basePrice,
      rideFromCity: ridesTable.fromCity,
      rideToCity: ridesTable.toCity,
      rideScheduledAt: ridesTable.scheduledAt,
      passengers: ridesTable.passengers,
      rideStatus: ridesTable.status,
      ridePrice: ridesTable.price,
    })
    .from(marketplaceListingsTable)
    .leftJoin(ridesTable, eq(marketplaceListingsTable.rideId, ridesTable.id))
    .where(and(
      inArray(marketplaceListingsTable.status, ["completed", "cancelled", "sold", "in_progress"]),
      sql`(${marketplaceListingsTable.sellerId} = ${userId} OR ${marketplaceListingsTable.buyerId} = ${userId})`,
    ))
    .orderBy(desc(marketplaceListingsTable.updatedAt));

    const normalized = await Promise.all(listings.map(async (l) => {
      let sellerName = null;
      let sellerCity = null;
      let sellerCarBrand = null;
      let sellerCarColor = null;
      let sellerCarNumber = null;
      let buyerName = null;
      let buyerCity = null;
      let buyerCarBrand = null;
      let buyerCarColor = null;
      let buyerCarNumber = null;
      const [seller] = await db.select({
        name: usersTable.name,
        phone: usersTable.phone,
        city: usersTable.city,
        carBrand: usersTable.carBrand,
        carColor: usersTable.carColor,
        carNumber: usersTable.carNumber,
      }).from(usersTable).where(eq(usersTable.id, l.sellerId));
      sellerName = seller?.name || null;
      sellerCity = seller?.city || null;
      sellerCarBrand = seller?.carBrand || null;
      sellerCarColor = seller?.carColor || null;
      sellerCarNumber = seller?.carNumber || null;
      if (l.buyerId) {
        const [buyer] = await db.select({
          name: usersTable.name,
          phone: usersTable.phone,
          city: usersTable.city,
          carBrand: usersTable.carBrand,
          carColor: usersTable.carColor,
          carNumber: usersTable.carNumber,
        }).from(usersTable).where(eq(usersTable.id, l.buyerId));
        buyerName = buyer?.name || null;
        buyerCity = buyer?.city || null;
        buyerCarBrand = buyer?.carBrand || null;
        buyerCarColor = buyer?.carColor || null;
        buyerCarNumber = buyer?.carNumber || null;
      }
      return {
        ...l,
        fromCity: l.fromCity || l.rideFromCity,
        toCity: l.toCity || l.rideToCity,
        scheduledAt: l.scheduledAt || l.rideScheduledAt,
        passengers: l.seatsCount || l.passengers,
        sellerName, sellerCity, sellerCarBrand, sellerCarColor, sellerCarNumber,
        buyerName, buyerCity, buyerCarBrand, buyerCarColor, buyerCarNumber,
        role: l.sellerId === userId ? "seller" : "buyer",
      };
    }));

    res.json({ listings: normalized });
  } catch (err) {
    logger.error({ err }, "Error fetching marketplace history");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/check/:rideId", authMiddleware, requireRole("driver"), async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.params.rideId);
    const [listing] = await db.select().from(marketplaceListingsTable)
      .where(and(
        eq(marketplaceListingsTable.rideId, rideId),
        eq(marketplaceListingsTable.status, "active")
      ));
    res.json({ isListed: !!listing, listing: listing || null });
  } catch (err) {
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
