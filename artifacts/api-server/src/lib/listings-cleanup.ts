import { db, marketplaceListingsTable, ridesTable } from "@workspace/db";
import { and, eq, lt, isNotNull, sql, inArray } from "drizzle-orm";
import { logger } from "./logger.js";
import { stopDispatchLoop } from "./autodispatch.js";

const SCAN_INTERVAL_MS = 5 * 60_000;

function timeSlotEndMs(slot: string | null, baseDate: Date): number | null {
  if (!slot) return null;
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(slot);
  if (!m) return null;
  const d = new Date(baseDate);
  d.setHours(parseInt(m[3], 10), parseInt(m[4], 10), 0, 0);
  return d.getTime();
}

async function expireOnce() {
  const now = new Date();
  try {
    const candidates = await db
      .select({
        id: marketplaceListingsTable.id,
        rideId: marketplaceListingsTable.rideId,
        scheduledAt: marketplaceListingsTable.scheduledAt,
      })
      .from(marketplaceListingsTable)
      .where(eq(marketplaceListingsTable.status, "active"));

    let expired = 0;
    for (const l of candidates) {
      const sched = l.scheduledAt ? new Date(l.scheduledAt) : null;
      if (!sched) continue;

      let endMs = sched.getTime();
      if (l.rideId) {
        const [ride] = await db.select({ timeSlot: ridesTable.timeSlot, isUrgent: ridesTable.isUrgent }).from(ridesTable).where(eq(ridesTable.id, l.rideId));
        if (ride?.timeSlot) {
          const slotEnd = timeSlotEndMs(ride.timeSlot, sched);
          if (slotEnd) endMs = slotEnd;
        }
      }
      // grace period 10 min for urgent without slot
      const graceMs = 10 * 60_000;
      if (now.getTime() < endMs + graceMs) continue;

      await db.update(marketplaceListingsTable)
        .set({ status: "expired" as any, updatedAt: new Date() })
        .where(and(eq(marketplaceListingsTable.id, l.id), eq(marketplaceListingsTable.status, "active")));
      if (l.rideId) {
        await db.update(ridesTable)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(and(eq(ridesTable.id, l.rideId), inArray(ridesTable.status, ["pending", "offered"])));
        try { stopDispatchLoop(l.rideId); } catch {}
      }
      expired++;
    }
    if (expired > 0) {
      logger.info({ expired }, "[listings-cleanup] expired listings");
    }
  } catch (err) {
    logger.warn({ err }, "[listings-cleanup] scan failed");
  }
}

let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

export function startListingsCleanupScheduler(): void {
  if (cleanupIntervalId) return;
  expireOnce().catch(() => {});
  cleanupIntervalId = setInterval(() => { expireOnce().catch(() => {}); }, SCAN_INTERVAL_MS);
  logger.info({ intervalMs: SCAN_INTERVAL_MS }, "[listings-cleanup] scheduler started");
}

export function stopListingsCleanupScheduler(): void {
  if (cleanupIntervalId) { clearInterval(cleanupIntervalId); cleanupIntervalId = null; }
}
