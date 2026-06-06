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


export default router;
