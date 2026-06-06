import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { startTestDb, stopTestDb } from "./setup.js";

// Regression test for the merged-trip passenger cascade (BUG B).
//
// The cascade previously ran raw SQL:
//   UPDATE ride_passengers SET status='dropped_off'
//   WHERE ride_id = ANY(${allRideIds}::int[]) AND status='waiting'
// Drizzle expands a JS array into `($1, $2)`, so this became
//   ANY(($1, $2)::int[])  -> Postgres: "cannot cast record to integer[]"
// and every multi-ride completion failed ("manual review needed").
//
// The fix uses the query builder's inArray(). This test inserts passengers
// across several ride_ids with mixed statuses and asserts the multi-id update
// (a) does not throw and (b) flips exactly the right rows.

let db: any;
let ridePassengersTable: any;

async function addPassenger(rideId: number, seat: number, status: string) {
  const [p] = await db
    .insert(ridePassengersTable)
    .values({ rideId, name: `P${rideId}-${seat}`, seatNumber: seat, status })
    .returning();
  return p.id;
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

describe("merged-trip passenger cascade (array param)", () => {
  it("flips only 'waiting' passengers of the listed rides, without throwing", async () => {
    // trip ride + two child rides share the drop-off cascade
    const wA = await addPassenger(9001, 1, "waiting");      // -> dropped_off
    const wB = await addPassenger(9002, 1, "waiting");      // -> dropped_off
    const pickedUp = await addPassenger(9001, 2, "picked_up"); // listed ride, but not waiting -> unchanged
    const other = await addPassenger(9003, 1, "waiting");   // ride NOT in the cascade -> unchanged

    const allRideIds = [9001, 9002];

    // The exact pattern the fixed cascade now uses. The old raw ANY(...::int[])
    // would have thrown here.
    await expect(
      db
        .update(ridePassengersTable)
        .set({ status: "dropped_off" })
        .where(and(inArray(ridePassengersTable.rideId, allRideIds), eq(ridePassengersTable.status, "waiting"))),
    ).resolves.toBeDefined();

    const statusOf = async (id: number) => {
      const [r] = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.id, id));
      return r.status as string;
    };

    expect(await statusOf(wA)).toBe("dropped_off");
    expect(await statusOf(wB)).toBe("dropped_off");
    expect(await statusOf(pickedUp)).toBe("picked_up"); // not waiting → untouched
    expect(await statusOf(other)).toBe("waiting");       // ride not in list → untouched
  });

  it("handles a single-element array (one ride) correctly", async () => {
    const w = await addPassenger(9101, 1, "waiting");
    await expect(
      db
        .update(ridePassengersTable)
        .set({ status: "dropped_off" })
        .where(and(inArray(ridePassengersTable.rideId, [9101]), eq(ridePassengersTable.status, "waiting"))),
    ).resolves.toBeDefined();
    const [r] = await db.select().from(ridePassengersTable).where(eq(ridePassengersTable.id, w));
    expect(r.status).toBe("dropped_off");
  });
});
