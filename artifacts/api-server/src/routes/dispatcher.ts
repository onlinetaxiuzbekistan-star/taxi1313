import { z } from "zod";
import { Router, type IRouter } from "express";
import { validateBody } from "../middlewares/validate.js";
import { clog } from "../lib/logger.js";
import { db, ridesTable, usersTable, orderOffersTable, safeUserColumns } from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { broadcastToAll, broadcastToUser } from "../lib/websocket.js";
import { completeRide } from "../lib/completion.js";
import { notifyOrderAssigned, notifyNewOrder } from "../lib/notifications.js";
import { applyCancelPenalty } from "../lib/bonuses.js";
import { authMiddleware, requireRole } from "../middlewares/auth.js";
import { getSettingNum } from "../lib/settingsCache.js";
import { resendOfferIfStillPending, scheduleAckTimeout, clearUnassignCooldownFor, citiesMatch } from "../lib/autodispatch.js";
import { haversineDistance } from "../lib/osrm.js";
import { resolveCitySlug } from "../lib/route-match.js";
import { CITIES } from "./rides/shared.js";

const dispatcherOfferBodySchema = z.object({
  rideId: z.union([z.number(), z.string()]),
  driverId: z.union([z.number(), z.string()]),
}).passthrough();

const dispatcherRideStatusBodySchema = z.object({
  status: z.string(),
}).passthrough();

const router: IRouter = Router();

router.use(authMiddleware, requireRole("dispatcher", "admin"));

/**
 * GET /api/dispatcher/assignable-drivers?rideId=<id>
 *
 * Drivers an operator can actually hand THIS order to. Two hard requirements:
 *   1. GENUINELY ACTIVE — status online|busy AND a FRESH GPS fix (the native app
 *      pings location while truly online). This excludes "ghost" drivers who
 *      aren't logged in but still carry a stale/leftover route ride in the DB.
 *   2. NEARBY — within `assign_radius_km` (default 40 km) of the order's pickup,
 *      computed from the driver's live GPS vs the order's from-coords.
 *
 * Returns two groups (both already filtered by active + nearby):
 *   - free:    online idle drivers
 *   - onRoute: busy drivers on a route with free seats whose route matches the
 *              order's cities (carpool seat-fill). sendOfferToDriver accepts busy
 *              drivers, so accepting merges the order into their route.
 */
router.get("/assignable-drivers", async (req: any, res) => {
  try {
    const rideId = Number(req.query.rideId) || null;
    const branchScope = req.userRole !== "admin" ? req.userBranchId : null;
    const branchCond = branchScope != null ? [eq(usersTable.branchId, branchScope)] : [];

    let order: any = null;
    if (rideId) {
      [order] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
    }

    // Pickup coords: prefer the order's own from-coords, else the city centroid.
    let pickup: { lat: number; lng: number } | null = null;
    if (order) {
      if (order.fromLat != null && order.fromLng != null) {
        pickup = { lat: Number(order.fromLat), lng: Number(order.fromLng) };
      } else if (order.fromCity) {
        const c = CITIES[resolveCitySlug(order.fromCity)];
        if (c) pickup = { lat: c.lat, lng: c.lng };
      }
    }

    const radiusKm = getSettingNum("assign_radius_km", 40);
    const gpsFreshSec = getSettingNum("assign_gps_fresh_seconds", 300);
    const gpsCutoff = new Date(Date.now() - gpsFreshSec * 1000);

    // distance (km) from pickup to a driver; null if either side lacks coords
    const distOf = (d: any): number | null => {
      if (!pickup || d.lat == null || d.lng == null) return null;
      return haversineDistance(pickup.lat, pickup.lng, Number(d.lat), Number(d.lng));
    };
    // keep a driver only if no pickup known (can't filter) or within radius
    const nearby = (d: any): boolean => {
      const km = distOf(d);
      if (pickup == null) return true;     // unknown pickup → don't distance-filter
      return km != null && km <= radiusKm; // require coords + within radius
    };
    const withDistance = (d: any, extra: any = {}) => {
      const km = distOf(d);
      return { ...d, distanceKm: km == null ? null : Math.round(km), ...extra };
    };

    // free = online idle drivers with a fresh GPS fix
    const onlineRows = await db.select(safeUserColumns).from(usersTable)
      .where(and(
        eq(usersTable.role, "driver"),
        eq(usersTable.status, "online"),
        sql`${usersTable.lastLocationUpdate} >= ${gpsCutoff}`,
        ...branchCond,
      ));
    const free = onlineRows.filter(nearby).map((d: any) => withDistance(d))
      .sort((a: any, b: any) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));

    // active routes with at least one free seat (driver-declared carpool rides)
    const routeRides = await db.select({
      driverId: ridesTable.driverId,
      rideId: ridesTable.id,
      fromCity: ridesTable.fromCity,
      toCity: ridesTable.toCity,
      seatsTotal: ridesTable.seatsTotal,
      seatsTaken: ridesTable.seatsTaken,
      timeSlot: ridesTable.timeSlot,
    }).from(ridesTable).where(and(
      inArray(ridesTable.status, ["accepted", "in_progress"]),
      sql`${ridesTable.driverId} IS NOT NULL`,
      sql`COALESCE(${ridesTable.seatsTotal}, 0) > COALESCE(${ridesTable.seatsTaken}, 0)`,
    ));

    const freeIds = new Set<number>(free.map((f: any) => f.id));
    const orderHasCities = !!(order && order.fromCity && order.toCity);

    // first matching route per driver
    const routeByDriver = new Map<number, typeof routeRides[number]>();
    for (const r of routeRides) {
      if (r.driverId == null || routeByDriver.has(r.driverId) || freeIds.has(r.driverId)) continue;
      if (orderHasCities) {
        if (!r.fromCity || !r.toCity) continue;
        if (!(citiesMatch(r.fromCity, order.fromCity) && citiesMatch(r.toCity, order.toCity))) continue;
      }
      routeByDriver.set(r.driverId, r);
    }

    const driverIds = [...routeByDriver.keys()];
    // onRoute drivers must ALSO be genuinely active (busy + fresh GPS) — this is
    // what excludes ghost drivers with stale leftover routes.
    const onRouteRows = driverIds.length
      ? await db.select(safeUserColumns).from(usersTable)
          .where(and(
            eq(usersTable.role, "driver"),
            inArray(usersTable.id, driverIds),
            eq(usersTable.status, "busy"),
            sql`${usersTable.lastLocationUpdate} >= ${gpsCutoff}`,
            ...branchCond,
          ))
      : [];

    const onRoute = onRouteRows.filter(nearby).map((d: any) => {
      const r = routeByDriver.get(d.id)!;
      return withDistance(d, {
        route: {
          rideId: r.rideId,
          fromCity: r.fromCity,
          toCity: r.toCity,
          freeSeats: (r.seatsTotal || 0) - (r.seatsTaken || 0),
          timeSlot: r.timeSlot,
        },
      });
    }).sort((a: any, b: any) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));

    res.json({ free, onRoute, radiusKm, total: free.length + onRoute.length });
  } catch (err) {
    req.log?.error?.({ err }, "assignable-drivers error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const allRides = await db.select().from(ridesTable).orderBy(desc(ridesTable.createdAt)).limit(200);
    const allDrivers = await db.select(safeUserColumns).from(usersTable).where(eq(usersTable.role, "driver"));
    const safeDrivers = allDrivers;

    const todayRides = allRides.filter(r => r.createdAt >= todayStart);
    const activeRides = allRides.filter(r => r.status === "in_progress").length;
    const pendingRides = allRides.filter(r => ["pending", "offered"].includes(r.status as string)).length;
    const completedToday = todayRides.filter(r => r.status === "completed").length;
    const revenueToday = todayRides.filter(r => r.status === "completed").reduce((s, r) => s + (r.price || 0), 0);
    const driversOnline = allDrivers.filter(d => d.status === "online" || d.status === "busy").length;
    const driversWithRide = allDrivers.filter(d => d.status === "busy").length;

    res.json({
      totalRidesToday: todayRides.length,
      activeRides, pendingRides,
      completedRidesToday: completedToday,
      revenueToday: Math.round(revenueToday),
      driversOnline, totalDrivers: allDrivers.length, driversWithRide,
      rides: allRides, drivers: safeDrivers,
    });
  } catch (err) {
    req.log.error({ err }, "Dispatcher stats error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

async function sendOfferToDriver(
  numRideId: number, numDriverId: number, log: any
): Promise<{ success: boolean; ride?: any; error?: string; status?: number }> {
  const [driver] = await db.select(safeUserColumns).from(usersTable).where(eq(usersTable.id, numDriverId));
  if (!driver) return { success: false, error: "Водитель не найден", status: 404 };

  if (driver.status !== "online" && driver.status !== "busy") {
    return { success: false, error: "Водитель не на линии", status: 400 };
  }

  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, numRideId));
  if (!ride) return { success: false, error: "Рейс не найден", status: 404 };

  if (!["pending", "new"].includes(ride.status as string)) {
    return { success: false, error: "Рейс уже назначен или завершён", status: 400 };
  }

  // Dispatcher is explicitly (re-)offering this ride to this driver — override any
  // unassign cooldown for this pair so the driver can accept right away (otherwise
  // the /accept guard rejects for up to 2 min after a manual unassign).
  await clearUnassignCooldownFor(numRideId, numDriverId);

  await db.update(orderOffersTable)
    .set({ status: "expired", respondedAt: new Date() })
    .where(and(
      eq(orderOffersTable.driverId, numDriverId),
      eq(orderOffersTable.status, "pending"),
    ));

  const dispatcherOfferTimeoutMs = getSettingNum("offer_timeout_seconds", 15) * 1000 * 2;

  const expiresAt = new Date(Date.now() + dispatcherOfferTimeoutMs);

  const [updatedRide] = await db.update(ridesTable).set({
    status: "offered", updatedAt: new Date(),
  }).where(and(eq(ridesTable.id, numRideId), inArray(ridesTable.status, ["pending", "offered"])))
    .returning();

  if (!updatedRide) {
    clog.log(`[SAFE OFFER] ride ${numRideId} already taken, skipping`);
    return { success: false, error: "Рейс уже принят другим водителем", status: 409 };
  }

  const [offer] = await db.insert(orderOffersTable).values({
    rideId: numRideId,
    driverId: numDriverId,
    status: "pending",
    expiresAt,
  }).returning();

  const offerId = offer.id;
  clog.log(`[SAFE OFFER] created offerId=${offerId}, rideId=${numRideId}, driverId=${numDriverId}`);

  clog.log(`[DISPATCH FLOW] driverId=${numDriverId}, rideId=${numRideId}, offerId=${offerId}, offerStatus=pending, action=dispatcher_send`);
  log.info({ driverId: numDriverId, rideId: numRideId, offerIdCreated: offerId }, "Sending WS new_order to driver");
  broadcastToUser(numDriverId, {
    type: "new_order",
    offerId,
    ride: updatedRide,
    expiresIn: dispatcherOfferTimeoutMs,
  });

  scheduleAckTimeout(offerId, numDriverId, numRideId);
  setTimeout(() => resendOfferIfStillPending(numDriverId, numRideId, dispatcherOfferTimeoutMs, offerId), 2000);

  notifyNewOrder(
    numDriverId, numRideId,
    updatedRide.fromCity || "", updatedRide.toCity || "",
    updatedRide.price || 0,
  ).catch(() => {});

  broadcastToAll({ type: "ride_updated", ride: updatedRide });

  setTimeout(async () => {
    try {
      const [offerCheck] = await db.select().from(orderOffersTable).where(
        and(eq(orderOffersTable.id, offerId), eq(orderOffersTable.status, "pending"))
      );
      if (!offerCheck) return;

      await db.update(orderOffersTable).set({
        status: "expired",
        respondedAt: new Date(),
      }).where(eq(orderOffersTable.id, offerId));

      const [rideCheck] = await db.select().from(ridesTable).where(eq(ridesTable.id, numRideId));
      if (rideCheck && rideCheck.status === "offered") {
        const hasOtherPending = await db.select({ id: orderOffersTable.id }).from(orderOffersTable).where(
          and(eq(orderOffersTable.rideId, numRideId), eq(orderOffersTable.status, "pending"))
        );
        if (hasOtherPending.length === 0) {
          await db.update(ridesTable).set({
            status: "pending", updatedAt: new Date(),
          }).where(eq(ridesTable.id, numRideId));

          const [resetRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, numRideId));
          broadcastToAll({ type: "ride_updated", ride: resetRide });
        }
      }

      broadcastToUser(numDriverId, { type: "order_expired", rideId: numRideId });
      log.info({ rideId: numRideId, driverId: numDriverId, offerId }, "Dispatcher offer expired");
    } catch (err) {
      log.error({ err }, "Offer timeout handler error");
    }
  }, dispatcherOfferTimeoutMs);

  return { success: true, ride: { ...updatedRide, offerSent: true, expiresIn: dispatcherOfferTimeoutMs } };
}

router.post("/assign", validateBody(dispatcherOfferBodySchema), async (req, res) => {
  try {
    const { rideId, driverId } = req.body;
    if (!rideId || !driverId) {
      res.status(400).json({ error: "validation_error", message: "rideId and driverId are required" });
      return;
    }

    const result = await sendOfferToDriver(Number(rideId), Number(driverId), req.log);
    if (!result.success) {
      res.status(result.status || 400).json({ error: "offer_error", message: result.error });
      return;
    }

    req.log.info({ rideId, driverId }, "Offer sent to driver via /assign");
    res.json(result.ride);
  } catch (err) {
    req.log.error({ err }, "Assign/offer driver error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/offer", validateBody(dispatcherOfferBodySchema), async (req, res) => {
  try {
    const { rideId, driverId } = req.body;
    if (!rideId || !driverId) {
      res.status(400).json({ error: "validation_error", message: "rideId and driverId are required" });
      return;
    }

    const result = await sendOfferToDriver(Number(rideId), Number(driverId), req.log);
    if (!result.success) {
      res.status(result.status || 400).json({ error: "offer_error", message: result.error });
      return;
    }

    req.log.info({ rideId, driverId }, "Offer sent to driver via /offer");
    res.json(result.ride);
  } catch (err) {
    req.log.error({ err }, "Offer ride error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.patch("/rides/:id/status", validateBody(dispatcherRideStatusBodySchema), async (req, res) => {
  try {
    const { status } = req.body;
    const rideId = Number(req.params.id);
    const allowed = ["pending", "offered", "in_progress", "completed", "cancelled"];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: "validation_error", message: `Status must be one of: ${allowed.join(", ")}. Статус 'accepted' устанавливается только при принятии водителем.` });
      return;
    }

    const [existing] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Ride not found" });
      return;
    }

    // "В пути"/accepted mean a driver is actively handling the order, so they
    // require an assigned driver. A free (unassigned) order can only be pending,
    // cancelled or completed — never in transit. This blocks the bad state where
    // a driverless order showed "В пути".
    if ((status === "in_progress" || status === "accepted") && !existing.driverId) {
      res.status(400).json({ error: "no_driver", message: "Сначала назначьте водителя — заказ без водителя не может быть «В пути»." });
      return;
    }

    // Completion with commission — idempotent centralized service
    if (status === "completed") {
      const result = await completeRide(rideId);
      if (!result.success) {
        const statusCode = result.error === "no_driver" || result.error === "no_price" ? 409 : 400;
        res.status(statusCode).json({ error: result.error || "completion_error", message: result.message || result.error || "Ошибка завершения" });
        return;
      }
      const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
      broadcastToAll({ type: "ride_updated", ride });
      res.json(ride);
      return;
    }

    // When accepting or starting, set driver to busy
    if ((status === "accepted" || status === "in_progress") && existing.driverId) {
      await db.update(usersTable).set({ status: "busy", updatedAt: new Date() }).where(eq(usersTable.id, existing.driverId));
    }

    if (status === "cancelled" && existing.driverId) {
      await db.update(usersTable).set({
        status: "online",
        updatedAt: new Date(),
      }).where(eq(usersTable.id, existing.driverId));
    }

    const [ride] = await db.update(ridesTable).set({ status, updatedAt: new Date() }).where(eq(ridesTable.id, rideId)).returning();
    broadcastToAll({ type: "ride_updated", ride });
    req.log.info({ rideId, status, driverId: existing.driverId }, "Ride status updated via dispatcher");
    res.json(ride);
  } catch (err) {
    req.log.error({ err }, "Update ride status error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
