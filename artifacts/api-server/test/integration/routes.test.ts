import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { startTestDb, stopTestDb } from "./setup.js";

const SECRET = "test-session-secret-at-least-32-characters-long";

let app: any;
let db: any, usersTable: any, ridesTable: any, driverSessionsTable: any;
let adminId = 0, dispatcherId = 0, driverId = 0, otherDriverId = 0, rideId = 0;
let driverAuthToken = ""; // driver JWT backed by a real session (passes authMiddleware)

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
