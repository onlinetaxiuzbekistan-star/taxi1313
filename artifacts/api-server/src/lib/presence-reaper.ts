/**
 * Presence reaper — reconciles the denormalized `users.status` column with
 * reality for drivers.
 *
 * Why not key off the WebSocket connection? The driver app's JS thread (and thus
 * its JS WebSocket) FREEZES when the phone screen is off, but the native
 * LocationForegroundService keeps sending GPS fixes via PATCH /api/drivers/location
 * the whole time. So a genuinely-online driver on the road (screen off) has NO live
 * WS but IS reachable and IS updating `last_location_update`. The truthful presence
 * signal is therefore GPS freshness, not the socket.
 *
 * A driver is reaped online→offline when they have stopped sending GPS for longer
 * than the threshold (app fully closed / killed). We only ever downgrade `online`
 * → `offline`; a `busy` driver is mid-trip and keeps that status until the ride
 * flow completes it. This keeps the dispatcher's assign-driver list, the online
 * count, and the dispatch candidate pool honest without dropping active drivers.
 */
import { clog } from "./logger.js";
import { db, usersTable, ridesTable } from "@workspace/db";
import { and, eq, or, isNull, lt, inArray, notExists, sql } from "drizzle-orm";
import { getSettingNum } from "./settingsCache.js";
import { enqueueDriverStatusBroadcast } from "./websocket.js";

const CHECK_INTERVAL_MS = 60_000;
// Online must stay ON until the driver taps Offline themselves — we only reap a
// driver who is GENUINELY GONE (app closed/killed). The native foreground GPS
// service pings while online even when backgrounded/screen-off, so a long GPS
// silence reliably means the app is no longer running. 15 min is deliberately
// generous so an active driver (parked, waiting for an order) is NEVER auto-
// offlined; it only cleans up true ghosts. Tunable via `driver_offline_after_seconds`.
const DEFAULT_THRESHOLD_SECONDS = 900;

let intervalId: ReturnType<typeof setInterval> | null = null;
let bootTimeout: ReturnType<typeof setTimeout> | null = null;

async function reapStaleOnlineDrivers(): Promise<void> {
  try {
    const thresholdSec = Math.max(60, getSettingNum("driver_offline_after_seconds", DEFAULT_THRESHOLD_SECONDS));
    const cutoff = new Date(Date.now() - thresholdSec * 1000);

    // online → offline when GPS is stale. The `updated_at < cutoff` guard protects
    // a driver who JUST tapped "go online" but hasn't sent their first GPS fix yet
    // (PATCH /status bumps updated_at), so we don't reap them in the first window.
    const staleGps = or(isNull(usersTable.lastLocationUpdate), lt(usersTable.lastLocationUpdate, cutoff));

    // Case 1: online → offline when GPS is stale.
    const reapedOnline = await db
      .update(usersTable)
      .set({ status: "offline", updatedAt: new Date() })
      .where(
        and(
          eq(usersTable.role, "driver"),
          eq(usersTable.status, "online"),
          lt(usersTable.updatedAt, cutoff),
          staleGps,
        ),
      )
      .returning({ id: usersTable.id });

    // Case 2: busy → offline when GPS is stale AND the driver has NO active ride.
    // A driver genuinely mid-trip ALWAYS has an active ride row, so the NOT EXISTS
    // guard protects them even if their GPS momentarily lapses (tunnel / battery).
    // This only catches "busy" left dangling with no ride behind it.
    const noActiveRide = notExists(
      db.select({ one: sql`1` }).from(ridesTable).where(
        and(
          eq(ridesTable.driverId, usersTable.id),
          inArray(ridesTable.status, ["accepted", "in_progress", "offered", "merged"]),
        ),
      ),
    );
    const reapedBusy = await db
      .update(usersTable)
      .set({ status: "offline", updatedAt: new Date() })
      .where(
        and(
          eq(usersTable.role, "driver"),
          eq(usersTable.status, "busy"),
          lt(usersTable.updatedAt, cutoff),
          staleGps,
          noActiveRide,
        ),
      )
      .returning({ id: usersTable.id });

    const reaped = [...reapedOnline, ...reapedBusy];
    if (reaped.length > 0) {
      clog.log(`[PRESENCE-REAPER] set ${reaped.length} stale driver(s) offline (online=${reapedOnline.length}, dangling-busy=${reapedBusy.length}; no GPS for ${thresholdSec}s)`);
      for (const r of reaped) enqueueDriverStatusBroadcast(r.id, "offline");
    }
  } catch (err) {
    clog.log(`[PRESENCE-REAPER] sweep failed: ${String(err)}`);
  }
}

export function startPresenceReaper(): void {
  if (intervalId) return;
  clog.log(`[PRESENCE-REAPER] started (every ${CHECK_INTERVAL_MS / 1000}s, default threshold ${DEFAULT_THRESHOLD_SECONDS}s)`);
  intervalId = setInterval(reapStaleOnlineDrivers, CHECK_INTERVAL_MS);
  bootTimeout = setTimeout(reapStaleOnlineDrivers, 20_000);
}

export function stopPresenceReaper(): void {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  if (bootTimeout) { clearTimeout(bootTimeout); bootTimeout = null; }
}

export { reapStaleOnlineDrivers };
