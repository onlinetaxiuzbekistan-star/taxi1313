import { Router, type IRouter } from "express";
import { clog } from "../lib/logger.js";
import { db, ridesTable, usersTable, orderOffersTable } from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { broadcastToAll, broadcastToUser } from "../lib/websocket.js";
import { completeRide } from "../lib/completion.js";
import { notifyOrderAssigned, notifyNewOrder } from "../lib/notifications.js";
import { applyCancelPenalty } from "../lib/bonuses.js";
import { authMiddleware, requireRole } from "../middlewares/auth.js";
import { getSettingNum } from "../lib/settingsCache.js";
import { resendOfferIfStillPending, scheduleAckTimeout } from "../lib/autodispatch.js";

const router: IRouter = Router();

router.use(authMiddleware, requireRole("dispatcher", "admin"));

router.get("/stats", async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const allRides = await db.select().from(ridesTable).orderBy(desc(ridesTable.createdAt)).limit(200);
    const allDrivers = await db.select().from(usersTable).where(eq(usersTable.role, "driver"));
    const safeDrivers = allDrivers.map(({ passwordHash: _, ...d }) => d);

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
  const [driver] = await db.select().from(usersTable).where(eq(usersTable.id, numDriverId));
  if (!driver) return { success: false, error: "Водитель не найден", status: 404 };

  if (driver.status !== "online" && driver.status !== "busy") {
    return { success: false, error: "Водитель не на линии", status: 400 };
  }

  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, numRideId));
  if (!ride) return { success: false, error: "Рейс не найден", status: 404 };

  if (!["pending", "new"].includes(ride.status as string)) {
    return { success: false, error: "Рейс уже назначен или завершён", status: 400 };
  }

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

router.post("/assign", async (req, res) => {
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

router.post("/offer", async (req, res) => {
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

router.patch("/rides/:id/status", async (req, res) => {
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
