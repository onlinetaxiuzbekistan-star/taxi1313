import { db, ridesTable, settingsTable, orderOffersTable } from "@workspace/db";
import { eq, and, inArray, lt, sql, isNotNull } from "drizzle-orm";
import { sendSms, getNotificationSettings } from "./sms.js";
import { broadcastToAll } from "./websocket.js";

const CHECK_INTERVAL_MS = 60 * 1000;

async function getCancelConfig(): Promise<{
  enabled: boolean;
  graceMinutes: number;
  fallbackMinutes: number;
}> {
  const rows = await db.select().from(settingsTable);
  const map = new Map(rows.map(r => [r.key, r.value]));
  const grace = parseInt(map.get("auto_cancel_grace_minutes") || "5") || 5;
  const fallback = parseInt(map.get("order_auto_cancel_minutes") || "60") || 60;
  return {
    enabled: map.get("order_auto_cancel_enabled") !== "false",
    graceMinutes: Math.max(0, Math.min(grace, 1440)),
    fallbackMinutes: Math.max(10, Math.min(fallback, 1440)),
  };
}

function parseTimeSlotEnd(slot: string | null, scheduledAt: Date): Date | null {
  if (!slot) return null;
  const m = slot.trim().match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const endH = parseInt(m[3], 10);
  const endM = parseInt(m[4], 10);
  const TZ = 5; // Tashkent UTC+5
  const sched = new Date(scheduledAt);
  // Local-Tashkent date components for the scheduled day
  const local = new Date(sched.getTime() + TZ * 3600_000);
  const y = local.getUTCFullYear();
  const mo = local.getUTCMonth();
  const dd = local.getUTCDate();
  // Slot end in UTC: local end-time minus TZ offset
  let endUtc = Date.UTC(y, mo, dd, endH - TZ, endM, 0, 0);
  // If slot end is at/before scheduledAt, the slot is for the next local day
  while (endUtc <= sched.getTime()) {
    endUtc += 24 * 3600_000;
  }
  return new Date(endUtc);
}

async function autoCancelStaleOrders() {
  try {
    const config = await getCancelConfig();
    if (!config.enabled) return;

    const now = Date.now();
    const graceMs = config.graceMinutes * 60 * 1000;
    const fallbackMs = config.fallbackMinutes * 60 * 1000;

    const candidates = await db.select().from(ridesTable)
      .where(inArray(ridesTable.status, ["pending", "offered"]));

    if (candidates.length === 0) return;

    const stale: typeof candidates = [];
    for (const r of candidates) {
      const sched = r.scheduledAt ? new Date(r.scheduledAt).getTime() : 0;
      const created = r.createdAt ? new Date(r.createdAt).getTime() : 0;
      const slotEnd = parseTimeSlotEnd((r as any).timeSlot || null, r.scheduledAt as any);
      const effectiveTime = slotEnd ? slotEnd.getTime() : sched;

      if (effectiveTime > 0 && effectiveTime + graceMs < now) {
        stale.push(r);
        continue;
      }
      if (effectiveTime === 0 && created > 0 && created + fallbackMs < now) {
        stale.push(r);
      }
    }

    if (stale.length === 0) return;

    console.log(`[AUTO-CANCEL] Found ${stale.length} stale orders (grace=${config.graceMinutes}m, fallback=${config.fallbackMinutes}m)`);

    const notifSettings = await getNotificationSettings();
    const smsText = notifSettings["sms_text_auto_cancelled"] ||
      "Такси 1313: К сожалению, мы не смогли найти машину для вашего заказа. Приносим извинения за неудобства. В следующий раз обязательно найдём!";
    const shouldSend = notifSettings["sms_on_order_cancelled"] !== "false";

    for (const order of stale) {
      try {
        const [cancelled] = await db.update(ridesTable)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(and(
            eq(ridesTable.id, order.id),
            inArray(ridesTable.status, ["pending", "offered"]),
          ))
          .returning();

        if (!cancelled) continue;

        await db.update(orderOffersTable)
          .set({ status: "expired", respondedAt: new Date() })
          .where(and(
            eq(orderOffersTable.rideId, order.id),
            eq(orderOffersTable.status, "pending"),
          ));

        broadcastToAll({ type: "ride_updated", ride: cancelled });
        broadcastToAll({ type: "ride_auto_cancelled", rideId: order.id });

        if (order.riderPhone && shouldSend) {
          try {
            const result = await sendSms(order.riderPhone, smsText);
            console.log(`[AUTO-CANCEL] SMS to ${order.riderPhone} for ride #${order.id}: ${result.success ? "OK" : "FAIL " + (result.error || "")}`);
          } catch (e) {
            console.error(`[AUTO-CANCEL] SMS error for #${order.id}:`, e);
          }
        }

        console.log(`[AUTO-CANCEL] Cancelled #${order.id} sched=${order.scheduledAt} slot=${(order as any).timeSlot || "—"} phone=${order.riderPhone || "—"}`);
      } catch (err) {
        console.error(`[AUTO-CANCEL] Error cancelling #${order.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[AUTO-CANCEL] Scheduler error:", err);
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;
let rideCleanupIntervalId: ReturnType<typeof setInterval> | null = null;
let bootTimeouts: ReturnType<typeof setTimeout>[] = [];



const RIDE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const RIDE_GRACE_MS = 60 * 60 * 1000;

async function cleanupExpiredRides() {
  try {
    const cancelled = await db.execute(sql`
      UPDATE rides SET status='cancelled', updated_at=NOW()
      WHERE status='accepted'
        AND NOW() > (scheduled_at + (COALESCE(duration, 60) || ' minutes')::interval + INTERVAL '1 hour')
        AND passengers = 0
      RETURNING id, driver_id, scheduled_at
    `);
    const rows = (cancelled as any).rows || cancelled || [];
    if (rows.length > 0) {
      console.log(`[RIDE-CLEANUP] Cancelled ${rows.length} expired empty rides: ${rows.map((r: any) => '#' + r.id).join(', ')}`);
      for (const r of rows) {
        broadcastToAll({ type: "ride_updated", ride: { id: r.id, status: "cancelled" } });
      }
    }
  } catch (err) {
    console.error("[RIDE-CLEANUP] Error:", err);
  }
}

export function startAutoCancelScheduler() {
  if (intervalId) return;
  console.log(`[AUTO-CANCEL] Scheduler started (every ${CHECK_INTERVAL_MS / 1000}s, by scheduledAt+grace)`);
  intervalId = setInterval(autoCancelStaleOrders, CHECK_INTERVAL_MS);
  bootTimeouts.push(setTimeout(autoCancelStaleOrders, 15_000));

  rideCleanupIntervalId = setInterval(cleanupExpiredRides, RIDE_CLEANUP_INTERVAL_MS);
  bootTimeouts.push(setTimeout(cleanupExpiredRides, 30_000));
  console.log(`[RIDE-CLEANUP] Scheduler started (every ${RIDE_CLEANUP_INTERVAL_MS / 1000}s, grace=1h after expiry)`);
}

export function stopAutoCancelScheduler() {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  if (rideCleanupIntervalId) { clearInterval(rideCleanupIntervalId); rideCleanupIntervalId = null; }
  for (const t of bootTimeouts) clearTimeout(t);
  bootTimeouts = [];
}

export { autoCancelStaleOrders };
