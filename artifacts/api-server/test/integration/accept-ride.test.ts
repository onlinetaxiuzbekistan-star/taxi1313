import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { startTestDb, stopTestDb } from "./setup.js";

// Regression test for BUG C — accept-ride insert failure.
//
// /api/drivers/accept merges a child ride's passengers into the trip ride,
// inserting each with an external_key. The key used to be `merged-ride-<rideId>`
// for EVERY passenger, so a child ride with >1 passenger inserted two rows with
// the same (ride_id, external_key) and hit the unique index
// `ride_passengers_ride_external_key_uidx` → "duplicate key value violates
// unique constraint" → the whole accept failed (12x in prod).
//
// Fix: external_key is now unique per passenger (…-pax-<id> / …-seat-<n>) and
// the insert uses onConflictDoNothing() so a re-accept is idempotent.

let db: any;
let ridePassengersTable: any;

function merged(rideId: number, suffix: string) {
  return `merged-ride-${rideId}-${suffix}`;
}

async function insertPassenger(tripRideId: number, externalKey: string, seat: number) {
  return db
    .insert(ridePassengersTable)
    .values({
      rideId: tripRideId,
      name: "Пассажир",
      seatNumber: seat,
      source: "autodispatch",
      externalKey,
    })
    .onConflictDoNothing();
}

beforeAll(async () => {
  const url = await startTestDb();
  process.env.DATABASE_URL = url;
  const dbMod = await import("@workspace/db");
  db = dbMod.db;
  ridePassengersTable = dbMod.ridePassengersTable;
}, 180_000);

afterAll(async () => {
  await stopTestDb();
});

describe("accept-ride passenger merge (unique external_key)", () => {
  it("inserts multiple passengers from one child ride without colliding", async () => {
    const trip = 7001;
    // Two passengers from child ride 382 — distinct per-passenger keys.
    await expect(insertPassenger(trip, merged(382, "pax-1"), 1)).resolves.toBeDefined();
    await expect(insertPassenger(trip, merged(382, "pax-2"), 2)).resolves.toBeDefined();

    const rows = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, trip));
    expect(rows.length).toBe(2);
  });

  it("is idempotent on re-accept: same key is skipped, no duplicate, no throw", async () => {
    const trip = 7002;
    await insertPassenger(trip, merged(382, "pax-9"), 1);
    // Re-accept inserts the same (ride_id, external_key) — must NOT throw and
    // must NOT create a duplicate.
    await expect(insertPassenger(trip, merged(382, "pax-9"), 1)).resolves.toBeDefined();

    const rows = await db
      .select()
      .from(ridePassengersTable)
      .where(and(eq(ridePassengersTable.rideId, trip), eq(ridePassengersTable.externalKey, merged(382, "pax-9"))));
    expect(rows.length).toBe(1);
  });

  it("enforces the unique (ride_id, external_key) index (raw insert collides)", async () => {
    const trip = 7003;
    await db
      .insert(ridePassengersTable)
      .values({ rideId: trip, name: "A", seatNumber: 1, externalKey: merged(400, "pax-1") });
    // Same (ride_id, external_key) WITHOUT onConflictDoNothing must reject —
    // proving the index is present (matches prod) so the fix is meaningful.
    await expect(
      db
        .insert(ridePassengersTable)
        .values({ rideId: trip, name: "B", seatNumber: 2, externalKey: merged(400, "pax-1") }),
    ).rejects.toThrow();
  });
});
