/**
 * Autodispatch-ENGINE validation under multi-worker (caveat #2). Unlike combined-stress
 * (which seeds offers manually), here the dispatch ENGINE generates the offers:
 *   1. N drivers go online (GPS in Tashkent) and each creates their own urgent trip
 *      Tashkent→Fergana → they become route-match candidates with free seats.
 *   2. M rider-orders Tashkent→Fergana are inserted as pending; the primary worker's
 *      dispatch sweep route-matches them to drivers and sends "new_order" offers.
 *   3. Drivers AUTO-ACCEPT every "new_order" they receive (cross-worker offer routing).
 * Verify under real engine dispatch: 0 orders multi-assigned, 0 ride with >1 accepted
 * offer, 0 double-charge. Test DB + port 4001 only.
 *   Usage: node dist/autodispatch-engine-test.mjs [drivers] [orders] [durationSec]
 */
import { db, usersTable, driverSessionsTable, ridesTable, transactionsTable, orderOffersTable } from "@workspace/db";
import { inArray, like, sql, eq, or, and } from "drizzle-orm";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { WebSocket } from "ws";
import { JWT_SECRET } from "../../src/lib/jwt-secret.js";

const API = process.env.API_BASE || "http://127.0.0.1:4001";
const WS_BASE = process.env.WS_BASE || "ws://127.0.0.1:4001/api/ws";
const PREFIX = "+998951";
const MARKER = "stress_test";
const N = Number(process.argv[2] ?? 60);
const ORDERS = Number(process.argv[3] ?? 30);
const DURATION = Number(process.argv[4] ?? 75);
const FROM = "tashkent", TO = "fergana";
const LAT = 41.311, LNG = 69.279; // Tashkent

interface D { id: number; token: string; ip: string; sid: string; ws?: WebSocket; authed: boolean; }
const drivers: D[] = [];
let offersReceived = 0, acceptOk = 0, acceptConflict = 0, acceptOther = 0;
const ip = (i: number) => `10.51.${(i >> 8) & 255}.${(i & 255) || 1}`;

async function api(method: string, path: string, token: string, body: unknown, dip: string): Promise<number> {
  try {
    const r = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Forwarded-For": dip }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    await r.text().catch(() => "");
    return r.status;
  } catch { return 0; }
}

async function acceptRide(d: D, rideId: number) {
  const st = await api("POST", "/api/drivers/accept", d.token, { rideId }, d.ip);
  if (st === 200) acceptOk++; else if (st === 409) acceptConflict++; else acceptOther++;
}

function connect(d: D): Promise<void> {
  return new Promise((res) => {
    const t = setTimeout(res, 8000);
    const ws = new WebSocket(WS_BASE); d.ws = ws;
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token: d.token })));
    ws.on("message", (data) => {
      try {
        const m = JSON.parse(data.toString());
        if (m.type === "auth_ok") { d.authed = true; clearTimeout(t); res(); }
        if (m.type === "new_order" && m.ride?.id) { offersReceived++; acceptRide(d, m.ride.id).catch(() => {}); }
      } catch { /* */ }
    });
    ws.on("error", () => { clearTimeout(t); res(); });
  });
}

async function run() {
  console.log(`\n=== AUTODISPATCH-ENGINE TEST: ${N} drivers, ${ORDERS} orders, ${DURATION}s ===`);
  // 1. provision drivers (online, balance, seats)
  const rows = await db.insert(usersTable).values(Array.from({ length: N }, (_, i) => ({ phone: `${PREFIX}${String(i).padStart(5, "0")}`, name: `Eng ${i}`, passwordHash: "x", role: "driver" as const, status: "online" as const, carClass: "economy", seats: 4, balance: "1000000", lat: String(LAT), lng: String(LNG) }))).returning({ id: usersTable.id });
  const sessions = rows.map((r) => ({ driverId: r.id, sessionToken: crypto.randomBytes(48).toString("hex"), deviceId: `eng-${r.id}`, deviceName: "eng", ipAddress: "127.0.0.1", expiresAt: new Date(Date.now() + 7 * 864e5) }));
  await db.insert(driverSessionsTable).values(sessions);
  rows.forEach((r, i) => drivers.push({ id: r.id, token: jwt.sign({ userId: r.id, role: "driver", sid: sessions[i].sessionToken }, JWT_SECRET, { expiresIn: "2h" }), ip: ip(i), sid: sessions[i].sessionToken, authed: false }));
  console.log(`[eng] provisioned ${drivers.length} drivers`);

  // 2. connect WS + auto-accept handler
  for (let i = 0; i < drivers.length; i += 50) await Promise.all(drivers.slice(i, i + 50).map(connect));
  console.log(`[eng] ws authed=${drivers.filter((d) => d.authed).length}/${N}`);

  // GPS so they're cached/located on the primary (presence pub/sub)
  const gps = setInterval(() => { for (const d of drivers) if (d.ws?.readyState === WebSocket.OPEN && d.authed) { try { d.ws.send(JSON.stringify({ type: "driver_location", lat: LAT + (Math.random() - 0.5) * 0.05, lng: LNG + (Math.random() - 0.5) * 0.05, sessionId: d.sid })); } catch { /* */ } } }, 4000);

  // 3. each driver creates their own urgent trip → route-match candidate with free seats
  let trips = 0;
  for (let i = 0; i < drivers.length; i += 40) {
    await Promise.all(drivers.slice(i, i + 40).map(async (d) => { const st = await api("POST", "/api/drivers/create-ride", d.token, { fromCity: FROM, toCity: TO, urgent: true }, d.ip); if (st === 201) trips++; }));
  }
  console.log(`[eng] drivers created ${trips} own trips (route-match candidates)`);

  // give the primary time to sync queue/cache + presence
  await new Promise((r) => setTimeout(r, 12000));

  // 4. insert M pending rider-orders (instant urgent, same route) → engine sweep dispatches
  const now = new Date();
  const orderRows = await db.insert(ridesTable).values(Array.from({ length: ORDERS }, (_, i) => ({ fromCity: FROM, toCity: TO, scheduledAt: now, status: "pending" as const, price: String(50000), passengers: 1, carClass: "economy", isUrgent: true, timeSlot: null, source: MARKER, comment: "ENG_ORDER", riderName: `Rider ${i}`, riderPhone: `+998900${String(i).padStart(5, "0")}`, fromLat: String(LAT), fromLng: String(LNG) }))).returning({ id: ridesTable.id });
  const orderIds = orderRows.map((r) => r.id);
  console.log(`[eng] inserted ${orderIds.length} pending rider-orders → waiting for engine to dispatch (sweep boot+10s, then 60s)…`);

  // 5. let the engine dispatch + drivers auto-accept
  const t0 = Date.now();
  while (Date.now() - t0 < DURATION * 1000) {
    await new Promise((r) => setTimeout(r, 5000));
    const offered = await db.select({ n: sql<number>`count(*)::int` }).from(ridesTable).where(and(inArray(ridesTable.id, orderIds), eq(ridesTable.status, "offered")));
    const accepted = await db.select({ n: sql<number>`count(*)::int` }).from(ridesTable).where(and(inArray(ridesTable.id, orderIds), inArray(ridesTable.status, ["accepted", "in_progress", "completed"])));
    console.log(`[eng] t=${Math.round((Date.now() - t0) / 1000)}s offersRcvd=${offersReceived} acceptOk=${acceptOk} conflict=${acceptConflict} | orders offered=${offered[0].n} accepted=${accepted[0].n}/${ORDERS}`);
  }
  clearInterval(gps);

  // 6. verify correctness
  await verify(orderIds);
  await cleanup();
}

async function verify(orderIds: number[]) {
  console.log(`\n========== AUTODISPATCH-ENGINE VERIFY ==========`);
  const orders = await db.select({ id: ridesTable.id, status: ridesTable.status, driverId: ridesTable.driverId }).from(ridesTable).where(inArray(ridesTable.id, orderIds));
  const assigned = orders.filter((o) => o.driverId != null);
  // any order with >1 ACCEPTED offer = double-offer-double-accept bug
  const dblAcc = await db.select({ rideId: orderOffersTable.rideId, n: sql<number>`count(*)::int` }).from(orderOffersTable).where(and(inArray(orderOffersTable.rideId, orderIds), eq(orderOffersTable.status, "accepted"))).groupBy(orderOffersTable.rideId);
  const multiAccepted = dblAcc.filter((o) => o.n > 1);
  // money: commission rows per order (driver-created trips + accepted carpool legs)
  const comm = await db.select({ rideId: transactionsTable.rideId, n: sql<number>`count(*)::int` }).from(transactionsTable).where(and(inArray(transactionsTable.rideId, orderIds), eq(transactionsTable.type, "commission"))).groupBy(transactionsTable.rideId);
  const doubleCharged = comm.filter((c) => c.n > 1);
  const totalOffers = await db.select({ n: sql<number>`count(*)::int` }).from(orderOffersTable).where(inArray(orderOffersTable.rideId, orderIds));

  console.log(`engine offers received by drivers (WS new_order): ${offersReceived}`);
  console.log(`order_offers rows created by engine:             ${totalOffers[0].n}`);
  console.log(`orders assigned to a driver:                     ${assigned.length}/${orderIds.length}`);
  console.log(`accept results: ok=${acceptOk} conflict(409)=${acceptConflict} other=${acceptOther}`);
  console.log(`orders MULTI-ASSIGNED (>1 accepted offer):       ${multiAccepted.length}   ${multiAccepted.length === 0 ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`orders DOUBLE-CHARGED (>1 commission):           ${doubleCharged.length}   ${doubleCharged.length === 0 ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`================================================\n`);
}

async function cleanup() {
  for (const d of drivers) { try { d.ws?.close(); } catch { /* */ } }
  await new Promise((r) => setTimeout(r, 500));
  const dids = (await db.select({ id: usersTable.id }).from(usersTable).where(like(usersTable.phone, `${PREFIX}%`))).map((r) => r.id);
  const rids = (await db.select({ id: ridesTable.id }).from(ridesTable).where(or(eq(ridesTable.source, MARKER), dids.length ? inArray(ridesTable.driverId, dids) : sql`false`))).map((r) => r.id);
  if (rids.length) { await db.delete(transactionsTable).where(inArray(transactionsTable.rideId, rids)); await db.delete(orderOffersTable).where(inArray(orderOffersTable.rideId, rids)); await db.delete(ridesTable).where(inArray(ridesTable.id, rids)); }
  if (dids.length) { await db.delete(transactionsTable).where(inArray(transactionsTable.driverId, dids)); await db.delete(orderOffersTable).where(inArray(orderOffersTable.driverId, dids)); await db.delete(driverSessionsTable).where(inArray(driverSessionsTable.driverId, dids)); await db.delete(usersTable).where(inArray(usersTable.id, dids)); }
  console.log(`[eng] cleanup ✓ deleted ${dids.length} drivers, ${rids.length} rides`);
}

run().then(() => process.exit(0)).catch(async (e) => { console.error("[FATAL]", e); try { await cleanup(); } catch { /* */ } process.exit(1); });
