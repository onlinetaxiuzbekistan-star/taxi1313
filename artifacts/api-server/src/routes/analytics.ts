/**
 * Analytics Routes
 *
 * GET /api/analytics/summary  — live aggregated stats
 * GET /api/analytics/daily    — daily breakdown (last 30 days)
 * POST /api/analytics/refresh — recalculate today's analytics_daily row
 */
import { Router, type IRouter } from "express";
import { db, ridesTable, usersTable, transactionsTable, clientsTable, analyticsDailyTable } from "@workspace/db";
import { eq, gte, lte, and, desc, sql } from "drizzle-orm";

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
      db.select({ status: ridesTable.status, price: ridesTable.price }).from(ridesTable),
      db.select({ status: ridesTable.status, price: ridesTable.price })
        .from(ridesTable)
        .where(and(gte(ridesTable.createdAt, start), lte(ridesTable.createdAt, end))),
      db.select({ status: usersTable.status }).from(usersTable).where(eq(usersTable.role, "driver")),
      db.select({ amount: sql<string>`sum(amount)` })
        .from(transactionsTable)
        .where(and(eq(transactionsTable.type, "commission"), gte(transactionsTable.createdAt, start))),
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

    const [totalCommission] = await db.select({ total: sql<string>`coalesce(sum(amount), 0)` })
      .from(transactionsTable).where(eq(transactionsTable.type, "commission"));

    const [totalBonuses] = await db.select({ total: sql<string>`coalesce(sum(amount), 0)` })
      .from(transactionsTable).where(eq(transactionsTable.type, "bonus"));

    const [totalPenalties] = await db.select({ total: sql<string>`coalesce(sum(amount), 0)` })
      .from(transactionsTable).where(eq(transactionsTable.type, "penalty"));

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
    const preAgg = await db
      .select()
      .from(analyticsDailyTable)
      .where(gte(analyticsDailyTable.date, since.toISOString().slice(0, 10)))
      .orderBy(desc(analyticsDailyTable.date));

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
router.post("/refresh", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { start, end } = dayBounds(new Date());

    const [todayRides, commRow, clientRow] = await Promise.all([
      db.select().from(ridesTable)
        .where(and(gte(ridesTable.createdAt, start), lte(ridesTable.createdAt, end))),
      db.select({ total: sql<string>`coalesce(sum(amount),0)` })
        .from(transactionsTable)
        .where(and(eq(transactionsTable.type, "commission"), gte(transactionsTable.createdAt, start))),
      db.select({ count: sql<number>`count(*)` })
        .from(clientsTable)
        .where(and(gte(clientsTable.createdAt, start), lte(clientsTable.createdAt, end))),
    ]);

    const completed  = todayRides.filter(r => r.status === "completed");
    const cancelled  = todayRides.filter(r => r.status === "cancelled");
    const revenue    = completed.reduce((s, r) => s + (r.price || 0), 0);
    const commission = parseFloat(commRow[0]?.total || "0");
    const avgPrice   = completed.length ? revenue / completed.length : 0;

    const activeDrivers = (await db.select({ count: sql<number>`count(*)` })
      .from(usersTable)
      .where(and(eq(usersTable.role, "driver"))))[0].count;

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

    await db
      .insert(analyticsDailyTable)
      .values(row)
      .onConflictDoUpdate({ target: analyticsDailyTable.date, set: row });

    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Analytics refresh error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
