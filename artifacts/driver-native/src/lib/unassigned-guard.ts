// Belt-and-suspenders guard: after the operator pulls an order back from this
// driver, suppress any re-offer of the SAME ride on THIS device for a cooldown
// window. The authoritative fix is server-side (addUnassignCooldown in the
// backend unassign handler); this just prevents the offer popup from bouncing
// the driver straight back into the order they were just removed from.
const COOLDOWN_MS = 2 * 60 * 1000; // 2 min — matches backend UNASSIGN_COOLDOWN_MS

const recentlyUnassigned = new Map<number, number>(); // rideId -> expiresAt

export function markUnassigned(rideId: number | null | undefined) {
  if (rideId == null) return;
  recentlyUnassigned.set(rideId, Date.now() + COOLDOWN_MS);
}

export function isRecentlyUnassigned(rideId: number | null | undefined): boolean {
  if (rideId == null) return false;
  const exp = recentlyUnassigned.get(rideId);
  if (exp == null) return false;
  if (Date.now() > exp) {
    recentlyUnassigned.delete(rideId);
    return false;
  }
  return true;
}
