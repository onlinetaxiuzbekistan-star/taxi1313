/**
 * Analytics Routes
 *
 * GET /api/analytics/summary  — live aggregated stats
 * GET /api/analytics/daily    — daily breakdown (last 30 days)
 * POST /api/analytics/refresh — recalculate today's analytics_daily row
 */
import { Router, type IRouter } from "express";
import * as analyticsService from "../lib/services/analytics.service.js";
import { validateBody } from "../middlewares/validate.js";
import { z } from "zod";

const refreshBodySchema = z.object({}).passthrough();

const router: IRouter = Router();

/** Helper: start/end of a date in UTC */
function dayBounds(d: Date) {
  const start = new Date(d); start.setUTCHours(0, 0, 0, 0);
  const end   = new Date(d); end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * GET /api/analytics/summary
 * Real-time aggregated numbers for the dispatcher dashboard header.
 */
router.get("/summary", async (req, res) => {
  try {
    const { start, end } = dayBounds(new Date());

    const [
      allRides,
      todayRides,
      drivers,
      commissionRows,
    ] = await Promise.all([
      analyticsService.getAllRidesStatusPrice(),
      analyticsService.getRidesStatusPriceBetween(start, end),
      analyticsService.getDriverStatuses(),
      analyticsService.getCommissionSumSince(start),
    ]);

    const revenueToday = todayRides
      .filter(r => r.status === "completed")
      .reduce((s, r) => s + (r.price || 0), 0);

    const commissionToday = parseFloat(commissionRows[0]?.amount || "0");

    const completedTodayList = todayRides.filter(r => r.status === "completed");
    const avgCheck = completedTodayList.length > 0
      ? Math.round(completedTodayList.reduce((s, r) => s + (r.price || 0), 0) / completedTodayList.length)
      : 0;

    const allCompleted = allRides.filter(r => r.status === "completed");
    const avgCheckAllTime = allCompleted.length > 0
      ? Math.round(allCompleted.reduce((s, r) => s + (r.price || 0), 0) / allCompleted.length)
      : 0;

    const totalCommission = await analyticsService.getTransactionTotalByType("commission");

    const totalBonuses = await analyticsService.getTransactionTotalByType("bonus");

    const totalPenalties = await analyticsService.getTransactionTotalByType("penalty");

    res.json({
      totalOrdersToday: todayRides.length,
      completedToday:   completedTodayList.length,
      cancelledToday:   todayRides.filter(r => r.status === "cancelled").length,
      revenueToday:     Math.round(revenueToday),
      commissionToday:  Math.round(commissionToday),
      avgCheckToday:    avgCheck,

      activeOrders:   allRides.filter(r => ["pending","offered","accepted","in_progress"].includes(r.status as string)).length,
      driversOnline:  drivers.filter(d => d.status === "online").length,
      driversBusy:    drivers.filter(d => d.status === "busy").length,
      driversOffline: drivers.filter(d => d.status === "offline").length,
      totalDrivers:   drivers.length,

      totalOrders:        allRides.length,
      completed:          allCompleted.length,
      avgCheckAllTime,
      totalCommission:    Math.round(parseFloat(totalCommission?.total || "0")),
      totalBonuses:       Math.round(parseFloat(totalBonuses?.total || "0")),
      totalPenalties:     Math.round(parseFloat(totalPenalties?.total || "0")),
    });
  } catch (err) {
    req.log.error({ err }, "Analytics summary error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

/**
 * GET /api/analytics/daily?days=30
 * Returns last N days of pre-aggregated (or live-computed) daily stats.
 */
router.get("/daily", async (req, res) => {
  try {
    const days = Math.min(parseInt((req.query.days as string) || "30"), 90);
    const since = new Date(); since.setDate(since.getDate() - days);

    // Try pre-aggregated first, fall back to live query for today
    const preAgg = await analyticsService.getDailySince(since.toISOString().slice(0, 10));

    res.json({ days: preAgg, total: preAgg.length });
  } catch (err) {
    req.log.error({ err }, "Analytics daily error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

/**
 * POST /api/analytics/refresh
 * Recalculates and upserts today's row in analytics_daily.
 * Call this at end of day, or on demand.
 */
router.post("/refresh", validateBody(refreshBodySchema), async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { start, end } = dayBounds(new Date());

    const [todayRides, commRow, clientRow] = await Promise.all([
      analyticsService.getRidesBetween(start, end),
      analyticsService.getCommissionTotalSince(start),
      analyticsService.getNewClientsCountBetween(start, end),
    ]);

    const completed  = todayRides.filter(r => r.status === "completed");
    const cancelled  = todayRides.filter(r => r.status === "cancelled");
    const revenue    = completed.reduce((s, r) => s + (r.price || 0), 0);
    const commission = parseFloat(commRow[0]?.total || "0");
    const avgPrice   = completed.length ? revenue / completed.length : 0;

    const activeDrivers = await analyticsService.getActiveDriversCount();

    const row = {
      date: today,
      totalOrders: todayRides.length,
      completedOrders: completed.length,
      cancelledOrders: cancelled.length,
      revenue: String(Math.round(revenue)),
      commission: String(Math.round(commission)),
      avgOrderPrice: Math.round(avgPrice),
      activeDrivers: Number(activeDrivers),
      newClients: Number(clientRow[0]?.count || 0),
    };

    await analyticsService.upsertDaily(row);

    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Analytics refresh error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
