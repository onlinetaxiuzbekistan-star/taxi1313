/**
 * Centralized ride completion service.
 *
 * - Idempotent: only applies if current status is NOT "completed"
 * - Atomic-like: checks-then-acts on a single ride
 * - Single source of truth for commission logic
 * - Cascades to merged client-rides linked via trip_id (added 2026-05-02)
 * - Options commission (Variant A): fixed per-option fee deducted from driver,
 *   percent commission applied to (price - optionsTotal). Added 2026-05-02.
 */
import { db, ridesTable, usersTable, transactionsTable, marketplaceListingsTable } from "@workspace/db";
import { eq, and, ne, sql, inArray } from "drizzle-orm";
import { logger } from "./logger.js";
import { checkMilestoneBonus } from "./bonuses.js";
import { broadcastToAll } from "./websocket.js";
import { getSettingNum } from "./settingsCache.js";
import { recordRideCompleted } from "./revenue-ai-prod.js";
import { debit, record, type DbTransaction } from "./ledger.js";

const STUCK_CHILD_STATUSES = ["merged", "in_progress", "accepted", "offered", "pending"] as const;

/**
 * Compute commission breakdown using Variant A:
 *   base_commission   = (price − optionsTotal) × percent + fixed
 *   options_commission = sum of fixed per-option commission (already saved on ride)
 *   total_commission   = base_commission + options_commission
 *   payout = price − total_commission
 */
export function computeCommission(price: number, optionsTotal: number, optionsCommission: number, rate: number, fixed: number, passengers: number = 1, roundTrip: boolean = false) {
  const cleanBase = Math.max(0, price - (optionsTotal || 0));
  const seats = Math.max(1, passengers || 1);
  const tripMultiplier = roundTrip ? 2 : 1;
  const fixedTotal = fixed * seats * tripMultiplier;
  const baseCommission = Math.round(cleanBase * rate + fixedTotal);
  const optsCom = Math.round(optionsCommission || 0);
  let totalCommission = baseCommission + optsCom;
  // Safety floor: never let driver payout go negative due to misconfigured options commission.
  if (totalCommission > price) {
    logger.warn({ price, optionsTotal, baseCommission, optsCom, totalCommission },
      "Commission exceeds ride price — clamping totalCommission to price (driver payout=0)");
    totalCommission = price;
  }
  const payout = Math.round(price - totalCommission);
  return { baseCommission, optsCom, totalCommission, payout };
}

async function cascadeCompleteChildren(tripRideId: number, fallbackDriverId: number) {
  const children = await db.select().from(ridesTable).where(
    and(
      eq(ridesTable.tripId, tripRideId),
      inArray(ridesTable.status, STUCK_CHILD_STATUSES as any)
    )
  );

  const allRideIds: number[] = [tripRideId];

  if (children.length === 0) {
    await db.execute(sql`
      UPDATE ride_passengers SET status = 'dropped_off'
      WHERE ride_id = ${tripRideId} AND status = 'waiting'
    `);
    return;
  }

  const commissionRate = getSettingNum("commission_percent", 10) / 100;
  const commissionFixed = getSettingNum("commission_fixed", 0);
  const commissionPercentLabel = getSettingNum("commission_percent", 10);

  for (const child of children) {
    const childDriverId = child.driverId ?? fallbackDriverId;
    if (!childDriverId) {
      logger.warn({ childId: child.id, tripRideId }, "Cascade: child has no driver — skipping");
      continue;
    }

    if (!child.price || child.price <= 0) {
      const [closed] = await db.update(ridesTable)
        .set({
          status: "completed",
          version: sql`COALESCE(${ridesTable.version}, 0) + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(ridesTable.id, child.id), ne(ridesTable.status, "completed")))
        .returning();
      if (closed) {
        allRideIds.push(child.id);
        logger.info({ childId: child.id, tripRideId }, "Cascade: closed unpaid child");
      }
      continue;
    }

    const childPrice = child.price;
    const { baseCommission, optsCom, totalCommission, payout: childPayout } =
      computeCommission(childPrice, child.optionsTotal || 0, child.optionsCommission || 0, commissionRate, commissionFixed, child.passengers || 1, !!child.roundTrip);
    const childCommission = totalCommission;

    // Atomic: ride status flip + balance debit + ledger rows succeed or fail together.
    // Row-lock the driver so concurrent completions serialize and balanceBefore/After stay truthful.
    const applied = await db.transaction(async (tx: DbTransaction) => {
      const [updated] = await tx.update(ridesTable)
        .set({
          status: "completed",
          commission: childCommission,
          driverPayout: childPayout,
          version: sql`COALESCE(${ridesTable.version}, 0) + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(ridesTable.id, child.id), ne(ridesTable.status, "completed")))
        .returning();

      if (!updated) return false;

      // Информационная запись: водитель получил наличные у клиента (баланс не меняется)
      await record(tx, {
        driverId: childDriverId,
        rideId: child.id,
        type: "income",
        amount: childPayout,
        description: `Поездка #${child.id} (через trip #${tripRideId}): ${childPayout.toLocaleString("ru-RU")} сум наличными у клиента`,
      });

      const optsLabel = optsCom > 0 ? ` + ${optsCom.toLocaleString("ru-RU")} за опции` : "";
      // Списание комиссии с баланса
      await debit(tx, {
        driverId: childDriverId,
        rideId: child.id,
        type: "commission",
        amount: childCommission,
        description: `Комиссия ${commissionPercentLabel}%${commissionFixed > 0 ? ` + ${commissionFixed} сум` : ""}${optsLabel} за поездку #${child.id} (через trip #${tripRideId})`,
      });

      // Driver activity counters (balance is handled by debit() above).
      await tx.update(usersTable).set({
        acceptedOrders: sql`accepted_orders + 1`,
        activityScore: sql`activity_score + 1`,
        updatedAt: new Date(),
      }).where(eq(usersTable.id, childDriverId));

      return true;
    });

    if (!applied) {
      logger.warn({ childId: child.id, tripRideId }, "Cascade: child completed concurrently");
      continue;
    }

    allRideIds.push(child.id);

    try {
      recordRideCompleted(childDriverId, childPrice);
    } catch (e) {
      logger.warn({ err: e, childId: child.id }, "recordRideCompleted failed in cascade (non-critical)");
    }

    logger.info(
      { childId: child.id, tripRideId, childDriverId, childPrice, childPayout, baseCommission, optsCom, totalCommission },
      "Cascade: client-ride completed with commission"
    );
  }

  if (allRideIds.length > 0) {
    await db.execute(sql`
      UPDATE ride_passengers SET status = 'dropped_off'
      WHERE ride_id = ANY(${allRideIds}::int[]) AND status = 'waiting'
    `);
  }

  for (const childId of allRideIds) {
    if (childId === tripRideId) continue;
    try {
      const soldListings = await db.select().from(marketplaceListingsTable).where(
        and(
          eq(marketplaceListingsTable.rideId, childId),
          inArray(marketplaceListingsTable.status, ["sold", "in_progress"])
        )
      );
      for (const listing of soldListings) {
        await db.update(marketplaceListingsTable).set({
          status: "completed",
          updatedAt: new Date(),
        }).where(eq(marketplaceListingsTable.id, listing.id));
      }
    } catch (err) {
      logger.warn({ err, childId }, "Cascade: marketplace settlement skipped (non-critical)");
    }
  }
}

export async function completeRide(rideId: number): Promise<{ success: boolean; error?: string; message?: string }> {
  const [existing] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
  if (!existing) return { success: false, error: "Ride not found" };

  if (existing.status === "completed") {
    if (existing.driverId) {
      try {
        await cascadeCompleteChildren(rideId, existing.driverId);
      } catch (err) {
        logger.warn({ err, rideId }, "Cascade on already-completed ride failed (non-critical)");
      }
    }
    logger.warn({ rideId }, "Ride already completed — cascade re-run, no double commission");
    return { success: true };
  }

  if (!existing.driverId) {
    logger.error({ rideId }, "[ERROR] MATCH_FAILED: NO_DRIVER — ride has no assigned driver");
    return { success: false, error: "no_driver", message: "Водитель не назначен на этот заказ" };
  }

  const isTripRide = !existing.riderPhone && existing.driverId !== null;

  if (!isTripRide && (!existing.price || existing.price <= 0)) {
    logger.error({ rideId, price: existing.price }, "[ERROR] MATCH_FAILED: NO_PRICE — ride has no valid price");
    return { success: false, error: "no_price", message: "Ошибка расчёта маршрута — цена не определена" };
  }

  const driverId = existing.driverId;

  if (isTripRide && (!existing.price || existing.price <= 0)) {
    const [updated] = await db.update(ridesTable)
      .set({ status: "completed", version: sql`COALESCE(${ridesTable.version}, 0) + 1`, updatedAt: new Date() })
      .where(and(eq(ridesTable.id, rideId), ne(ridesTable.status, "completed")))
      .returning();
    if (!updated) {
      logger.warn({ rideId }, "Ride was completed concurrently — no double commission");
      return { success: true };
    }
    await db.update(usersTable).set({
      totalRides: sql`total_rides + 1`,
      activityScore: sql`activity_score + 2`,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, driverId));
    // Driver stays online after completing a ride — only manual toggle changes status
    logger.info({ rideId, driverId }, "Trip ride completed (no commission). Driver stays online.");

    try {
      await cascadeCompleteChildren(rideId, driverId);
    } catch (err) {
      logger.error({ err, rideId }, "Cascade after trip-ride completion FAILED — manual review needed");
    }
  } else {
    const commissionRate = getSettingNum("commission_percent", 10) / 100;
    const commissionFixed = getSettingNum("commission_fixed", 0);
    const commissionPercentLabel = getSettingNum("commission_percent", 10);

    const price = existing.price!;
    const { baseCommission, optsCom, totalCommission: commission, payout: driverEarning } =
      computeCommission(price, existing.optionsTotal || 0, existing.optionsCommission || 0, commissionRate, commissionFixed, existing.passengers || 1, !!existing.roundTrip);

    // Atomic: ride status flip + balance debit + ledger rows succeed or fail together.
    // Row-lock the driver so concurrent completions serialize and balanceBefore/After stay truthful.
    const optsLabel = optsCom > 0 ? ` + ${optsCom.toLocaleString("ru-RU")} за опции` : "";
    const applied = await db.transaction(async (tx: DbTransaction) => {
      const [updated] = await tx.update(ridesTable)
        .set({
          status: "completed",
          commission,
          driverPayout: driverEarning,
          version: sql`COALESCE(${ridesTable.version}, 0) + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(ridesTable.id, rideId), ne(ridesTable.status, "completed")))
        .returning();

      if (!updated) return false;

      // Информационная запись: водитель получил наличные у клиента (баланс не меняется)
      await record(tx, {
        driverId,
        rideId,
        type: "income",
        amount: driverEarning,
        description: `Поездка #${rideId}: ${driverEarning.toLocaleString("ru-RU")} сум наличными у клиента`,
      });

      // Списание комиссии с баланса (наличные у водителя — он должен платформе только комиссию)
      await debit(tx, {
        driverId,
        rideId,
        type: "commission",
        amount: commission,
        description: `Комиссия ${commissionPercentLabel}%${commissionFixed > 0 ? ` + ${commissionFixed} сум × ${existing.passengers || 1} мест${existing.roundTrip ? " × 2 (туда-обратно)" : ""}` : ""}${optsLabel} за поездку #${rideId}`,
      });

      // Driver activity counters (balance is handled by debit() above).
      await tx.update(usersTable).set({
        totalRides: sql`total_rides + 1`,
        acceptedOrders: sql`accepted_orders + 1`,
        activityScore: sql`activity_score + 2`,
        updatedAt: new Date(),
      }).where(eq(usersTable.id, driverId));

      return true;
    });

    if (!applied) {
      logger.warn({ rideId }, "Ride was completed concurrently — no double commission");
      return { success: true };
    }

    logger.info({ rideId, driverId, price, driverEarning, baseCommission, optsCom, commission }, "Ride completed with commission. Driver stays online.");

    recordRideCompleted(driverId, price);

    try {
      await cascadeCompleteChildren(rideId, driverId);
    } catch (err) {
      logger.error({ err, rideId }, "Cascade after paid-ride completion FAILED — manual review needed");
    }
  }

  try {
    const bonusApplied = await checkMilestoneBonus(driverId);
    if (bonusApplied) {
      logger.info({ rideId, driverId }, "Milestone bonus applied");
    }
  } catch (err) {
    logger.warn({ err, driverId }, "Milestone bonus check failed (non-critical)");
  }

  try {
    const soldListings = await db.select().from(marketplaceListingsTable)
      .where(and(
        eq(marketplaceListingsTable.rideId, rideId),
        inArray(marketplaceListingsTable.status, ["sold", "in_progress"])
      ));

    for (const listing of soldListings) {
      await db.update(marketplaceListingsTable).set({
        status: "completed",
        updatedAt: new Date(),
      }).where(eq(marketplaceListingsTable.id, listing.id));

      if (listing.sellerId && listing.buyerId) {
        const sellerPayment = listing.price;

        const [buyerNow] = await db.select({ balance: usersTable.balance }).from(usersTable).where(eq(usersTable.id, listing.buyerId));
        const buyerBalBefore = parseFloat(buyerNow?.balance?.toString() || "0");
        const buyerBalAfter = buyerBalBefore - sellerPayment;

        await db.insert(transactionsTable).values({
          driverId: listing.buyerId,
          rideId,
          type: "commission",
          amount: String(sellerPayment),
          balanceBefore: String(buyerBalBefore),
          balanceAfter: String(buyerBalAfter),
          description: `Маркетплейс: оплата за покупку заказа #${rideId} продавцу`,
        });

        await db.update(usersTable).set({
          balance: sql`balance - ${sellerPayment}`,
          updatedAt: new Date(),
        }).where(eq(usersTable.id, listing.buyerId));

        const [sellerNow] = await db.select({ balance: usersTable.balance }).from(usersTable).where(eq(usersTable.id, listing.sellerId));
        const sellerBalBefore = parseFloat(sellerNow?.balance?.toString() || "0");
        const sellerBalAfter = sellerBalBefore + sellerPayment;

        await db.insert(transactionsTable).values({
          driverId: listing.sellerId,
          rideId,
          type: "income",
          amount: String(sellerPayment),
          balanceBefore: String(sellerBalBefore),
          balanceAfter: String(sellerBalAfter),
          description: `Маркетплейс: продажа заказа #${rideId} — ${sellerPayment.toLocaleString("ru-RU")} сум`,
        });

        await db.update(usersTable).set({
          balance: sql`balance + ${sellerPayment}`,
          updatedAt: new Date(),
        }).where(eq(usersTable.id, listing.sellerId));

        broadcastToAll({ type: "marketplace_listing_completed", listingId: listing.id, sellerId: listing.sellerId });
        logger.info({ rideId, listingId: listing.id, sellerId: listing.sellerId, buyerId: listing.buyerId, sellerPayment }, "Marketplace settlement: buyer debited, seller credited");
      }
    }
  } catch (err) {
    logger.error({ err, rideId }, "Marketplace completion settlement failed");
  }

  return { success: true };
}
