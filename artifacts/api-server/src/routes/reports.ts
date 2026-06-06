import { Router, type IRouter } from "express";
import { clog } from "../lib/logger.js";
import { authMiddleware, requireRole, AuthRequest } from "../middlewares/auth.js";
import { db, ridesTable, usersTable, driverGroupsTable } from "@workspace/db";
import { eq, gte, lte, and, sql, inArray, desc, asc } from "drizzle-orm";

const router: IRouter = Router();

function parseDateRange(from?: string, to?: string) {
  const now = new Date();
  const start = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
  start.setUTCHours(0, 0, 0, 0);
  const end = to ? new Date(to) : now;
  end.setUTCHours(23, 59, 59, 999);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) throw { status: 400, msg: "Invalid date format" };
  if (start > end) { const tmp = new Date(start); start.setTime(end.getTime()); end.setTime(tmp.getTime()); }
  return { start, end };
}

function handleErr(res: any, e: any) {
  if (e?.status === 400) return res.status(400).json({ error: e.msg });
  clog.error("[REPORTS]", e?.message || e);
  res.status(500).json({ error: "Internal server error" });
}

router.get("/orders", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const { start, end } = parseDateRange(req.query.from as string, req.query.to as string);
    const statusFilter = req.query.status as string | undefined;
    const cityFrom = req.query.cityFrom as string | undefined;
    const cityTo = req.query.cityTo as string | undefined;

    const conditions = [
      gte(ridesTable.createdAt, start),
      lte(ridesTable.createdAt, end),
    ];
    if (statusFilter && statusFilter !== "all") conditions.push(eq(ridesTable.status, statusFilter as any));
    if (cityFrom) conditions.push(eq(ridesTable.fromCity, cityFrom));
    if (cityTo) conditions.push(eq(ridesTable.toCity, cityTo));

    const rides = await db.select({
      id: ridesTable.id,
      fromCity: ridesTable.fromCity,
      toCity: ridesTable.toCity,
      status: ridesTable.status,
      price: ridesTable.price,
      commission: ridesTable.commission,
      driverPayout: ridesTable.driverPayout,
      passengers: ridesTable.passengers,
      carClass: ridesTable.carClass,
      paymentType: ridesTable.paymentType,
      riderName: ridesTable.riderName,
      riderPhone: ridesTable.riderPhone,
      driverName: ridesTable.driverName,
      driverPhone: ridesTable.driverPhone,
      scheduledAt: ridesTable.scheduledAt,
      createdAt: ridesTable.createdAt,
    }).from(ridesTable)
      .where(and(...conditions))
      .orderBy(desc(ridesTable.createdAt))
      .limit(5000);

    const summary = await db.select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${ridesTable.status} = 'completed')::int`,
      cancelled: sql<number>`count(*) filter (where ${ridesTable.status} = 'cancelled')::int`,
      pending: sql<number>`count(*) filter (where ${ridesTable.status} = 'pending')::int`,
      offered: sql<number>`count(*) filter (where ${ridesTable.status} = 'offered')::int`,
      accepted: sql<number>`count(*) filter (where ${ridesTable.status} = 'accepted')::int`,
      inProgress: sql<number>`count(*) filter (where ${ridesTable.status} = 'in_progress')::int`,
      totalRevenue: sql<number>`coalesce(sum(${ridesTable.price}), 0)::real`,
      totalCommission: sql<number>`coalesce(sum(${ridesTable.commission}), 0)::real`,
      avgPrice: sql<number>`coalesce(avg(${ridesTable.price}), 0)::real`,
    }).from(ridesTable)
      .where(and(...conditions));

    res.json({ rides, summary: summary[0] });
  } catch (e: any) {
    handleErr(res, e);
  }
});

router.get("/drivers", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const { start, end } = parseDateRange(req.query.from as string, req.query.to as string);
    const groupId = req.query.groupId ? Number(req.query.groupId) : undefined;

    const driverConditions = [eq(usersTable.role, "driver")];
    if (groupId) driverConditions.push(eq(usersTable.groupId, groupId));

    const drivers = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      phone: usersTable.phone,
      status: usersTable.status,
      carBrand: usersTable.carBrand,
      carModel: usersTable.carModel,
      carNumber: usersTable.carNumber,
      carClass: usersTable.carClass,
      groupId: usersTable.groupId,
      balance: usersTable.balance,
      rating: usersTable.rating,
      totalRides: usersTable.totalRides,
      acceptedOrders: usersTable.acceptedOrders,
      cancelledOrders: usersTable.cancelledOrders,
      activityScore: usersTable.activityScore,
      commissionRate: usersTable.commissionRate,
      createdAt: usersTable.createdAt,
    }).from(usersTable)
      .where(and(...driverConditions))
      .orderBy(asc(usersTable.name));

    const driverIds = drivers.map(d => d.id);

    let rideStats: any[] = [];
    if (driverIds.length > 0) {
      rideStats = await db.select({
        driverId: ridesTable.driverId,
        totalOrders: sql<number>`count(*)::int`,
        completedOrders: sql<number>`count(*) filter (where ${ridesTable.status} = 'completed')::int`,
        cancelledOrders: sql<number>`count(*) filter (where ${ridesTable.status} = 'cancelled')::int`,
        revenue: sql<number>`coalesce(sum(${ridesTable.price}), 0)::real`,
        commission: sql<number>`coalesce(sum(${ridesTable.commission}), 0)::real`,
        payout: sql<number>`coalesce(sum(${ridesTable.driverPayout}), 0)::real`,
      }).from(ridesTable)
        .where(and(
          inArray(ridesTable.driverId, driverIds),
          gte(ridesTable.createdAt, start),
          lte(ridesTable.createdAt, end),
        ))
        .groupBy(ridesTable.driverId);
    }

    const statsMap = Object.fromEntries(rideStats.map(s => [s.driverId, s]));

    const groups = await db.select().from(driverGroupsTable).where(eq(driverGroupsTable.isActive, true));
    const groupMap = Object.fromEntries(groups.map(g => [g.id, g.label]));

    const result = drivers.map(d => ({
      ...d,
      groupName: d.groupId ? groupMap[d.groupId] || null : null,
      periodStats: statsMap[d.id] || { totalOrders: 0, completedOrders: 0, cancelledOrders: 0, revenue: 0, commission: 0, payout: 0 },
    }));

    res.json({ drivers: result, groups });
  } catch (e: any) {
    handleErr(res, e);
  }
});

router.get("/clients", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const { start, end } = parseDateRange(req.query.from as string, req.query.to as string);

    const clients = await db.select({
      phone: ridesTable.riderPhone,
      name: sql<string>`max(${ridesTable.riderName})`,
      totalOrders: sql<number>`count(*)::int`,
      completedOrders: sql<number>`count(*) filter (where ${ridesTable.status} = 'completed')::int`,
      cancelledOrders: sql<number>`count(*) filter (where ${ridesTable.status} = 'cancelled')::int`,
      totalSpent: sql<number>`coalesce(sum(${ridesTable.price}), 0)::real`,
      avgPrice: sql<number>`coalesce(avg(${ridesTable.price}), 0)::real`,
      firstOrder: sql<string>`min(${ridesTable.createdAt})::text`,
      lastOrder: sql<string>`max(${ridesTable.createdAt})::text`,
    }).from(ridesTable)
      .where(and(
        gte(ridesTable.createdAt, start),
        lte(ridesTable.createdAt, end),
        sql`${ridesTable.riderPhone} is not null`,
      ))
      .groupBy(ridesTable.riderPhone)
      .orderBy(sql`count(*) desc`)
      .limit(5000);

    const summary = {
      totalClients: clients.length,
      totalOrders: clients.reduce((s, c) => s + c.totalOrders, 0),
      totalRevenue: clients.reduce((s, c) => s + c.totalSpent, 0),
    };

    res.json({ clients, summary });
  } catch (e: any) {
    handleErr(res, e);
  }
});

router.get("/cities", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const { start, end } = parseDateRange(req.query.from as string, req.query.to as string);

    const fromCities = await db.select({
      city: ridesTable.fromCity,
      direction: sql<string>`'departure'`,
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${ridesTable.status} = 'completed')::int`,
      cancelled: sql<number>`count(*) filter (where ${ridesTable.status} = 'cancelled')::int`,
      revenue: sql<number>`coalesce(sum(${ridesTable.price}), 0)::real`,
    }).from(ridesTable)
      .where(and(gte(ridesTable.createdAt, start), lte(ridesTable.createdAt, end)))
      .groupBy(ridesTable.fromCity)
      .orderBy(sql`count(*) desc`);

    const toCities = await db.select({
      city: ridesTable.toCity,
      direction: sql<string>`'arrival'`,
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${ridesTable.status} = 'completed')::int`,
      cancelled: sql<number>`count(*) filter (where ${ridesTable.status} = 'cancelled')::int`,
      revenue: sql<number>`coalesce(sum(${ridesTable.price}), 0)::real`,
    }).from(ridesTable)
      .where(and(gte(ridesTable.createdAt, start), lte(ridesTable.createdAt, end)))
      .groupBy(ridesTable.toCity)
      .orderBy(sql`count(*) desc`);

    const routes = await db.select({
      fromCity: ridesTable.fromCity,
      toCity: ridesTable.toCity,
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${ridesTable.status} = 'completed')::int`,
      revenue: sql<number>`coalesce(sum(${ridesTable.price}), 0)::real`,
      avgPrice: sql<number>`coalesce(avg(${ridesTable.price}), 0)::real`,
    }).from(ridesTable)
      .where(and(gte(ridesTable.createdAt, start), lte(ridesTable.createdAt, end)))
      .groupBy(ridesTable.fromCity, ridesTable.toCity)
      .orderBy(sql`count(*) desc`)
      .limit(100);

    res.json({ departures: fromCities, arrivals: toCities, routes });
  } catch (e: any) {
    handleErr(res, e);
  }
});

router.get("/driver-groups", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const { start, end } = parseDateRange(req.query.from as string, req.query.to as string);

    const groups = await db.select().from(driverGroupsTable).where(eq(driverGroupsTable.isActive, true));

    const groupStats = await db.select({
      groupId: usersTable.groupId,
      driverCount: sql<number>`count(distinct ${usersTable.id})::int`,
      onlineCount: sql<number>`count(distinct ${usersTable.id}) filter (where ${usersTable.status} = 'online')::int`,
      busyCount: sql<number>`count(distinct ${usersTable.id}) filter (where ${usersTable.status} = 'busy')::int`,
    }).from(usersTable)
      .where(and(eq(usersTable.role, "driver"), sql`${usersTable.groupId} is not null`))
      .groupBy(usersTable.groupId);

    const driverIds = await db.select({ id: usersTable.id, groupId: usersTable.groupId })
      .from(usersTable)
      .where(and(eq(usersTable.role, "driver"), sql`${usersTable.groupId} is not null`));

    const groupDriverIds: Record<number, number[]> = {};
    for (const d of driverIds) {
      if (d.groupId) {
        if (!groupDriverIds[d.groupId]) groupDriverIds[d.groupId] = [];
        groupDriverIds[d.groupId].push(d.id);
      }
    }

    const allIds = driverIds.map(d => d.id);
    let rideStats: any[] = [];
    if (allIds.length > 0) {
      rideStats = await db.select({
        driverId: ridesTable.driverId,
        totalOrders: sql<number>`count(*)::int`,
        completedOrders: sql<number>`count(*) filter (where ${ridesTable.status} = 'completed')::int`,
        cancelledOrders: sql<number>`count(*) filter (where ${ridesTable.status} = 'cancelled')::int`,
        revenue: sql<number>`coalesce(sum(${ridesTable.price}), 0)::real`,
        commission: sql<number>`coalesce(sum(${ridesTable.commission}), 0)::real`,
      }).from(ridesTable)
        .where(and(
          inArray(ridesTable.driverId, allIds),
          gte(ridesTable.createdAt, start),
          lte(ridesTable.createdAt, end),
        ))
        .groupBy(ridesTable.driverId);
    }

    const statsById = Object.fromEntries(rideStats.map(s => [s.driverId, s]));
    const groupStatsMap = Object.fromEntries(groupStats.map(g => [g.groupId, g]));

    const result = groups.map(g => {
      const ids = groupDriverIds[g.id] || [];
      const aggregated = ids.reduce((acc, id) => {
        const s = statsById[id];
        if (s) {
          acc.totalOrders += s.totalOrders;
          acc.completedOrders += s.completedOrders;
          acc.cancelledOrders += s.cancelledOrders;
          acc.revenue += s.revenue;
          acc.commission += s.commission;
        }
        return acc;
      }, { totalOrders: 0, completedOrders: 0, cancelledOrders: 0, revenue: 0, commission: 0 });

      const gStats = groupStatsMap[g.id] || { driverCount: 0, onlineCount: 0, busyCount: 0 };

      return {
        id: g.id,
        name: g.name,
        label: g.label,
        level: g.level,
        ...gStats,
        ...aggregated,
      };
    });

    res.json({ groups: result });
  } catch (e: any) {
    handleErr(res, e);
  }
});

router.get("/daily", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const { start, end } = parseDateRange(req.query.from as string, req.query.to as string);

    const daily = await db.select({
      date: sql<string>`date_trunc('day', ${ridesTable.createdAt})::date::text`,
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${ridesTable.status} = 'completed')::int`,
      cancelled: sql<number>`count(*) filter (where ${ridesTable.status} = 'cancelled')::int`,
      pending: sql<number>`count(*) filter (where ${ridesTable.status} = 'pending')::int`,
      revenue: sql<number>`coalesce(sum(${ridesTable.price}), 0)::real`,
      commission: sql<number>`coalesce(sum(${ridesTable.commission}), 0)::real`,
      avgPrice: sql<number>`coalesce(avg(${ridesTable.price}), 0)::real`,
      uniqueClients: sql<number>`count(distinct ${ridesTable.riderPhone})::int`,
      uniqueDrivers: sql<number>`count(distinct ${ridesTable.driverId})::int`,
    }).from(ridesTable)
      .where(and(gte(ridesTable.createdAt, start), lte(ridesTable.createdAt, end)))
      .groupBy(sql`date_trunc('day', ${ridesTable.createdAt})`)
      .orderBy(sql`date_trunc('day', ${ridesTable.createdAt})`);

    res.json({ daily });
  } catch (e: any) {
    handleErr(res, e);
  }
});

export default router;
