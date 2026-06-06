// @ts-nocheck
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

router.get("/cities", async (_req, res) => {
  try {
    const rows = await db.select().from(citiesTable).orderBy(citiesTable.nameRu);
    const cities = rows
      .filter(c => c.isActive && c.slug)
      .map(c => ({ id: c.slug!, name: c.slug!, nameRu: c.nameRu, nameUz: c.nameUz, slug: c.slug!, lat: c.lat, lng: c.lng }));
    res.json({ cities });
  } catch {
    res.json({ cities: Object.entries(CITIES).map(([id, c]) => ({ id, name: id, nameRu: c.nameRu, slug: id, lat: c.lat, lng: c.lng })) });
  }
});


router.get("/pricing-info", async (_req, res) => {
  try {
    const surge = await getSurgeMultiplier(false);
    const surgeUrgent = await getSurgeMultiplier(true);
    // Default 10 to match completion.ts (the authoritative charge path) so this
    // estimate never diverges from what the driver is actually charged.
    const commissionPercent = getSettingNum("commission_percent", 10);
    const commissionFixed = getSettingNum("commission_fixed", 0);

    res.json({
      currentMultiplier: surge.multiplier,
      urgentMultiplier: surgeUrgent.multiplier,
      breakdown: surge.breakdown,
      commission: {
        percent: commissionPercent,
        fixed: commissionFixed,
      },
      isHighDemand: surge.breakdown.demandRatio > parseFloat(getSetting("demand_threshold", "1.5")),
      isNight: surge.breakdown.timePeriod === "night",
      isPeakHour: surge.breakdown.timePeriod === "morning_peak" || surge.breakdown.timePeriod === "evening_peak",
    });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.post("/price-estimate", async (req, res) => {
  try {
    const { fromCity, toCity, carClass, fromDistrictId, toDistrictId, roundTrip, seatPosition, selectedOptions, frontSeats, backSeats } = req.body;
    const tariff = carClass || "economy";
    const result = await calcPrice(fromCity, toCity, 1, tariff);

    if (!result.price || result.price <= 0) {
      res.status(400).json({ error: "tariff_missing", message: "Тариф не настроен для данного маршрута" });
      return;
    }

    const nFront = typeof frontSeats === "number" ? Math.max(0, Math.min(1, frontSeats)) : 0;
    const nBack = typeof backSeats === "number" ? Math.max(0, Math.min(3, backSeats)) : 0;

    let seatTotal: number;
    if (nFront > 0 || nBack > 0) {
      seatTotal = (nFront * result.priceFront) + (nBack * result.priceBack);
    } else {
      const isFront = seatPosition === "front";
      seatTotal = isFront ? result.priceFront : result.priceBack;
    }

    let fromDistrictCharge = 0;
    let toDistrictCharge = 0;
    if (fromDistrictId) {
      const [d] = await db.select().from(districtsTable).where(eq(districtsTable.id, Number(fromDistrictId)));
      if (d) fromDistrictCharge = d.extraCharge;
    }
    if (toDistrictId) {
      const [d] = await db.select().from(districtsTable).where(eq(districtsTable.id, Number(toDistrictId)));
      if (d) toDistrictCharge = d.extraCharge;
    }

    let optionsTotal = 0;
    let optionsCommission = 0;
    if (Array.isArray(selectedOptions) && selectedOptions.length > 0 && result.routeId) {
      const routeOpts = await db.select().from(routeOptionsTable)
        .where(and(
          eq(routeOptionsTable.routeId, result.routeId),
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

    let price = seatTotal + fromDistrictCharge + toDistrictCharge + optionsTotal;

    if (roundTrip) {
      const total = price * 2;
      let discountPercent = result.roundTripDiscountPercent ?? 0;
      if (discountPercent < 0) discountPercent = 0;
      if (discountPercent > 100) discountPercent = 100;
      const discountAmount = Math.round(total * (discountPercent / 100));
      price = total - discountAmount;
      if (price <= 0) price = total;
    }

    if (!Number.isFinite(price) || price <= 0) {
      price = seatTotal;
    }

    clog.log("SEAT TOTAL:", seatTotal, "front:", nFront, "back:", nBack, "FINAL PRICE:", price);

    res.json({
      price: Math.round(price),
      priceFront: Math.round(result.priceFront),
      priceBack: Math.round(result.priceBack),
    });
  } catch (err) {
    req.log.error({ err }, "Price estimate error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

function buildArchiveFilters(q: Record<string, string>) {
  const conditions: any[] = [];
  const validStatuses = ["pending", "offered", "accepted", "in_progress", "completed", "cancelled"];

  if (q.status) {
    const statuses = q.status.split(",").map(s => s.trim()).filter(s => validStatuses.includes(s));
    if (statuses.length === 1) conditions.push(eq(ridesTable.status, statuses[0] as any));
    else if (statuses.length > 1) conditions.push(inArray(ridesTable.status, statuses as any[]));
  }
  if (q.orderId) {
    const oid = parseInt(q.orderId);
    if (!isNaN(oid) && oid > 0) conditions.push(eq(ridesTable.id, oid));
  }
  if (q.clientPhone) {
    const phone = q.clientPhone.replace(/[^0-9+]/g, "");
    if (phone.length >= 3) conditions.push(ilike(ridesTable.riderPhone, `%${phone}%`));
  }
  if (q.driverCarNumber) {
    const plate = q.driverCarNumber.trim();
    if (plate.length >= 2) conditions.push(ilike(ridesTable.driverCarNumber, `%${plate}%`));
  }
  if (q.driverName) {
    const name = q.driverName.trim();
    if (name.length >= 2) conditions.push(ilike(ridesTable.driverName, `%${name}%`));
  }
  if (q.fromCity) conditions.push(eq(ridesTable.fromCity, q.fromCity));
  if (q.toCity) conditions.push(eq(ridesTable.toCity, q.toCity));
  if (q.carClass && ["economy", "comfort", "business"].includes(q.carClass)) conditions.push(eq(ridesTable.carClass, q.carClass));
  if (q.source) conditions.push(eq(ridesTable.source, q.source));
  if (q.dateFrom) {
    const d = new Date(q.dateFrom);
    if (!isNaN(d.getTime())) conditions.push(gte(ridesTable.createdAt, d));
  }
  if (q.dateTo) {
    const d = new Date(q.dateTo);
    if (!isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); conditions.push(lte(ridesTable.createdAt, d)); }
  }
  if (q.noDriver === "true") {
    conditions.push(sql`${ridesTable.driverId} IS NULL`);
  }
  if (q.problemOrders === "true") {
    conditions.push(or(
      eq(ridesTable.status, "cancelled" as any),
      sql`${ridesTable.driverId} IS NULL`,
      sql`(${ridesTable.status} IN ('pending','offered') AND ${ridesTable.createdAt} < now() - interval '30 minutes')`
    ));
  }
  if (q.search) {
    const s = q.search.trim().slice(0, 100);
    if (s) {
      const num = parseInt(s);
      if (!isNaN(num) && num > 0) {
        conditions.push(or(eq(ridesTable.id, num), ilike(ridesTable.riderPhone, `%${s}%`), ilike(ridesTable.driverPhone, `%${s}%`)));
      } else {
        conditions.push(or(
          ilike(ridesTable.riderName, `%${s}%`), ilike(ridesTable.riderPhone, `%${s}%`),
          ilike(ridesTable.driverName, `%${s}%`), ilike(ridesTable.driverCarNumber, `%${s}%`),
          ilike(ridesTable.fromCity, `%${s}%`), ilike(ridesTable.toCity, `%${s}%`),
        ));
      }
    }
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}


router.get("/archive", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const q = req.query as Record<string, string>;
    const page = Math.max(1, parseInt(q.page || "1") || 1);
    const perPage = Math.min(100, Math.max(10, parseInt(q.perPage || "30") || 30));
    const offset = (page - 1) * perPage;

    const whereClause = buildArchiveFilters(q);

    const validSorts = ["createdAt", "price", "id"];
    const sortKey = validSorts.includes(q.sort) ? q.sort : "createdAt";
    const sortField = sortKey === "price" ? ridesTable.price : sortKey === "id" ? ridesTable.id : ridesTable.createdAt;
    const sortDir = q.sortDir === "asc" ? asc(sortField) : desc(sortField);

    let dataQuery = db.select().from(ridesTable).$dynamic();
    if (whereClause) dataQuery = dataQuery.where(whereClause);
    const rides = await dataQuery.orderBy(sortDir).limit(perPage).offset(offset);

    const statsQuery = db.select({
      total: sql<number>`count(*)`,
      completed: sql<number>`count(*) filter (where ${ridesTable.status} = 'completed')`,
      cancelled: sql<number>`count(*) filter (where ${ridesTable.status} = 'cancelled')`,
      revenue: sql<number>`coalesce(sum(${ridesTable.price}) filter (where ${ridesTable.status} = 'completed'), 0)`,
      problemCount: sql<number>`count(*) filter (where ${ridesTable.status} = 'cancelled' or ${ridesTable.driverId} is null or (${ridesTable.status} in ('pending','offered') and ${ridesTable.createdAt} < now() - interval '30 minutes'))`,
      avgDurationMin: sql<number>`coalesce(avg(extract(epoch from (${ridesTable.updatedAt} - ${ridesTable.createdAt})) / 60) filter (where ${ridesTable.status} = 'completed'), 0)`,
    }).from(ridesTable).$dynamic();
    const filteredStatsQuery = whereClause ? statsQuery.where(whereClause) : statsQuery;
    const [stats] = await filteredStatsQuery;

    res.json({
      rides,
      total: Number(stats.total),
      completed: Number(stats.completed),
      cancelled: Number(stats.cancelled),
      revenue: Number(stats.revenue),
      problemCount: Number(stats.problemCount),
      avgDurationMin: Math.round(Number(stats.avgDurationMin)),
      page,
      perPage,
    });
  } catch (err) {
    req.log.error({ err }, "Archive rides error");
    res.status(500).json({ error: "server_error" });
  }
});


router.get("/archive/export", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const q = req.query as Record<string, string>;
    const whereClause = buildArchiveFilters(q);

    let dataQuery = db.select().from(ridesTable).$dynamic();
    if (whereClause) dataQuery = dataQuery.where(whereClause);
    const rides = await dataQuery.orderBy(desc(ridesTable.createdAt)).limit(5000);

    const header = "ID,Дата,Клиент,Телефон,Откуда,Куда,Водитель,Авто,Гос.номер,Тариф,Статус,Цена,Оплата,Источник\n";
    const statusLabels: Record<string, string> = { pending: "Ожидает", offered: "Предложен", accepted: "Принят", in_progress: "В пути", completed: "Завершён", cancelled: "Отменён" };
    const csvSafe = (v: any) => {
      let s = String(v ?? "").replace(/"/g, '""');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return `"${s}"`;
    };
    const rows = rides.map(r => [
      r.id,
      csvSafe(r.createdAt ? new Date(r.createdAt).toLocaleString("ru-RU") : ""),
      csvSafe(r.riderName || ""), csvSafe(r.riderPhone || ""),
      csvSafe(r.fromCity), csvSafe(r.toCity),
      csvSafe(r.driverName || ""), csvSafe(r.driverCar || ""), csvSafe(r.driverCarNumber || ""),
      csvSafe(r.carClass), csvSafe(statusLabels[r.status] || r.status),
      r.price || 0, csvSafe(r.paymentType), csvSafe(r.source || "dispatch"),
    ].join(",")).join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="archive_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send("\uFEFF" + header + rows);
  } catch (err) {
    req.log.error({ err }, "Export archive error");
    res.status(500).json({ error: "server_error" });
  }
});


router.get("/:id/transactions", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.params.id);
    if (isNaN(rideId)) return res.status(400).json({ error: "invalid_ride_id" });
    const txs = await db.select({
      id: transactionsTable.id,
      driverId: transactionsTable.driverId,
      rideId: transactionsTable.rideId,
      type: transactionsTable.type,
      amount: transactionsTable.amount,
      balanceBefore: transactionsTable.balanceBefore,
      balanceAfter: transactionsTable.balanceAfter,
      description: transactionsTable.description,
      createdAt: transactionsTable.createdAt,
      updatedBy: transactionsTable.updatedBy,
      updatedAt: transactionsTable.updatedAt,
      driverName: usersTable.name,
    })
      .from(transactionsTable)
      .leftJoin(usersTable, eq(transactionsTable.driverId, usersTable.id))
      .where(eq(transactionsTable.rideId, rideId))
      .orderBy(desc(transactionsTable.createdAt));
    res.json({ transactions: txs });
  } catch (err) {
    req.log.error({ err }, "Get ride transactions error");
    res.status(500).json({ error: "server_error" });
  }
});


router.get("/", async (req, res) => {
  try {
    const { status, limit = "50", offset = "0", type } = req.query as Record<string, string>;
    const conditions: any[] = [];
    if (status) {
      const statuses = (status as string).split(",").map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        conditions.push(eq(ridesTable.status, statuses[0] as any));
      } else if (statuses.length > 1) {
        conditions.push(inArray(ridesTable.status, statuses as any[]));
      }
    }
    if (type === "ride") {
      conditions.push(sql`${ridesTable.riderPhone} IS NOT NULL`);
    } else if (type === "trip") {
      conditions.push(sql`${ridesTable.riderPhone} IS NULL AND ${ridesTable.driverId} IS NOT NULL`);
    }
    const _scope = await __getRequesterBranchScope(req);
    const _me = await __getRequesterIdentity(req);
    // Anonymous callers must NOT receive the global ride feed (was a data leak). Return empty.
    if (!_scope.role) {
      res.json({ rides: [], total: 0 });
      return;
    }
    if (_scope.role === "rider") {
      // Riders only ever see their own rides.
      conditions.push(eq(ridesTable.riderId, _me.userId ?? -1));
    } else if (_scope.role !== "admin" && _scope.branchId != null) {
      // Dispatchers/staff are confined to their branch; admin sees everything.
      conditions.push(eq(ridesTable.branchId, _scope.branchId));
    }
    let query = db.select().from(ridesTable).$dynamic();
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    const rides = await query.orderBy(desc(ridesTable.createdAt)).limit(parseInt(limit)).offset(parseInt(offset));

    const countConditions = [...conditions];
    let countQuery = db.select({ count: sql<number>`count(*)` }).from(ridesTable).$dynamic();
    if (countConditions.length > 0) {
      countQuery = countQuery.where(and(...countConditions));
    }
    const [{ count }] = await countQuery;
    res.json({ rides, total: count });
  } catch (err) {
    req.log.error({ err }, "Get rides error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.get("/urgent", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { fromCity, toCity } = req.query as Record<string, string>;
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

    // Show in "Срочные":
    //  - orders whose scheduled time is within the next 1 hour (so drivers see them in advance), or
    //  - orders that started up to 3 hours ago and still nobody took.
    let query = db.select().from(ridesTable)
      .where(
        and(
          inArray(ridesTable.status, ["pending", "offered"]),
          sql`${ridesTable.scheduledAt} <= ${oneHourFromNow}`,
          sql`${ridesTable.scheduledAt} >= ${threeHoursAgo}`,
        )
      )
      .$dynamic();

    if (fromCity && toCity) {
      query = query.where(and(
        eq(ridesTable.fromCity, fromCity),
        eq(ridesTable.toCity, toCity),
      ));
    } else if (fromCity) {
      query = query.where(eq(ridesTable.fromCity, fromCity));
    }

    const rides = await query.orderBy(asc(ridesTable.scheduledAt)).limit(40);

    const activeOffers = await db
      .select({ rideId: orderOffersTable.rideId })
      .from(orderOffersTable)
      .where(eq(orderOffersTable.status, "pending"));
    const rideIdsWithActiveOffers = new Set(activeOffers.map(o => o.rideId));

    const urgentRides = rides.filter(r => !rideIdsWithActiveOffers.has(r.id));

    const ridesWithPassengers = await Promise.all(urgentRides.slice(0, 20).map(async (ride) => {
      const passengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, ride.id));
      return { ...ride, hasActiveOffer: false, seatPassengers: enrichPassengersWithRouteInfo(passengers, ride) };
    }));

    res.json({ rides: ridesWithPassengers });
  } catch (err) {
    req.log.error({ err }, "Get urgent rides error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.get("/:id", async (req, res) => {
  try {
    const ride = await getRide(parseInt(req.params.id));
    if (!ride) { res.status(404).json({ error: "not_found", message: "Ride not found" }); return; }

    const me = await __getRequesterIdentity(req);
    const isStaff = me.role === "dispatcher" || me.role === "admin";
    const isAssignedDriver = me.role === "driver" && ride.driverId === me.userId;
    const isOwnerRider = me.userId != null && ride.riderId === me.userId;

    // Authorized parties get the full record (incl. passengers, financials, contacts).
    if (isStaff || isAssignedDriver || isOwnerRider) {
      const seatPassengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, ride.id));
      res.json({ ...ride, seatPassengers: enrichPassengersWithRouteInfo(seatPassengers, ride) });
      return;
    }

    // Guests (unauthenticated rider tracking) get a sanitized view: enough to track the ride,
    // but no other people's contacts and no internal financials (commission/payout/basePrice).
    res.json({
      id: ride.id,
      status: ride.status,
      fromCity: ride.fromCity,
      toCity: ride.toCity,
      fromAddress: ride.fromAddress,
      toAddress: ride.toAddress,
      scheduledAt: ride.scheduledAt,
      passengers: ride.passengers,
      carClass: ride.carClass,
      price: ride.price,
      distance: ride.distance,
      duration: ride.duration,
      isUrgent: ride.isUrgent,
      driverName: ride.driverName,
      driverCar: ride.driverCar,
      driverCarNumber: ride.driverCarNumber,
      driverRating: ride.driverRating,
      createdAt: ride.createdAt,
      updatedAt: ride.updatedAt,
    });
  } catch (err) {
    req.log.error({ err }, "Get ride error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.get("/:id/passengers", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.params.id);
    const [ride] = await db.select({ driverId: ridesTable.driverId, branchId: ridesTable.branchId })
      .from(ridesTable).where(eq(ridesTable.id, rideId));
    if (!ride) { res.status(404).json({ error: "not_found", message: "Заказ не найден" }); return; }

    const isStaff = req.userRole === "dispatcher" || req.userRole === "admin";
    const isAssignedDriver = req.userRole === "driver" && ride.driverId === req.userId;
    if (!isStaff && !isAssignedDriver) {
      res.status(403).json({ error: "forbidden", message: "Нет доступа к пассажирам этого заказа" });
      return;
    }

    const passengers = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, rideId));
    res.json({ passengers });
  } catch (err) {
    req.log.error({ err }, "Get ride passengers error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});


router.get("/:id/offers", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const rideId = Number(req.params.id);
    if (!rideId) {
      res.status(400).json({ error: "validation_error", message: "Invalid ride ID" });
      return;
    }
    const offers = await getOfferStatus(rideId);
    res.json({ offers });
  } catch (err) {
    req.log.error({ err }, "Get offer status error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
