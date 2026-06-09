import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { startTestDb, stopTestDb } from "./setup.js";

// Regression test for the phantom-passenger bug: unassigning (or cancelling) a
// ride that was MERGED into a driver's trip used to leave the child ride's
// passenger copy behind in the parent trip's ride_passengers. The driver kept
// seeing a seat that no longer belonged to anyone.
//
// A merged child ride has trip_id set and its passengers copied into
// ride_passengers with ride_id = trip_id and an external_key in one of two
// shapes:
//   - "merged-ride-<childId>"             (manual merge / marketplace)
//   - "merged-ride-<childId>-pax-<n>"     (autodispatch accept; also "-seat-<n>")
//
// The fixed handlers in routes/rides/manage.ts delete BOTH shapes via an
// OR/LIKE match (eq(exactKey) OR like(`${exactKey}-%`)), recount the trip's
// seats, and — for unassign — clear the child's trip_id and reset it to pending.
//
// These tests drive the real Express handlers through supertest so the actual
// detach SQL runs, not a hand-copied imitation of it.

const SECRET = "test-session-secret-at-least-32-characters-long";

let app: any;
let db: any, usersTable: any, ridesTable: any, ridePassengersTable: any;
let dispatcherId = 0, driverId = 0;

const dispatcherToken = () => jwt.sign({ userId: dispatcherId, role: "dispatcher" }, SECRET, { expiresIn: "1h" });

beforeAll(async () => {
  const url = await startTestDb();
  process.env.DATABASE_URL = url;
  process.env.REDIS_URL = "redis://127.0.0.1:6379/15"; // isolated logical DB — never touches prod queues
  process.env.SESSION_SECRET = SECRET;
  process.env.NODE_ENV = "test";
  process.env.TELEGRAM_BOT_TOKEN = "test:dummy-token"; // satisfies the startup guard (no real sends in tests)

  // Clear the isolated rate-limit/dispatch DB so reruns are deterministic.
  const Redis = (await import("ioredis")).default;
  const flush = new Redis("redis://127.0.0.1:6379/15");
  await flush.flushdb();
  await flush.quit();

  const dbMod = await import("@workspace/db");
  db = dbMod.db;
  usersTable = dbMod.usersTable;
  ridesTable = dbMod.ridesTable;
  ridePassengersTable = dbMod.ridePassengersTable;
  app = (await import("../../src/app.js")).default;

  [{ id: dispatcherId }] = await db.insert(usersTable).values({
    phone: "+998900100002", name: "Disp", passwordHash: await bcrypt.hash("disp-pass-1", 10), role: "dispatcher",
  }).returning();
  [{ id: driverId }] = await db.insert(usersTable).values({
    phone: "+998900100003", name: "Drv", passwordHash: "x", role: "driver", status: "busy",
  }).returning();
}, 180_000);

afterAll(async () => { await stopTestDb(); });

/**
 * Build a driver trip with one own passenger plus a merged child ride whose
 * passenger has been copied into the trip under `mergedKey`. Returns the trip
 * and child ride ids. The trip starts with seats_taken/passengers = 2 (one own
 * + one merged) so a correct detach must recount down to exactly 1.
 */
async function seedMergedTrip(mergedKey: (childId: number) => string, childStatus = "merged") {
  const [trip] = await db.insert(ridesTable).values({
    driverId, status: "in_progress", price: 20000,
    fromCity: "Бухара", toCity: "Самарканд", passengers: 2, seatsTaken: 2, scheduledAt: new Date(),
  }).returning();

  const [child] = await db.insert(ridesTable).values({
    driverId, status: childStatus, tripId: trip.id, price: 10000, riderPhone: "+998905550010",
    fromCity: "Бухара", toCity: "Самарканд", passengers: 1, scheduledAt: new Date(),
  }).returning();

  // The trip's own rider (external_key NULL — must survive the detach).
  await db.insert(ridePassengersTable).values({
    rideId: trip.id, name: "Trip Owner", seatNumber: 1,
  });
  // The merged copy of the child's passenger (the phantom to be removed).
  await db.insert(ridePassengersTable).values({
    rideId: trip.id, name: "Merged Pax", seatNumber: 2, source: "autodispatch", externalKey: mergedKey(child.id),
  });

  return { tripId: trip.id, childId: child.id };
}

const tripPassengers = (tripId: number) =>
  db.select().from(ridePassengersTable).where(eq(ridePassengersTable.rideId, tripId));

const getRide = async (id: number) => {
  const [r] = await db.select().from(ridesTable).where(eq(ridesTable.id, id));
  return r;
};

describe("unassign-driver detaches a merged passenger from the parent trip", () => {
  it("removes the phantom passenger, recounts trip seats, and re-pends the child", async () => {
    const { tripId, childId } = await seedMergedTrip((c) => `merged-ride-${c}-pax-1`);

    const r = await request(app)
      .post(`/api/rides/${childId}/unassign-driver`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({});
    expect(r.status).toBe(200);

    // The merged copy is gone; the trip's own rider remains.
    const pax = await tripPassengers(tripId);
    expect(pax).toHaveLength(1);
    expect(pax[0].name).toBe("Trip Owner");
    expect(pax.some((p: any) => p.externalKey?.startsWith(`merged-ride-${childId}`))).toBe(false);

    // Trip seats recounted to the survivors (2 → 1).
    const trip = await getRide(tripId);
    expect(trip.seatsTaken).toBe(1);
    expect(trip.passengers).toBe(1);

    // Child detached from the trip and returned to the efir.
    const child = await getRide(childId);
    expect(child.tripId).toBeNull();
    expect(child.status).toBe("pending");
    expect(child.driverId).toBeNull();
  });
});

describe("cancel detaches a merged passenger for BOTH external_key formats", () => {
  // The OR/LIKE match must cover the exact key and the "-pax-<n>" suffix form.
  for (const variant of [
    { label: "exact key (merged-ride-<id>)", key: (c: number) => `merged-ride-${c}` },
    { label: "suffixed key (merged-ride-<id>-pax-<n>)", key: (c: number) => `merged-ride-${c}-pax-1` },
  ]) {
    it(`removes the phantom passenger and recounts trip seats — ${variant.label}`, async () => {
      const { tripId, childId } = await seedMergedTrip(variant.key);

      const r = await request(app)
        .post(`/api/rides/${childId}/cancel`)
        .set("Authorization", `Bearer ${dispatcherToken()}`)
        .send({ reason: "test" });
      expect(r.status).toBe(200);

      // Merged copy detached; own rider survives.
      const pax = await tripPassengers(tripId);
      expect(pax).toHaveLength(1);
      expect(pax[0].name).toBe("Trip Owner");
      expect(pax.some((p: any) => p.externalKey?.startsWith(`merged-ride-${childId}`))).toBe(false);

      // Trip seats recounted (2 → 1).
      const trip = await getRide(tripId);
      expect(trip.seatsTaken).toBe(1);
      expect(trip.passengers).toBe(1);

      // The cancelled child is marked cancelled.
      const child = await getRide(childId);
      expect(child.status).toBe("cancelled");
    });
  }
});
