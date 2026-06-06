// @ts-nocheck
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";
import { startTestDb, stopTestDb } from "./setup.js";

// Populated in beforeAll AFTER DATABASE_URL points at the container, so the
// @workspace/db singleton (and everything that imports it) uses the test DB.
let db: any;
let usersTable: any, ridesTable: any, transactionsTable: any, driverSessionsTable: any;
let completeRide: (rideId: number) => Promise<any>;
let credit: any;

let driverSeq = 0;
async function makeDriver(balance = "5000"): Promise<number> {
  driverSeq++;
  const [u] = await db.insert(usersTable).values({
    phone: `+99890000${String(driverSeq).padStart(4, "0")}`,
    name: `Driver ${driverSeq}`,
    passwordHash: "x",
    role: "driver",
    balance,
  }).returning();
  return u.id;
}

async function makeRide(driverId: number, price = 10000): Promise<number> {
  const [r] = await db.insert(ridesTable).values({
    driverId,
    status: "accepted",
    price,
    riderPhone: "+998901112233",
    fromCity: "Бухара",
    toCity: "Самарканд",
    passengers: 1,
    scheduledAt: new Date(),
  }).returning();
  return r.id;
}

beforeAll(async () => {
  const url = await startTestDb();
  process.env.DATABASE_URL = url;
  const dbMod = await import("@workspace/db");
  db = dbMod.db;
  usersTable = dbMod.usersTable;
  ridesTable = dbMod.ridesTable;
  transactionsTable = dbMod.transactionsTable;
  driverSessionsTable = dbMod.driverSessionsTable;
  ({ completeRide } = await import("../../src/lib/completion.js"));
  ({ credit } = await import("../../src/lib/ledger.js"));
});

afterAll(async () => {
  await stopTestDb();
});

describe("completeRide (real Postgres transaction)", () => {
  it("completes atomically: status, commission debit, two ledger rows", async () => {
    const driverId = await makeDriver("5000");
    const rideId = await makeRide(driverId, 10000);

    const res = await completeRide(rideId);
    expect(res.success).toBe(true);

    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
    expect(ride.status).toBe("completed");
    expect(Number(ride.commission)).toBe(1000); // default 10%
    expect(Number(ride.driverPayout)).toBe(9000);

    const [driver] = await db.select().from(usersTable).where(eq(usersTable.id, driverId));
    expect(Number(driver.balance)).toBe(4000); // 5000 - 1000 commission

    const txs = await db.select().from(transactionsTable).where(eq(transactionsTable.rideId, rideId));
    const income = txs.find((t: any) => t.type === "income");
    const commission = txs.find((t: any) => t.type === "commission");
    expect(Number(income.amount)).toBe(9000);
    expect(Number(commission.amount)).toBe(1000);
    expect(Number(commission.balanceAfter)).toBe(4000);
  });

  it("is idempotent: re-completing does not double-charge", async () => {
    const driverId = await makeDriver("5000");
    const rideId = await makeRide(driverId, 10000);

    await completeRide(rideId);
    await completeRide(rideId); // second call must be a no-op for the balance

    const [driver] = await db.select().from(usersTable).where(eq(usersTable.id, driverId));
    expect(Number(driver.balance)).toBe(4000); // still debited only once

    const commissionRows = (await db.select().from(transactionsTable)
      .where(and(eq(transactionsTable.rideId, rideId), eq(transactionsTable.type, "commission"))));
    expect(commissionRows.length).toBe(1);
  });

  it("concurrent completion: row lock + CAS prevents double commission", async () => {
    const driverId = await makeDriver("5000");
    const rideId = await makeRide(driverId, 10000);

    // Fire two completions at once; only one should apply the commission.
    await Promise.all([completeRide(rideId), completeRide(rideId)]);

    const [driver] = await db.select().from(usersTable).where(eq(usersTable.id, driverId));
    expect(Number(driver.balance)).toBe(4000); // debited exactly once

    const commissionRows = await db.select().from(transactionsTable)
      .where(and(eq(transactionsTable.rideId, rideId), eq(transactionsTable.type, "commission")));
    expect(commissionRows.length).toBe(1);
  });
});

describe("payment top-up (real ledger rows)", () => {
  it("credits balance and writes one income row with correct before/after", async () => {
    const driverId = await makeDriver("0");

    const result = await db.transaction((tx: any) =>
      credit(tx, {
        driverId,
        type: "income",
        amount: 50000,
        description: "Пополнение через Atmos: 50 000 сум",
      }),
    );
    expect(result.balanceBefore).toBe(0);
    expect(result.balanceAfter).toBe(50000);

    const [driver] = await db.select().from(usersTable).where(eq(usersTable.id, driverId));
    expect(Number(driver.balance)).toBe(50000);

    const txs = await db.select().from(transactionsTable).where(eq(transactionsTable.driverId, driverId));
    expect(txs.length).toBe(1);
    expect(Number(txs[0].amount)).toBe(50000);
    expect(Number(txs[0].balanceBefore)).toBe(0);
    expect(Number(txs[0].balanceAfter)).toBe(50000);
  });
});

describe("auth (real bcrypt + real session persistence)", () => {
  it("verifies a bcrypt hash stored in the real DB", async () => {
    const hash = await bcrypt.hash("s3cret-pass", 10);
    driverSeq++;
    const [u] = await db.insert(usersTable).values({
      phone: `+99891000${String(driverSeq).padStart(4, "0")}`,
      name: "Auth User",
      passwordHash: hash,
      role: "dispatcher",
    }).returning();

    const [fetched] = await db.select().from(usersTable).where(eq(usersTable.id, u.id));
    expect(fetched.passwordHash.startsWith("$2")).toBe(true);
    await expect(bcrypt.compare("s3cret-pass", fetched.passwordHash)).resolves.toBe(true);
    await expect(bcrypt.compare("wrong-pass", fetched.passwordHash)).resolves.toBe(false);
  });

  it("persists and reads back a driver session", async () => {
    const driverId = await makeDriver();
    const token = "sess_" + driverId + "_abc";
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.insert(driverSessionsTable).values({
      driverId,
      sessionToken: token,
      expiresAt,
    });

    const [sess] = await db.select().from(driverSessionsTable)
      .where(eq(driverSessionsTable.driverId, driverId));
    expect(sess.sessionToken).toBe(token);
    expect(new Date(sess.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});
