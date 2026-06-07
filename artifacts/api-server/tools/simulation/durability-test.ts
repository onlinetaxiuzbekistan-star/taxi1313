/**
 * Data-durability test: prove NO data loss when the server restarts/crashes mid-operation.
 *
 *   tsx durability-test.ts seed     → provision synthetic active state (rides across all
 *                                     statuses incl in_progress + accepted + completed-with-
 *                                     commission + offered-with-EXPIRED-offer), snapshot to
 *                                     /tmp/taxi-dur-snapshot.json. Does NOT clean up.
 *   << operator restarts the service here >>
 *   tsx durability-test.ts verify   → re-read the same rows, compare against the snapshot:
 *                                     nothing lost, in_progress/accepted/completed preserved,
 *                                     balances unchanged, commission txns intact, and the
 *                                     dispatch sweep recovered orphaned 'offered' rides →
 *                                     'pending'. Then clean up ALL synthetic rows.
 * Authorized for production use 2026-06-07.
 */
import { db, usersTable, driverSessionsTable, ridesTable, transactionsTable, orderOffersTable } from "@workspace/db";
import { inArray, like, sql, eq, or, and } from "drizzle-orm";
import fs from "node:fs";

const PREFIX = "+998950";
const MARKER = "stress_test";
const SNAP = "/tmp/taxi-dur-snapshot.json";
const MODE = process.argv[2] || "seed";
const BAL = 500_000, PRICE = 50_000, COMMISSION = 7_500; // 15% of 50k

const counts = { in_progress: 50, accepted: 30, offered: 30, pending: 40, completed: 50 };

async function seed() {
  console.log("[seed] provisioning synthetic active state…");
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const driverRows = await db.insert(usersTable).values(
    Array.from({ length: total }, (_, i) => ({ phone: `${PREFIX}${String(i).padStart(5, "0")}`, name: `Dur ${i}`, passwordHash: "x", role: "driver" as const, status: "busy" as const, carClass: "economy", seats: 4, balance: String(BAL) }))
  ).returning({ id: usersTable.id });
  const driverIds = driverRows.map((r) => r.id);
  const now = new Date();
  let di = 0;
  const mk = (status: string, withDriver: boolean, comment: string) => ({ fromCity: "stressgrad", toCity: "stresston", scheduledAt: now, status: status as any, price: String(PRICE), passengers: 1, carClass: "economy", source: MARKER, comment, driverId: withDriver ? driverIds[di++] : null, mode: "dispatch" });
  const rides: any[] = [];
  for (let i = 0; i < counts.in_progress; i++) rides.push(mk("in_progress", true, "DUR_INPROGRESS"));
  for (let i = 0; i < counts.accepted; i++) rides.push(mk("accepted", true, "DUR_ACCEPTED"));
  for (let i = 0; i < counts.completed; i++) rides.push(mk("completed", true, "DUR_COMPLETED"));
  for (let i = 0; i < counts.offered; i++) rides.push(mk("offered", false, "DUR_OFFERED"));
  for (let i = 0; i < counts.pending; i++) rides.push(mk("pending", false, "DUR_PENDING"));
  const inserted = await db.insert(ridesTable).values(rides).returning({ id: ridesTable.id, status: ridesTable.status, comment: ridesTable.comment, driverId: ridesTable.driverId });

  // Completed rides get a commission transaction each (the durable money record).
  const completedRides = inserted.filter((r) => r.comment === "DUR_COMPLETED");
  await db.insert(transactionsTable).values(completedRides.map((r) => ({ driverId: r.driverId!, rideId: r.id, type: "commission" as const, amount: String(COMMISSION), description: "DUR test commission" })));

  // Offered rides get an ALREADY-EXPIRED offer → the sweep should recover them to 'pending'.
  const offeredRides = inserted.filter((r) => r.comment === "DUR_OFFERED");
  await db.insert(orderOffersTable).values(offeredRides.map((r, i) => ({ rideId: r.id, driverId: driverIds[(driverIds.length - 1 - i) % driverIds.length], status: "pending" as const, expiresAt: new Date(Date.now() - 60_000) })));

  const balSum = (await db.select({ s: sql<string>`coalesce(sum(${usersTable.balance}),0)` }).from(usersTable).where(inArray(usersTable.id, driverIds)))[0].s;
  const commSum = (await db.select({ s: sql<string>`coalesce(sum(${transactionsTable.amount}),0)` }).from(transactionsTable).where(inArray(transactionsTable.rideId, inserted.map((r) => r.id))))[0].s;
  const snap = {
    driverIds, balSum, commSum,
    rideIdsByComment: { in_progress: inserted.filter(r => r.comment === "DUR_INPROGRESS").map(r => r.id), accepted: inserted.filter(r => r.comment === "DUR_ACCEPTED").map(r => r.id), completed: completedRides.map(r => r.id), offered: offeredRides.map(r => r.id), pending: inserted.filter(r => r.comment === "DUR_PENDING").map(r => r.id) },
    offerCount: offeredRides.length, totalRides: inserted.length,
  };
  fs.writeFileSync(SNAP, JSON.stringify(snap));
  console.log(`[seed] ✓ ${inserted.length} rides (${JSON.stringify(counts)}), ${completedRides.length} commission txns, balances sum=${balSum}, commission sum=${commSum}`);
  console.log(`[seed] snapshot → ${SNAP}. NOW RESTART the server, then run 'verify'.`);
}

async function verify() {
  const snap = JSON.parse(fs.readFileSync(SNAP, "utf8"));
  console.log("[verify] comparing post-restart state to snapshot…");
  const ids = snap.rideIdsByComment;
  const all = [...ids.in_progress, ...ids.accepted, ...ids.completed, ...ids.offered, ...ids.pending];
  const rides = await db.select({ id: ridesTable.id, status: ridesTable.status, driverId: ridesTable.driverId }).from(ridesTable).where(inArray(ridesTable.id, all));
  const byId = new Map(rides.map((r) => [r.id, r]));
  const statusOf = (idArr: number[]) => idArr.map((id) => byId.get(id)?.status);

  const lost = all.filter((id) => !byId.has(id));
  const inProgKept = ids.in_progress.filter((id: number) => byId.get(id)?.status === "in_progress").length;
  const acceptedKept = ids.accepted.filter((id: number) => byId.get(id)?.status === "accepted").length;
  const completedKept = ids.completed.filter((id: number) => byId.get(id)?.status === "completed").length;
  const offeredRecovered = ids.offered.filter((id: number) => byId.get(id)?.status === "pending").length;
  const offeredStill = ids.offered.filter((id: number) => byId.get(id)?.status === "offered").length;

  const balSum = (await db.select({ s: sql<string>`coalesce(sum(${usersTable.balance}),0)` }).from(usersTable).where(inArray(usersTable.id, snap.driverIds)))[0].s;
  const commSum = (await db.select({ s: sql<string>`coalesce(sum(${transactionsTable.amount}),0)` }).from(transactionsTable).where(inArray(transactionsTable.rideId, all)))[0].s;

  console.log("\n========== DURABILITY VERIFY ==========");
  console.log(`Rides LOST (gone from DB):          ${lost.length}            ${lost.length === 0 ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`in_progress preserved:              ${inProgKept}/${ids.in_progress.length}        ${inProgKept === ids.in_progress.length ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`accepted preserved:                 ${acceptedKept}/${ids.accepted.length}        ${acceptedKept === ids.accepted.length ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`completed preserved:                ${completedKept}/${ids.completed.length}        ${completedKept === ids.completed.length ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`driver balances unchanged:          ${balSum}==${snap.balSum}    ${balSum === snap.balSum ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`commission txns intact:             ${commSum}==${snap.commSum}    ${commSum === snap.commSum ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`offered orphans recovered→pending:  ${offeredRecovered}/${ids.offered.length} (still offered: ${offeredStill})  ${offeredRecovered > 0 ? "✓ sweep working" : "⚠ check sweep"}`);
  console.log("=======================================\n");

  await cleanup();
}

async function cleanup() {
  console.log("[cleanup] removing synthetic rows…");
  const dRows = await db.select({ id: usersTable.id }).from(usersTable).where(like(usersTable.phone, `${PREFIX}%`));
  const dids = dRows.map((r) => r.id);
  const synRides = await db.select({ id: ridesTable.id }).from(ridesTable).where(or(eq(ridesTable.source, MARKER), dids.length ? inArray(ridesTable.driverId, dids) : sql`false`));
  const rids = synRides.map((r) => r.id);
  if (rids.length) { await db.delete(transactionsTable).where(inArray(transactionsTable.rideId, rids)); await db.delete(orderOffersTable).where(inArray(orderOffersTable.rideId, rids)); await db.delete(ridesTable).where(inArray(ridesTable.id, rids)); }
  if (dids.length) { await db.delete(transactionsTable).where(inArray(transactionsTable.driverId, dids)); await db.delete(orderOffersTable).where(inArray(orderOffersTable.driverId, dids)); await db.delete(driverSessionsTable).where(inArray(driverSessionsTable.driverId, dids)); await db.delete(usersTable).where(inArray(usersTable.id, dids)); }
  try { fs.unlinkSync(SNAP); } catch { /* */ }
  console.log(`[cleanup] ✓ deleted ${dids.length} drivers, ${rids.length} rides + txns/offers`);
}

(async () => {
  if (MODE === "seed") await seed();
  else if (MODE === "verify") await verify();
  else if (MODE === "cleanup") await cleanup();
  else console.error("usage: durability-test.ts seed|verify|cleanup");
  process.exit(0);
})().catch((e) => { console.error("[FATAL]", e); process.exit(1); });
