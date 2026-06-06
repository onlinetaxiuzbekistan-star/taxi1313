import { db, usersTable, transactionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { getSettingNum } from "./settingsCache.js";

async function addDriverTransaction(
  driverId: number,
  type: "bonus" | "penalty",
  amount: number,
  description: string,
): Promise<void> {
  const [driver] = await db.select({ balance: usersTable.balance }).from(usersTable).where(eq(usersTable.id, driverId));
  const balBefore = parseFloat(driver?.balance?.toString() || "0");
  const delta = type === "penalty" ? -amount : amount;
  const balAfter = balBefore + delta;

  await db.insert(transactionsTable).values({
    driverId,
    type,
    amount: String(Math.abs(amount)),
    balanceBefore: String(balBefore),
    balanceAfter: String(balAfter),
    description,
  });

  await db.update(usersTable).set({
    balance: sql`balance + ${delta}`,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, driverId));

  logger.info({ driverId, type, amount: delta, description }, "Driver transaction applied");
}

export async function checkMilestoneBonus(driverId: number): Promise<boolean> {
  const milestoneBonus = getSettingNum("milestone_bonus_amount", 50000);
  const milestoneInterval = getSettingNum("milestone_interval", 10);

  const [driver] = await db.select({
    totalRides: usersTable.totalRides,
  }).from(usersTable).where(eq(usersTable.id, driverId));

  const rides = driver?.totalRides ?? 0;
  if (rides > 0 && milestoneInterval > 0 && rides % milestoneInterval === 0) {
    await addDriverTransaction(
      driverId, "bonus", milestoneBonus,
      `Бонус за ${rides} выполненных поездок: ${milestoneBonus.toLocaleString("ru-RU")} сум`,
    );
    return true;
  }
  return false;
}

export async function applyCancelPenalty(driverId: number, rideId: number): Promise<void> {
  const cancelPenalty = getSettingNum("cancel_penalty_amount", 10000);

  await addDriverTransaction(
    driverId, "penalty", cancelPenalty,
    `Штраф за отмену заказа #${rideId}: -${cancelPenalty.toLocaleString("ru-RU")} сум`,
  );

  await db.update(usersTable).set({
    activityScore: sql`GREATEST(activity_score - 5, 0)`,
    cancelledOrders: sql`cancelled_orders + 1`,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, driverId));
}

export async function applyIgnorePenalty(driverId: number, rideId: number): Promise<void> {
  const ignorePenalty = getSettingNum("ignore_penalty_amount", 5000);
  const banThreshold = getSettingNum("max_consecutive_ignores", 5);
  const banDurationMs = getSettingNum("ban_duration_minutes", 10) * 60 * 1000;

  await addDriverTransaction(
    driverId, "penalty", ignorePenalty,
    `Штраф за игнор заказа #${rideId}: -${ignorePenalty.toLocaleString("ru-RU")} сум`,
  );

  const [updated] = await db.update(usersTable).set({
    activityScore: sql`GREATEST(activity_score - 3, 0)`,
    consecutiveIgnores: sql`consecutive_ignores + 1`,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, driverId))
    .returning({ consecutiveIgnores: usersTable.consecutiveIgnores });

  const newCount = updated?.consecutiveIgnores ?? 0;

  if (newCount >= banThreshold) {
    const bannedUntil = new Date(Date.now() + banDurationMs);
    await db.update(usersTable).set({
      bannedUntil,
      status: "offline",
      consecutiveIgnores: 0,
    }).where(eq(usersTable.id, driverId));

    logger.warn(
      { driverId, newCount, bannedUntil },
      `Driver temp-banned for ${banDurationMs / 60000} min after ${banThreshold} consecutive ignores`,
    );
  }
}

export function resetConsecutiveIgnores(driverId: number): void {
  db.update(usersTable).set({
    consecutiveIgnores: 0,
    activityScore: sql`LEAST(activity_score + 5, 10)`,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, driverId)).catch(err => {
    logger.warn({ err, driverId }, "Failed to reset consecutiveIgnores (non-critical)");
  });
}

export function isDriverBanned(driver: { bannedUntil?: Date | null }): boolean {
  if (!driver.bannedUntil) return false;
  return new Date(driver.bannedUntil) > new Date();
}

export function getBanRemainingMs(driver: { bannedUntil?: Date | null }): number {
  if (!driver.bannedUntil) return 0;
  const remaining = new Date(driver.bannedUntil).getTime() - Date.now();
  return Math.max(0, remaining);
}

export async function handleStatusToggle(driverId: number, newStatus: string): Promise<{ allowed: boolean; penalized: boolean }> {
  const statusToggleWindowMs = 60 * 60 * 1000;
  const statusToggleLimit = 10;
  const statusTogglePenaltyScore = 5;

  const [driver] = await db.select({
    status: usersTable.status,
    statusToggleCount: usersTable.statusToggleCount,
    lastStatusToggle: usersTable.lastStatusToggle,
  }).from(usersTable).where(eq(usersTable.id, driverId));

  if (!driver) return { allowed: true, penalized: false };

  if (driver.status === newStatus) {
    return { allowed: true, penalized: false };
  }

  const now = Date.now();
  const lastToggle = driver.lastStatusToggle ? new Date(driver.lastStatusToggle).getTime() : 0;
  const windowExpired = (now - lastToggle) > statusToggleWindowMs;

  let newCount = windowExpired ? 1 : (driver.statusToggleCount ?? 0) + 1;

  const updates: Record<string, any> = {
    statusToggleCount: newCount,
    lastStatusToggle: new Date(),
    updatedAt: new Date(),
  };

  let penalized = false;

  if (newCount > statusToggleLimit) {
    updates.activityScore = sql`GREATEST(activity_score - ${statusTogglePenaltyScore}, 0)`;
    penalized = true;
    logger.warn(
      { driverId, toggleCount: newCount },
      "Driver penalized for excessive status toggling",
    );
  }

  await db.update(usersTable).set(updates).where(eq(usersTable.id, driverId));

  return { allowed: true, penalized };
}

export async function applyReferralBonus(inviterId: number, inviteeId: number): Promise<void> {
  const referralInviter = getSettingNum("referral_bonus_inviter", 30000);
  const referralInvitee = getSettingNum("referral_bonus_invitee", 20000);

  await addDriverTransaction(
    inviterId, "bonus", referralInviter,
    `Реферальный бонус за приглашение водителя #${inviteeId}: ${referralInviter.toLocaleString("ru-RU")} сум`,
  );

  await addDriverTransaction(
    inviteeId, "bonus", referralInvitee,
    `Приветственный бонус по реферальной программе: ${referralInvitee.toLocaleString("ru-RU")} сум`,
  );
}

export function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "BUX-";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
