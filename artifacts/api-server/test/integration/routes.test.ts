import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { startTestDb, stopTestDb } from "./setup.js";

const SECRET = "test-session-secret-at-least-32-characters-long";

let app: any;
let db: any, usersTable: any, ridesTable: any, driverSessionsTable: any, settingsTable: any, marketplaceListingsTable: any;
let adminId = 0, dispatcherId = 0, driverId = 0, otherDriverId = 0, rideId = 0;
let driverAuthToken = ""; // driver JWT backed by a real session (passes authMiddleware)
let buyerAuthToken = "";  // second driver, for marketplace buy

const tokenFor = (id: number, role: string) => jwt.sign({ userId: id, role }, SECRET, { expiresIn: "1h" });
let ipCounter = 0;
const freshIp = () => `10.1.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`;

beforeAll(async () => {
  const url = await startTestDb();
  process.env.DATABASE_URL = url;
  process.env.REDIS_URL = "redis://127.0.0.1:6379/15"; // isolated logical DB — never touches prod queues
  process.env.SESSION_SECRET = SECRET;
  process.env.NODE_ENV = "test";
  process.env.TELEGRAM_BOT_TOKEN = "test:dummy-token"; // satisfies the startup guard (no real sends in tests)

  // Clear the isolated rate-limit DB so reruns are deterministic (db 15 is test-only).
  const Redis = (await import("ioredis")).default;
  const flush = new Redis("redis://127.0.0.1:6379/15");
  await flush.flushdb();
  await flush.quit();

  const dbMod = await import("@workspace/db");
  db = dbMod.db; usersTable = dbMod.usersTable; ridesTable = dbMod.ridesTable;
  driverSessionsTable = dbMod.driverSessionsTable;
  settingsTable = dbMod.settingsTable; marketplaceListingsTable = dbMod.marketplaceListingsTable;
  app = (await import("../../src/app.js")).default;

  [{ id: adminId }] = await db.insert(usersTable).values({
    phone: "+998900000001", name: "Admin", passwordHash: await bcrypt.hash("admin-pass-1", 10), role: "admin",
  }).returning();
  [{ id: dispatcherId }] = await db.insert(usersTable).values({
    phone: "+998900000002", name: "Disp", passwordHash: await bcrypt.hash("disp-pass-1", 10), role: "dispatcher",
  }).returning();
  [{ id: driverId }] = await db.insert(usersTable).values({
    phone: "+998900000003", name: "Drv", passwordHash: "x", role: "driver",
  }).returning();
  [{ id: otherDriverId }] = await db.insert(usersTable).values({
    phone: "+998900000004", name: "Other", passwordHash: "x", role: "driver",
  }).returning();
  [{ id: rideId }] = await db.insert(ridesTable).values({
    driverId, status: "accepted", price: 10000, riderPhone: "+998901112233",
    fromCity: "Бухара", toCity: "Самарканд", passengers: 1, scheduledAt: new Date(),
  }).returning();

  // authMiddleware requires drivers to present a valid session (sid).
  const sid = "test-session-token-driver";
  await db.insert(driverSessionsTable).values({
    driverId, sessionToken: sid, expiresAt: new Date(Date.now() + 3600_000),
  });
  driverAuthToken = jwt.sign({ userId: driverId, role: "driver", sid }, SECRET, { expiresIn: "1h" });

  // Buyer driver session (for marketplace buy).
  const sid2 = "test-session-token-buyer";
  await db.insert(driverSessionsTable).values({
    driverId: otherDriverId, sessionToken: sid2, expiresAt: new Date(Date.now() + 3600_000),
  });
  buyerAuthToken = jwt.sign({ userId: otherDriverId, role: "driver", sid: sid2 }, SECRET, { expiresIn: "1h" });

  // Webhook credentials (settings.category = "payments").
  await db.insert(settingsTable).values([
    { key: "paynet_enabled", value: "true", category: "payments" },
    { key: "paynet_username", value: "paynet-user", category: "payments" },
    { key: "paynet_password", value: "paynet-pass-secret", category: "payments" },
    { key: "payme_enabled", value: "true", category: "payments" },
    { key: "payme_merchant_key", value: "payme-key-secret", category: "payments" },
  ]);
}, 180_000);

afterAll(async () => { await stopTestDb(); });

describe("POST /auth/register", () => {
  it("accepts a valid driver registration", async () => {
    const r = await request(app).post("/api/auth/register").set("X-Forwarded-For", freshIp()).send({
      phone: "+998905550001", name: "New Driver", password: "secret12345", role: "driver",
    });
    expect([200, 201]).toContain(r.status);
  });

  it("rejects an invalid role", async () => {
    const r = await request(app).post("/api/auth/register").set("X-Forwarded-For", freshIp()).send({
      phone: "+998905550002", name: "X", password: "secret123", role: "rider",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation_error");
  });

  it("rejects a too-short password", async () => {
    const r = await request(app).post("/api/auth/register").set("X-Forwarded-For", freshIp()).send({
      phone: "+998905550003", name: "X", password: "123", role: "driver",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation_error");
  });
});

describe("POST /auth/login", () => {
  it("logs in with correct credentials and returns a token", async () => {
    const r = await request(app).post("/api/auth/login").set("X-Forwarded-For", freshIp()).send({
      phone: "+998900000001", password: "admin-pass-1",
    });
    expect(r.status).toBe(200);
    expect(typeof r.body.token).toBe("string");
  });

  it("rejects a wrong password", async () => {
    const r = await request(app).post("/api/auth/login").set("X-Forwarded-For", freshIp()).send({
      phone: "+998900000001", password: "wrong-pass",
    });
    expect(r.status).toBe(401);
  });

  it("rate-limits repeated attempts from one IP", async () => {
    const ip = freshIp();
    let got429 = false;
    for (let i = 0; i < 12; i++) {
      const r = await request(app).post("/api/auth/login").set("X-Forwarded-For", ip).send({
        phone: "+998900000001", password: "wrong-pass",
      });
      if (r.status === 429) { got429 = true; break; }
    }
    expect(got429).toBe(true);
  });
});

describe("GET /rides/:id (field-level authorization / IDOR)", () => {
  it("returns a sanitized view to unauthenticated guests (no financials/contacts)", async () => {
    const r = await request(app).get(`/api/rides/${rideId}`);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(rideId);
    expect(r.body.commission).toBeUndefined();
    expect(r.body.driverPayout).toBeUndefined();
    expect(r.body.riderPhone).toBeUndefined();
  });

  it("does not leak the full record to an unrelated driver (IDOR)", async () => {
    const r = await request(app).get(`/api/rides/${rideId}`)
      .set("Authorization", `Bearer ${tokenFor(otherDriverId, "driver")}`);
    expect(r.status).toBe(200);
    expect(r.body.riderPhone).toBeUndefined(); // not the assigned driver → sanitized
  });

  it("gives the assigned driver the full record", async () => {
    const r = await request(app).get(`/api/rides/${rideId}`)
      .set("Authorization", `Bearer ${tokenFor(driverId, "driver")}`);
    expect(r.status).toBe(200);
    expect(r.body.riderPhone).toBe("+998901112233"); // assigned driver → full
  });
});

describe("POST /staff (privilege escalation fix)", () => {
  it("allows an admin to create staff", async () => {
    const r = await request(app).post("/api/staff")
      .set("Authorization", `Bearer ${tokenFor(adminId, "admin")}`)
      .send({ name: "New Disp", password: "disp-pass-9", role: "dispatcher" });
    expect([200, 201]).toContain(r.status);
  });

  it("rejects a dispatcher creating staff (403)", async () => {
    const r = await request(app).post("/api/staff")
      .set("Authorization", `Bearer ${tokenFor(dispatcherId, "dispatcher")}`)
      .send({ name: "Hacker", password: "disp-pass-9", role: "admin" });
    expect(r.status).toBe(403);
  });
});

describe("POST /payments/deposit/init", () => {
  it("requires authentication", async () => {
    const r = await request(app).post("/api/payments/deposit/init").send({ amount: 5000, cardDbId: 1 });
    expect(r.status).toBe(401);
  });

  it("rejects an invalid body (missing amount)", async () => {
    const r = await request(app).post("/api/payments/deposit/init")
      .set("Authorization", `Bearer ${driverAuthToken}`)
      .send({ cardDbId: 1 });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation_error");
  });
});

describe("Marketplace sell/buy flow", () => {
  let listingRideId = 0;
  let createdListingId = 0;

  it("seller lists a ride for sale", async () => {
    // A pending ride owned by the seller (sell accepts accepted|pending; buy needs pending|offered).
    [{ id: listingRideId }] = await db.insert(ridesTable).values({
      driverId, status: "pending", price: 8000, riderPhone: "+998905550010",
      fromCity: "Бухара", toCity: "Самарканд", passengers: 1, scheduledAt: new Date(),
    }).returning();

    const r = await request(app).post("/api/marketplace/sell")
      .set("Authorization", `Bearer ${driverAuthToken}`)
      .send({ rideId: listingRideId, price: 8000 });
    expect(r.status).toBe(200);
    expect(r.body.listing?.id).toBeGreaterThan(0);
    createdListingId = r.body.listing.id;

    const [listing] = await db.select().from(marketplaceListingsTable)
      .where(eq(marketplaceListingsTable.id, createdListingId));
    expect(listing.status).toBe("active");
  });

  it("another driver buys the listing and is assigned the ride", async () => {
    const r = await request(app).post("/api/marketplace/buy")
      .set("Authorization", `Bearer ${buyerAuthToken}`)
      .send({ listingId: createdListingId });
    expect(r.status).toBe(200);

    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, listingRideId));
    expect(ride.driverId).toBe(otherDriverId); // reassigned to the buyer
  });

  it("rejects a sell with a missing price (validation)", async () => {
    const r = await request(app).post("/api/marketplace/sell")
      .set("Authorization", `Bearer ${driverAuthToken}`)
      .send({ rideId: listingRideId });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation_error");
  });
});

describe("Payment webhook auth (paynet)", () => {
  const basic = (u: string, p: string) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

  it("rejects wrong credentials with 401", async () => {
    const r = await request(app).post("/api/paynet/jsonrpc")
      .set("Authorization", basic("paynet-user", "WRONG"))
      .send({ jsonrpc: "2.0", id: 1, method: "GetInformation", params: {} });
    expect(r.status).toBe(401);
  });

  it("accepts correct credentials (not 401)", async () => {
    const r = await request(app).post("/api/paynet/jsonrpc")
      .set("Authorization", basic("paynet-user", "paynet-pass-secret"))
      .send({ jsonrpc: "2.0", id: 2, method: "GetInformation", params: {} });
    expect(r.status).not.toBe(401);
  });
});

describe("Payment webhook auth (payme)", () => {
  const basic = (u: string, p: string) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

  it("returns an auth error for a wrong merchant key", async () => {
    const r = await request(app).post("/api/payme/")
      .set("Authorization", basic("Paycom", "WRONG-KEY"))
      .send({ id: 1, method: "CheckPerformTransaction", params: {} });
    expect(r.body?.error?.code).toBe(-32504); // Payme auth error
  });

  it("passes auth with the correct merchant key (no auth error)", async () => {
    const r = await request(app).post("/api/payme/")
      .set("Authorization", basic("Paycom", "payme-key-secret"))
      .send({ id: 2, method: "CheckPerformTransaction", params: {} });
    expect(r.body?.error?.code).not.toBe(-32504);
  });
});

describe("POST /rides (create) validation", () => {
  it("rejects a body missing toCity", async () => {
    const r = await request(app).post("/api/rides").send({ fromCity: "Бухара" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation_error");
  });

  it("rejects a body missing fromCity", async () => {
    const r = await request(app).post("/api/rides").send({ toCity: "Самарканд" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation_error");
  });
});

describe("Rides read endpoints", () => {
  it("GET /rides/cities returns 200", async () => {
    const r = await request(app).get("/api/rides/cities");
    expect(r.status).toBe(200);
  });

  it("GET /rides/pricing-info returns 200", async () => {
    const r = await request(app).get("/api/rides/pricing-info");
    expect(r.status).toBe(200);
  });

  it("GET /rides (public list) returns 200", async () => {
    const r = await request(app).get("/api/rides");
    expect(r.status).toBe(200);
  });

  it("GET /rides (list) works for a dispatcher", async () => {
    const r = await request(app).get("/api/rides").set("Authorization", `Bearer ${tokenFor(dispatcherId, "dispatcher")}`);
    expect(r.status).toBe(200);
  });

  it("GET /rides/:id returns 404 for a missing ride", async () => {
    const r = await request(app).get("/api/rides/99999999");
    expect(r.status).toBe(404);
  });
});

describe("PATCH /rides/:id + cancel (status management)", () => {
  async function seedRide(status = "accepted") {
    const [r] = await db.insert(ridesTable).values({
      driverId, status, price: 12000, riderPhone: "+998905559000",
      fromCity: "Бухара", toCity: "Самарканд", passengers: 1, scheduledAt: new Date(),
    }).returning();
    return r.id;
  }

  it("requires auth for PATCH /rides/:id", async () => {
    const rid = await seedRide();
    const r = await request(app).patch(`/api/rides/${rid}`).send({ status: "in_progress" });
    expect(r.status).toBe(401);
  });

  it("rejects a driver (non-dispatcher) PATCH /rides/:id with 403", async () => {
    const rid = await seedRide();
    const r = await request(app).patch(`/api/rides/${rid}`)
      .set("Authorization", `Bearer ${driverAuthToken}`)
      .send({ status: "in_progress" });
    expect(r.status).toBe(403);
  });

  it("lets a dispatcher cancel a ride", async () => {
    const rid = await seedRide("accepted");
    const r = await request(app).post(`/api/rides/${rid}/cancel`)
      .set("Authorization", `Bearer ${tokenFor(dispatcherId, "dispatcher")}`)
      .send({ reason: "test" });
    expect([200, 201]).toContain(r.status);
    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rid));
    expect(ride.status).toBe("cancelled");
  });
});

describe("Marketplace edge cases", () => {
  it("GET /listings works for a driver", async () => {
    const r = await request(app).get("/api/marketplace/listings").set("Authorization", `Bearer ${driverAuthToken}`);
    expect(r.status).toBe(200);
  });

  it("rejects selling a ride you do not own (403)", async () => {
    // ride owned by driverId; otherDriver (buyer) tries to sell it
    const [r2] = await db.insert(ridesTable).values({
      driverId, status: "pending", price: 5000, riderPhone: "+998905559001",
      fromCity: "Бухара", toCity: "Самарканд", passengers: 1, scheduledAt: new Date(),
    }).returning();
    const r = await request(app).post("/api/marketplace/sell")
      .set("Authorization", `Bearer ${buyerAuthToken}`)
      .send({ rideId: r2.id, price: 5000 });
    expect(r.status).toBe(403);
  });

  it("rejects buying a non-existent listing", async () => {
    const r = await request(app).post("/api/marketplace/buy")
      .set("Authorization", `Bearer ${buyerAuthToken}`)
      .send({ listingId: 99999999 });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

describe("Dispatch service via active-rides", () => {
  it("GET /drivers/:driverId/active-rides (dispatcher) returns 200", async () => {
    const r = await request(app).get(`/api/drivers/${driverId}/active-rides`)
      .set("Authorization", `Bearer ${tokenFor(dispatcherId, "dispatcher")}`);
    expect(r.status).toBe(200);
  });
});

describe("Staff + payments edge cases", () => {
  it("rejects a dispatcher deleting staff (403)", async () => {
    const r = await request(app).delete(`/api/staff/${dispatcherId}`)
      .set("Authorization", `Bearer ${tokenFor(dispatcherId, "dispatcher")}`);
    expect(r.status).toBe(403);
  });

  it("GET /payments/cards requires auth", async () => {
    const r = await request(app).get("/api/payments/cards");
    expect(r.status).toBe(401);
  });

  it("GET /payments/balance works for a driver", async () => {
    const r = await request(app).get("/api/payments/balance").set("Authorization", `Bearer ${driverAuthToken}`);
    expect(r.status).toBe(200);
    expect(typeof r.body.balance).toBe("number");
  });
});

describe("Paynet webhook method handling", () => {
  const basic = (u: string, p: string) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
  it("returns method-not-found for an unknown method (authed)", async () => {
    const r = await request(app).post("/api/paynet/jsonrpc")
      .set("Authorization", basic("paynet-user", "paynet-pass-secret"))
      .send({ jsonrpc: "2.0", id: 9, method: "NopeMethod", params: {} });
    expect(r.status).not.toBe(401);
    expect(r.body.error).toBeTruthy();
  });
});

describe("Additional coverage", () => {
  it("GET /staff requires auth", async () => {
    const r = await request(app).get("/api/staff");
    expect(r.status).toBe(401);
  });

  it("GET /staff works for an admin", async () => {
    const r = await request(app).get("/api/staff").set("Authorization", `Bearer ${tokenFor(adminId, "admin")}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.staff)).toBe(true);
  });

  it("admin can PATCH a staff member", async () => {
    const [s] = await db.insert(usersTable).values({
      phone: "+998900007777", name: "Patch Me", passwordHash: "x", role: "dispatcher",
    }).returning();
    const r = await request(app).patch(`/api/staff/${s.id}`)
      .set("Authorization", `Bearer ${tokenFor(adminId, "admin")}`)
      .send({ name: "Patched Name" });
    expect(r.status).toBe(200);
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, s.id));
    expect(u.name).toBe("Patched Name");
  });

  it("GET /payments/history works for a driver", async () => {
    const r = await request(app).get("/api/payments/history").set("Authorization", `Bearer ${driverAuthToken}`);
    expect(r.status).toBe(200);
  });

  it("payme CheckPerformTransaction passes auth with the correct key", async () => {
    const basic = "Basic " + Buffer.from("Paycom:payme-key-secret").toString("base64");
    const r = await request(app).post("/api/payme/")
      .set("Authorization", basic)
      .send({ id: 7, method: "CheckPerformTransaction", params: { account: { phone: "+998900000003" }, amount: 500000 } });
    expect(r.body?.error?.code).not.toBe(-32504); // auth passed
  });

  it("paynet rejects a missing method (authed)", async () => {
    const basic = "Basic " + Buffer.from("paynet-user:paynet-pass-secret").toString("base64");
    const r = await request(app).post("/api/paynet/jsonrpc")
      .set("Authorization", basic)
      .send({ jsonrpc: "2.0", id: 8, params: {} });
    expect(r.status).not.toBe(401);
    expect(r.body.error).toBeTruthy();
  });
});
