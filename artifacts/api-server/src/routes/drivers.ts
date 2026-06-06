import { Router, type IRouter } from "express";
import { clog } from "../lib/logger.js";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { db, usersTable, ridesTable, orderOffersTable, transactionsTable, ridePassengersTable, marketplaceListingsTable, photoRequestsTable, driverAuditLogsTable } from "@workspace/db";
import { eq, and, ne, desc, sql, gte, lte, inArray, notInArray } from "drizzle-orm";
import { CITIES } from "./rides.js";
import { getOsrmRoute, haversineDistance } from "../lib/osrm.js";
import { authMiddleware, requireRole, AuthRequest } from "../middlewares/auth.js";
import { broadcastToAll, broadcastToUser } from "../lib/websocket.js";
import { notifyOrderAccepted, notifyOrderTaken } from "../lib/notifications.js";
import { applyCancelPenalty, resetConsecutiveIgnores, isDriverBanned, getBanRemainingMs, handleStatusToggle } from "../lib/bonuses.js";
import { completeRide } from "../lib/completion.js";
import { stopDispatchLoop, citiesMatch, enrichRideForOffer } from "../lib/autodispatch.js";
import { getDriver, updateDriver, getDriverBalance } from "../lib/services/drivers.service.js";
import { notifyRideStatusChange } from "../lib/sms-notifications.js";
import { idempotencyKey, getIdempotentResult, storeIdempotentResult } from "../lib/idempotency.js";
import { recordDriverAccept, recordDriverReject, recordRideCompleted } from "../lib/revenue-ai-prod.js";
import { hashPassword } from "./auth.js";
import { generateReferralCode } from "../lib/bonuses.js";
import { getSettingNum } from "../lib/settingsCache.js";


function parseBranchIdFromBody(body: any): number | null {
  const v = body?.branchId;
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function checkMinBalance(balance: number, context: "online" | "accept"): string | null {
  const minBalance = getSettingNum("min_driver_balance", 0);
  if (balance >= minBalance) return null;
  const balStr = Math.floor(balance).toLocaleString("ru-RU");
  const minStr = minBalance.toLocaleString("ru-RU");
  return context === "online"
    ? `Баланс (${balStr} сум) ниже минимального (${minStr} сум). Пополните для выхода на линию.`
    : `Недостаточно средств (${balStr} сум). Минимум для работы: ${minStr} сум.`;
}

const __dirname_drivers = path.dirname(fileURLToPath(import.meta.url));
const PHOTOS_DIR = path.resolve(process.cwd(), "artifacts", "uploads", "photos");
fs.mkdirSync(PHOTOS_DIR, { recursive: true });

const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PHOTOS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"));
  },
});


function enrichPassengersWithRouteInfo(passengers: any[], ride: any) {
  if (!ride) return passengers;
  const fromDisplay = ride.fromDistrictName
    ? `${ride.fromDistrictName} (${ride.fromCity})`
    : ride.fromCity;
  const toDisplay = ride.toDistrictName
    ? `${ride.toDistrictName} (${ride.toCity})`
    : ride.toCity;
  return passengers.map((p: any) => {
    const hasOwnPickup = p.pickupAddress && p.pickupAddress.trim() && p.pickupAddress !== ride.fromCity;
    const hasOwnDrop = p.dropoffAddress && p.dropoffAddress.trim() && p.dropoffAddress !== ride.toCity;
    return {
      ...p,
      pickupAddress: hasOwnPickup ? p.pickupAddress : fromDisplay,
      dropoffAddress: hasOwnDrop ? p.dropoffAddress : toDisplay,
      rideFromDistrictName: ride.fromDistrictName ?? null,
      rideToDistrictName: ride.toDistrictName ?? null,
      rideFromAddress: ride.fromAddress ?? null,
      rideToAddress: ride.toAddress ?? null,
    };
  });
}

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

router.get("/", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const { status } = req.query as { status?: string };
    const branchScope = req.userBranchId;
    const baseConds: any[] = [eq(usersTable.role, "driver")];
    if (req.userRole !== "admin" && branchScope != null) {
      baseConds.push(eq(usersTable.branchId, branchScope));
    }
    let query = db.select().from(usersTable).where(and(...baseConds)).$dynamic();
    if (status) {
      const statusConds = [...baseConds, eq(usersTable.status, status as any)];
      query = query.where(and(...statusConds));
    }
    const drivers = await query.orderBy(desc(usersTable.createdAt));
    const safeDrivers = drivers.map(({ passwordHash, ...d }) => d);
    res.json({ drivers: safeDrivers, total: safeDrivers.length });
  } catch (err) {
    req.log.error({ err }, "Get drivers error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.get("/crm", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const drivers = await db.select().from(usersTable)
      .where(eq(usersTable.role, "driver"))
      .orderBy(desc(usersTable.createdAt));

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Aggregate earnings + ride stats per driver in SQL (GROUP BY) rather than
    // streaming every transaction/ride row into memory and reducing in JS.
    const txRows: any = await db.execute(sql`
      SELECT driver_id,
        COALESCE(SUM(amount) FILTER (WHERE type IN ('income','bonus')), 0) AS total_income,
        COALESCE(SUM(amount) FILTER (WHERE type IN ('commission','penalty','withdraw')), 0) AS total_deduct,
        COALESCE(SUM(amount) FILTER (WHERE type IN ('income','bonus') AND created_at >= ${todayStart}), 0) AS today_income,
        COALESCE(SUM(amount) FILTER (WHERE type IN ('commission','penalty','withdraw') AND created_at >= ${todayStart}), 0) AS today_deduct
      FROM transactions
      WHERE driver_id IS NOT NULL
      GROUP BY driver_id
    `);
    const txAgg = new Map<number, { todayIncome: number; todayDeduct: number; totalIncome: number; totalDeduct: number }>();
    for (const r of (txRows.rows ?? txRows) as any[]) {
      txAgg.set(Number(r.driver_id), {
        todayIncome: parseFloat(r.today_income ?? "0"),
        todayDeduct: parseFloat(r.today_deduct ?? "0"),
        totalIncome: parseFloat(r.total_income ?? "0"),
        totalDeduct: parseFloat(r.total_deduct ?? "0"),
      });
    }

    const rideRows: any = await db.execute(sql`
      SELECT driver_id,
        COUNT(*) FILTER (WHERE created_at >= ${todayStart}) AS rides_today,
        COUNT(*) FILTER (WHERE created_at >= ${weekStart}) AS rides_week,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_rides,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_rides,
        array_agg(DISTINCT from_city) FILTER (WHERE from_city IS NOT NULL AND from_city <> '') AS from_cities,
        array_agg(DISTINCT to_city) FILTER (WHERE to_city IS NOT NULL AND to_city <> '') AS to_cities
      FROM rides
      WHERE driver_id IS NOT NULL
      GROUP BY driver_id
    `);
    const rideAgg = new Map<number, { ridesToday: number; ridesWeek: number; completedRides: number; cancelledRides: number; cities: string[] }>();
    for (const r of (rideRows.rows ?? rideRows) as any[]) {
      const cities = new Set<string>([...(r.from_cities ?? []), ...(r.to_cities ?? [])]);
      rideAgg.set(Number(r.driver_id), {
        ridesToday: Number(r.rides_today ?? 0),
        ridesWeek: Number(r.rides_week ?? 0),
        completedRides: Number(r.completed_rides ?? 0),
        cancelledRides: Number(r.cancelled_rides ?? 0),
        cities: Array.from(cities),
      });
    }

    const enriched = drivers.map(driver => {
      const { passwordHash, ...safe } = driver;

      const t = txAgg.get(driver.id) || { todayIncome: 0, todayDeduct: 0, totalIncome: 0, totalDeduct: 0 };
      const todayEarnings = t.todayIncome - t.todayDeduct;
      const totalEarnings = t.totalIncome - t.totalDeduct;

      const rd = rideAgg.get(driver.id) || { ridesToday: 0, ridesWeek: 0, completedRides: 0, cancelledRides: 0, cities: [] as string[] };
      const ridesToday = rd.ridesToday;
      const ridesWeek = rd.ridesWeek;
      const completedRides = rd.completedRides;
      const cancelledRides = rd.cancelledRides;

      const accepted = driver.acceptedOrders || 0;
      const cancelled = driver.cancelledOrders || 0;
      const totalOffers = accepted + cancelled + (driver.consecutiveIgnores || 0);
      const acceptanceRate = totalOffers > 0 ? Math.round((accepted / totalOffers) * 100) : 100;
      const cancelRate = totalOffers > 0 ? Math.round((cancelled / totalOffers) * 100) : 0;

      const ratingNorm = ((driver.rating || 5) / 5) * 40;
      const acceptNorm = acceptanceRate * 0.35;
      const cancelNorm = (100 - cancelRate) * 0.25;
      const reliabilityScore = Math.round(Math.min(100, ratingNorm + acceptNorm + cancelNorm));

      const totalRidesCount = driver.totalRides || 0;
      let group: string;
      if (totalRidesCount < 10) {
        group = "new";
      } else if (cancelRate > 30 || (driver.rating || 5) < 3.5) {
        group = "problem";
      } else if ((driver.rating || 5) >= 4.5 && totalRidesCount >= 50 && acceptanceRate >= 80) {
        group = "top";
      } else {
        group = "medium";
      }

      let activityLevel: string;
      if (ridesToday >= 3 || (driver.status === "online" && ridesWeek >= 15)) {
        activityLevel = "high";
      } else if (ridesToday >= 1 || ridesWeek >= 5) {
        activityLevel = "normal";
      } else {
        activityLevel = "low";
      }

      const CITY_PREFIX: Record<string, string> = {
        "Ташкент": "TAS", "Самарканд": "SAM", "Бухара": "BUX", "Фергана": "FER",
        "Андижан": "AND", "Наманган": "NAM", "Нукус": "NUK", "Карши": "KAR",
        "Навои": "NAV", "Термез": "TER", "Гулистан": "GUL", "Джиззак": "JIZ", "Ургенч": "URG",
      };
      const cityPfx = driver.city ? (CITY_PREFIX[driver.city] || "BT") : "BT";
      const callsign = `${cityPfx}-${String(driver.id).padStart(3, "0")}`;

      const routeCities = new Set<string>(rd.cities);

      return {
        ...safe,
        callsign,
        ridesToday,
        ridesWeek,
        completedRides,
        cancelledRides,
        acceptanceRate,
        cancelRate,
        reliabilityScore,
        group,
        activityLevel,
        todayEarnings: Math.round(todayEarnings),
        totalEarnings: Math.round(totalEarnings),
        routeCities: Array.from(routeCities),
      };
    });

    res.json({ drivers: enriched, total: enriched.length });
  } catch (err) {
    req.log.error({ err }, "Get CRM drivers error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.get("/crm/:id/profile", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId)) return res.status(400).json({ error: "invalid_id" });

    const [driver] = await db.select().from(usersTable)
      .where(and(eq(usersTable.id, driverId), eq(usersTable.role, "driver")));
    if (!driver) return res.status(404).json({ error: "not_found" });

    const { passwordHash, ...safe } = driver;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const allDriverTx = await db.select().from(transactionsTable)
      .where(eq(transactionsTable.driverId, driverId));
    const incomeTx = allDriverTx.filter(t => t.type === "income" || t.type === "bonus");
    const deductTx = allDriverTx.filter(t => t.type === "commission" || t.type === "penalty" || t.type === "withdraw");
    const calcNet = (inc: typeof incomeTx, ded: typeof deductTx) =>
      inc.reduce((s, t) => s + parseFloat(t.amount?.toString() || "0"), 0) -
      ded.reduce((s, t) => s + parseFloat(t.amount?.toString() || "0"), 0);
    const todayEarnings = calcNet(incomeTx.filter(t => t.createdAt >= todayStart), deductTx.filter(t => t.createdAt >= todayStart));
    const weekEarnings = calcNet(incomeTx.filter(t => t.createdAt >= weekStart), deductTx.filter(t => t.createdAt >= weekStart));
    const monthEarnings = calcNet(incomeTx.filter(t => t.createdAt >= monthStart), deductTx.filter(t => t.createdAt >= monthStart));
    const totalEarnings = calcNet(incomeTx, deductTx);
    const totalCommission = allDriverTx.filter(t => t.type === "commission").reduce((s, t) => s + parseFloat(t.amount?.toString() || "0"), 0);
    const totalPenalties = allDriverTx.filter(t => t.type === "penalty").reduce((s, t) => s + parseFloat(t.amount?.toString() || "0"), 0);

    const driverRides = await db.select({
      id: ridesTable.id,
      status: ridesTable.status,
      fromCity: ridesTable.fromCity,
      toCity: ridesTable.toCity,
      price: ridesTable.price,
      createdAt: ridesTable.createdAt,
      passengers: ridesTable.passengers,
    }).from(ridesTable)
      .where(eq(ridesTable.driverId, driverId))
      .orderBy(desc(ridesTable.createdAt))
      .limit(50);

    const ridesToday = driverRides.filter(r => r.createdAt >= todayStart).length;
    const ridesWeek = driverRides.filter(r => r.createdAt >= weekStart).length;
    const completedRides = driverRides.filter(r => r.status === "completed").length;
    const cancelledRides = driverRides.filter(r => r.status === "cancelled").length;

    const accepted = driver.acceptedOrders || 0;
    const cancelled = driver.cancelledOrders || 0;
    const totalOffers = accepted + cancelled + (driver.consecutiveIgnores || 0);
    const acceptanceRate = totalOffers > 0 ? Math.round((accepted / totalOffers) * 100) : 100;
    const cancelRate = totalOffers > 0 ? Math.round((cancelled / totalOffers) * 100) : 0;
    const reliabilityScore = Math.round(Math.min(100, ((driver.rating || 5) / 5) * 40 + acceptanceRate * 0.35 + (100 - cancelRate) * 0.25));

    const totalRidesCount = driver.totalRides || 0;
    let group: string;
    if (totalRidesCount < 10) group = "new";
    else if (cancelRate > 30 || (driver.rating || 5) < 3.5) group = "problem";
    else if ((driver.rating || 5) >= 4.5 && totalRidesCount >= 50 && acceptanceRate >= 80) group = "top";
    else group = "medium";

    let activityLevel: string;
    if (ridesToday >= 3 || (driver.status === "online" && ridesWeek >= 15)) activityLevel = "high";
    else if (ridesToday >= 1 || ridesWeek >= 5) activityLevel = "normal";
    else activityLevel = "low";

    const CITY_PREFIX: Record<string, string> = {
      "Ташкент": "TAS", "Самарканд": "SAM", "Бухара": "BUX", "Фергана": "FER",
      "Андижан": "AND", "Наманган": "NAM", "Нукус": "NUK", "Карши": "KAR",
      "Навои": "NAV", "Термез": "TER", "Гулистан": "GUL", "Джиззак": "JIZ", "Ургенч": "URG",
    };
    const cityPfx = driver.city ? (CITY_PREFIX[driver.city] || "BT") : "BT";
    const callsign = `${cityPfx}-${String(driver.id).padStart(3, "0")}`;

    res.json({
      ...safe,
      callsign,
      ridesToday,
      ridesWeek,
      completedRides,
      cancelledRides,
      acceptanceRate,
      cancelRate,
      reliabilityScore,
      group,
      activityLevel,
      finance: {
        balance: parseFloat(driver.balance?.toString() || "0"),
        todayEarnings: Math.round(todayEarnings),
        weekEarnings: Math.round(weekEarnings),
        monthEarnings: Math.round(monthEarnings),
        totalEarnings: Math.round(totalEarnings),
        totalCommission: Math.round(totalCommission),
        totalPenalties: Math.round(totalPenalties),
      },
      recentRides: driverRides.slice(0, 20),
    });
  } catch (err) {
    req.log.error({ err }, "Get driver profile error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

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

router.get("/:driverId/active-rides", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const driverId = Number(req.params.driverId);
    if (!driverId) return res.status(400).json({ error: "invalid_driver_id" });

    const activeStatuses = ["pending", "offered", "accepted", "in_progress"];
    const rides = await db.select().from(ridesTable)
      .where(and(
        eq(ridesTable.driverId, driverId),
        inArray(ridesTable.status, activeStatuses as any)
      ))
      .orderBy(desc(ridesTable.createdAt))
      .limit(20);

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

    const driver = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      phone: usersTable.phone,
    }).from(usersTable).where(eq(usersTable.id, driverId)).limit(1);

    const ridesWithPassengers = rides.map(r => ({
      ...r,
      seatPassengers: enrichPassengersWithRouteInfo(passengersByRide.get(r.id) || [], r),
    }));

    res.json({
      driver: driver[0] || null,
      rides: ridesWithPassengers,
      total: ridesWithPassengers.length,
    });
  } catch (err) {
    req.log.error({ err }, "Get driver active rides error");
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/earnings", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const incomeTransactions = await db.select().from(transactionsTable)
      .where(and(eq(transactionsTable.driverId, driverId), eq(transactionsTable.type, "income")));

    const today = incomeTransactions
      .filter(t => t.createdAt >= todayStart)
      .reduce((s, t) => s + parseFloat(t.amount?.toString() || "0"), 0);
    const thisWeek = incomeTransactions
      .filter(t => t.createdAt >= weekStart)
      .reduce((s, t) => s + parseFloat(t.amount?.toString() || "0"), 0);
    const thisMonth = incomeTransactions
      .filter(t => t.createdAt >= monthStart)
      .reduce((s, t) => s + parseFloat(t.amount?.toString() || "0"), 0);

    const completedRides = await db.select({ count: sql<number>`count(*)` })
      .from(ridesTable)
      .where(and(eq(ridesTable.driverId, driverId), eq(ridesTable.status, "completed")));
    const totalRides = await db.select({ count: sql<number>`count(*)` })
      .from(ridesTable)
      .where(eq(ridesTable.driverId, driverId));

    res.json({
      today: Math.round(today),
      thisWeek: Math.round(thisWeek),
      thisMonth: Math.round(thisMonth),
      totalRides: Number(totalRides[0].count),
      completedRides: Number(completedRides[0].count),
    });
  } catch (err) {
    req.log.error({ err }, "Get earnings error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.get("/:id/finance", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId) || driverId <= 0) return res.status(400).json({ error: "invalid_id" });

    const [driver] = await db.select().from(usersTable)
      .where(and(eq(usersTable.id, driverId), eq(usersTable.role, "driver")));
    if (!driver) return res.status(404).json({ error: "not_found" });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const allTx = await db.select().from(transactionsTable)
      .where(eq(transactionsTable.driverId, driverId))
      .orderBy(desc(transactionsTable.createdAt));

    const sum = (txs: typeof allTx, types: string[]) =>
      txs.filter(t => types.includes(t.type)).reduce((s, t) => s + Math.abs(parseFloat(t.amount?.toString() || "0")), 0);

    const todayTx = allTx.filter(t => t.createdAt >= todayStart);
    const weekTx = allTx.filter(t => t.createdAt >= weekStart);
    const monthTx = allTx.filter(t => t.createdAt >= monthStart);

    res.json({
      balance: parseFloat(driver.balance?.toString() || "0"),
      todayEarnings: Math.round(sum(todayTx, ["income", "bonus"])),
      weekEarnings: Math.round(sum(weekTx, ["income", "bonus"])),
      monthEarnings: Math.round(sum(monthTx, ["income", "bonus"])),
      totalCommission: Math.round(sum(allTx, ["commission"])),
      totalPenalties: Math.round(sum(allTx, ["penalty"])),
      totalWithdrawals: Math.round(sum(allTx, ["withdraw"])),
      transactions: allTx.slice(0, 20),
    });
  } catch (err) {
    req.log.error({ err }, "Get driver finance error");
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/:id/finance/adjust", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId) || driverId <= 0) return res.status(400).json({ error: "invalid_id" });

    const { amount, reason } = req.body;
    const numAmount = Number(amount);
    if (!amount || isNaN(numAmount) || numAmount === 0) {
      return res.status(400).json({ error: "validation_error", message: "Укажите сумму (не 0)" });
    }
    const reasonText = (typeof reason === "string" ? reason.trim() : "") || "Без комментария";

    const result = await db.transaction(async (tx) => {
      const [driver] = await tx.select({ id: usersTable.id, balance: usersTable.balance, role: usersTable.role })
        .from(usersTable).where(and(eq(usersTable.id, driverId), eq(usersTable.role, "driver"))).for("update");
      if (!driver) return { error: "not_found" };

      const balBefore = parseFloat(driver.balance?.toString() || "0");
      const balAfter = balBefore + numAmount;
      const txType = numAmount > 0 ? "bonus" : "penalty";

      await tx.insert(transactionsTable).values({
        driverId,
        type: txType,
        amount: String(Math.abs(numAmount)),
        balanceBefore: String(balBefore),
        balanceAfter: String(balAfter),
        description: `Ручная корректировка: ${reasonText} (${numAmount > 0 ? "+" : ""}${numAmount})`,
      });

      await tx.update(usersTable).set({
        balance: String(balAfter),
        updatedAt: new Date(),
      }).where(eq(usersTable.id, driverId));

      return { success: true, newBalance: balAfter };
    });

    if ("error" in result) return res.status(404).json({ error: result.error });

    req.log.info({ driverId, amount: numAmount, reason: reasonText, by: req.userId }, "Manual balance adjustment");
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Finance adjust error");
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/:id/finance/withdraw", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const driverId = parseInt(req.params.id);
    if (isNaN(driverId) || driverId <= 0) return res.status(400).json({ error: "invalid_id" });

    const { amount } = req.body;
    const numAmount = Number(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: "validation_error", message: "Сумма вывода должна быть > 0" });
    }

    const result = await db.transaction(async (tx) => {
      const [driver] = await tx.select({ id: usersTable.id, balance: usersTable.balance, role: usersTable.role })
        .from(usersTable).where(and(eq(usersTable.id, driverId), eq(usersTable.role, "driver"))).for("update");
      if (!driver) return { error: "not_found" as const };

      const balBefore = parseFloat(driver.balance?.toString() || "0");
      if (numAmount > balBefore) {
        return { error: "insufficient_balance" as const, message: "Недостаточно средств" };
      }
      const balAfter = balBefore - numAmount;

      await tx.insert(transactionsTable).values({
        driverId,
        type: "withdraw",
        amount: String(numAmount),
        balanceBefore: String(balBefore),
        balanceAfter: String(balAfter),
        description: `Вывод средств: ${numAmount.toLocaleString("ru-RU")} сум`,
      });

      await tx.update(usersTable).set({
        balance: String(balAfter),
        updatedAt: new Date(),
      }).where(eq(usersTable.id, driverId));

      return { success: true, newBalance: balAfter };
    });

    if ("error" in result) {
      const status = result.error === "not_found" ? 404 : 400;
      return res.status(status).json(result);
    }

    req.log.info({ driverId, amount: numAmount, by: req.userId }, "Withdrawal processed");
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Withdrawal error");
    res.status(500).json({ error: "server_error" });
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
    const [driver] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
    const { passwordHash: _, ...safeDriver } = driver;
    res.json({ url, user: safeDriver });
  } catch (err: any) {
    if (filePath) { try { fs.unlinkSync(filePath); } catch {} }
    req.log.error({ err, fileName: file?.originalname, mimetype: file?.mimetype }, "Driver self-upload photo error");
    res.status(500).json({ error: "server_error", message: "Ошибка сервера при загрузке фото" });
  }
});

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

router.patch("/status", authMiddleware, async (req: AuthRequest, res) => {
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
    const [driver] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
    const { passwordHash: _, ...safeDriver } = driver;
    broadcastToAll({ type: "driver_status", driver: safeDriver });

    const { enqueueDriver, removeFromQueue, getQueuePosition } = await import("../lib/driver-queue.js");
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

router.patch("/location", authMiddleware, async (req: AuthRequest, res) => {
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
    const { updateDriverLocation } = await import("../lib/driver-cache.js");
    updateDriverLocation(req.userId!, lat, lng);
    broadcastToAll({ type: "driver_location", driverId: req.userId, lat, lng });
    res.json({ success: true, message: "Location updated" });
  } catch (err) {
    req.log.error({ err }, "Update location error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/accept", authMiddleware, async (req: AuthRequest, res) => {
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

    const [driver] = await db.select().from(usersTable).where(eq(usersTable.id, driverId));
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
              externalKey: `merged-ride-${Number(rideId)}`,
            });
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
              externalKey: `merged-ride-${Number(rideId)}`,
            });
          }
        }

        await tx.update(ridesTable).set({
          tripId: matchedRouteRide.id,
          status: "merged" as any,
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
    broadcastToAll({ type: "driver_status", driverId, status: "busy" });
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

    try { const { markAssigned: mqAssign } = await import("../lib/driver-queue.js"); mqAssign(driverId, responseMs); } catch (e) { clog.error("[QUEUE] markAssigned failed", e); }

    try { const { refreshOccupiedSeats } = await import("../lib/driver-queue.js"); await refreshOccupiedSeats(); } catch (e) { clog.error("[QUEUE] refreshOccupiedSeats after accept failed", e); }

    req.log.info({ rideId, driverId }, "Driver accepted ride via POST /accept");
    notifyRideStatusChange(Number(rideId), "accepted").catch(() => {});
    res.json(ride);
  } catch (err) {
    req.log.error({ err }, "Accept ride error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/:id/accept-ride/:rideId", authMiddleware, async (req: AuthRequest, res) => {
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

router.post("/start", authMiddleware, async (req: AuthRequest, res) => {
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

router.post("/complete", authMiddleware, async (req: AuthRequest, res) => {
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
    broadcastToAll({ type: "driver_status", driverId, status: "online" });

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
      const { returnToQueue, getQueuePosition: gqp } = await import("../lib/driver-queue.js");
      const { getCachedDriver } = await import("../lib/driver-cache.js");
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

router.post("/cancel", authMiddleware, async (req: AuthRequest, res) => {
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
    broadcastToAll({ type: "driver_status", driverId, status: "online" });
    req.log.info({ rideId, driverId }, "Driver cancelled ride with penalty");
    if (ikey) await storeIdempotentResult(ikey, driverId, "cancel", 200, ride, ride.version);
    res.json(ride);
  } catch (err) {
    req.log.error({ err }, "Driver cancel error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/create-ride", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const { fromCity, toCity, departureTime, urgent, timeSlot: bodyTimeSlot } = req.body;
    const isUrgentRoute = urgent === true;

    if (!fromCity || !toCity || fromCity === toCity) {
      res.status(400).json({ error: "validation_error", message: "Выберите разные города" });
      return;
    }

    const [driver] = await db.select().from(usersTable).where(eq(usersTable.id, driverId));
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
    broadcastToAll({ type: "driver_status", driverId, status: "busy" });
    broadcastToAll({ type: "queue_update", fromCity, toCity, reason: "driver_joined" });

    req.log.info({ rideId: ride.id, driverId }, "Driver created ride");
    res.status(201).json(ride);
  } catch (err) {
    req.log.error({ err }, "Driver create ride error");
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

router.post("/extend-ride", authMiddleware, async (req: AuthRequest, res) => {
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

router.post("/reject", authMiddleware, async (req: AuthRequest, res) => {
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

router.post("/passenger/:passengerId/reject", authMiddleware, async (req: AuthRequest, res) => {
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

router.post("/passenger/:passengerId/pickup", authMiddleware, requireRole("driver"), async (req: AuthRequest, res) => {
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

router.post("/passenger/:passengerId/dropoff", authMiddleware, requireRole("driver"), async (req: AuthRequest, res) => {
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
          const { returnToQueue: rtq } = await import("../lib/driver-queue.js");
          const { getCachedDriver: gcd } = await import("../lib/driver-cache.js");
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

function nearestNeighborPickup<T extends { pickupLat: number | null; pickupLng: number | null }>(
  passengers: T[],
  startLat: number,
  startLng: number,
  endLat?: number | null,
  endLng?: number | null,
): T[] {
  const remaining = [...passengers];
  const sorted: T[] = [];
  let current = { lat: startLat, lng: startLng };

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      let d = haversineDistance(current.lat, current.lng, remaining[i].pickupLat!, remaining[i].pickupLng!);
      if (remaining.length <= 3 && endLat != null && endLng != null) {
        d += haversineDistance(remaining[i].pickupLat!, remaining[i].pickupLng!, endLat, endLng) * 0.3;
      }
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    sorted.push(next);
    current = { lat: next.pickupLat!, lng: next.pickupLng! };
  }

  if (sorted.length >= 3 && endLat != null && endLng != null) {
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < sorted.length - 1; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const before = totalRouteDistance(sorted, startLat, startLng, endLat, endLng);
          [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
          const after = totalRouteDistance(sorted, startLat, startLng, endLat, endLng);
          if (after < before) {
            improved = true;
          } else {
            [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
          }
        }
      }
    }
  }

  return sorted;
}

function totalRouteDistance<T extends { pickupLat: number | null; pickupLng: number | null }>(
  order: T[],
  startLat: number,
  startLng: number,
  endLat: number | null,
  endLng: number | null,
): number {
  let dist = 0;
  let prev = { lat: startLat, lng: startLng };
  for (const p of order) {
    dist += haversineDistance(prev.lat, prev.lng, p.pickupLat!, p.pickupLng!);
    prev = { lat: p.pickupLat!, lng: p.pickupLng! };
  }
  if (endLat != null && endLng != null) {
    dist += haversineDistance(prev.lat, prev.lng, endLat, endLng);
  }
  return dist;
}

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([arr[i], ...perm]);
    }
  }
  return result;
}

function optimizePickupOrder<T extends { pickupLat: number | null; pickupLng: number | null }>(
  passengers: T[],
  startLat: number,
  startLng: number,
  endLat: number | null,
  endLng: number | null,
): T[] {
  const perms = permutations(passengers);
  let bestOrder = passengers;
  let bestDist = Infinity;
  for (const perm of perms) {
    const d = totalRouteDistance(perm, startLat, startLng, endLat, endLng);
    if (d < bestDist) {
      bestDist = d;
      bestOrder = perm;
    }
  }
  return bestOrder;
}

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

router.post("/reject-client", authMiddleware, requireRole("driver"), async (req: AuthRequest, res) => {
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

router.post("/manual-client", authMiddleware, requireRole("driver"), async (req: AuthRequest, res) => {
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
