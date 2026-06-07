/**
 * COMBINED stress test: drivers + operators (dispatch panel) simultaneously.
 *
 * Driver load (reuses the proven stress-rampup hot path): N synthetic drivers
 * (+998950) online + WS + GPS every 5s + offer poll every 7s.
 * Operator load: K synthetic dispatchers hammering the panel read endpoints
 * (order board, status filters, dispatch stats, CRM, archive) — latency measured
 * SEPARATELY from drivers.
 * Realistic data: STATIC_ORDERS synthetic orders across all statuses so the panel
 * queries return production-like volume.
 * Correctness under concurrency:
 *   - DISPATCH: CONTESTED pending orders, each raced by 3 drivers calling /accept
 *     simultaneously — exactly one must win, others 409. Verified post-run.
 *   - MONEY: INPROGRESS rides each owned by a distinct driver; all complete in one
 *     simultaneous burst — each completed ride must have EXACTLY ONE commission
 *     transaction (no double-charge, no lost commission). Verified post-run.
 * Server-side metrics polled from the public GET /api/system/load (real pool +
 * memory of the live server process).
 *
 * Usage: tsx tools/simulation/combined-stress.ts <N> <durationSec> [operators]
 * Cleans up ALL synthetic rows (drivers, operators, orders, offers, transactions,
 * sessions) on completion, SIGINT, or crash.
 * Authorized for production use 2026-06-07 (explicit owner confirmation).
 */
import { db, usersTable, driverSessionsTable, ridesTable, transactionsTable, orderOffersTable } from "@workspace/db";
import { inArray, like, sql, eq, or, and } from "drizzle-orm";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { WebSocket } from "ws";
import { JWT_SECRET } from "../../src/lib/jwt-secret.js";

const API_BASE = process.env.API_BASE || "http://127.0.0.1:4000";
const WS_BASE = process.env.WS_BASE || "ws://127.0.0.1:4000/api/ws";
const DRIVER_PREFIX = "+998950";
const OP_LOGIN_PREFIX = "stressop_";
const ORDER_MARKER = "stress_test"; // rides.source marker for cleanup

const N = Number(process.argv[2] ?? 100);
const DURATION = Number(process.argv[3] ?? 60);
const OPERATORS = Number(process.argv[4] ?? 10);
const STATIC_ORDERS = 300;
const CONTESTED = Math.min(30, Math.max(2, Math.floor(N / 12)));
const INPROGRESS = Math.min(100, Math.max(5, Math.floor(N / 5)));
const GPS_MS = 5_000, POLL_MS = 7_000, RAMP = 50;
const RIDE_PRICE = 50_000;

interface Driver { id: number; token: string; ip: string; ws?: WebSocket; authed: boolean; }
const drivers: Driver[] = [];
const operators: { id: number; token: string; ip: string }[] = [];
// Each synthetic driver/operator gets a UNIQUE client IP via X-Forwarded-For, which
// getClientIp() honours. This mirrors production (2000 drivers = 2000 mobile IPs) so the
// per-IP limiter (API_MAX_PER_IP=1000/min) behaves as it would in the field — without
// this, all traffic shares 127.0.0.1 and trips the limiter (429), invalidating numbers.
const driverIp = (i: number) => `10.${(i >> 8) & 255}.${i & 255}.1`;
const driverLat: number[] = [], operLat: number[] = [];
let driverErr = 0, operErr = 0, wsConnects = 0, wsAuthed = 0, wsErrors = 0, wsMsgs = 0, stopped = false;
const poolSamples: { total: number; idle: number; waiting: number; rss: number }[] = [];
let contestedRideIds: number[] = [], inprogressRideIds: number[] = [];
let acceptWins = 0, acceptConflicts = 0, acceptOther = 0;
let completeOk = 0, completeFail = 0;

function pct(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 100) / 100;
}

async function call(method: string, path: string, token: string | undefined, body: unknown, lat: number[], errInc: () => void, ip?: string): Promise<number> {
  const start = performance.now();
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (ip) headers["X-Forwarded-For"] = ip;
    const res = await fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
    lat.push(performance.now() - start);
    if (!res.ok) errInc();
    const txt = await res.text().catch(() => "");
    return res.status;
  } catch { lat.push(performance.now() - start); errInc(); return 0; }
}
const dErr = () => { driverErr++; };
const oErr = () => { operErr++; };

async function provisionDrivers(n: number) {
  console.log(`[setup] provisioning ${n} drivers…`);
  const BATCH = 100;
  for (let off = 0; off < n; off += BATCH) {
    const slice: (typeof usersTable.$inferInsert)[] = [];
    for (let i = off; i < Math.min(off + BATCH, n); i++)
      slice.push({ phone: `${DRIVER_PREFIX}${String(i).padStart(5, "0")}`, name: `Stress ${i}`, passwordHash: "x", role: "driver", status: "offline", carClass: "economy", seats: 4, balance: "1000000" });
    const rows = await db.insert(usersTable).values(slice).returning({ id: usersTable.id });
    const sessions = rows.map((r) => ({ driverId: r.id, sessionToken: crypto.randomBytes(48).toString("hex"), deviceId: `stress-${r.id}`, deviceName: "stress", ipAddress: "127.0.0.1", expiresAt: new Date(Date.now() + 7 * 864e5) }));
    await db.insert(driverSessionsTable).values(sessions);
    rows.forEach((r, i) => drivers.push({ id: r.id, token: jwt.sign({ userId: r.id, role: "driver", sid: sessions[i].sessionToken }, JWT_SECRET, { expiresIn: "2h" }), ip: driverIp(off + i), authed: false }));
  }
  console.log(`[setup] ✓ ${drivers.length} drivers`);
}

async function provisionOperators(k: number) {
  const slice = Array.from({ length: k }, (_, i) => ({ phone: `${DRIVER_PREFIX}9${String(i).padStart(4, "0")}`, login: `${OP_LOGIN_PREFIX}${i}`, name: `StressOp ${i}`, passwordHash: "x", role: "dispatcher" as const }));
  const rows = await db.insert(usersTable).values(slice).returning({ id: usersTable.id });
  rows.forEach((r, i) => operators.push({ id: r.id, token: jwt.sign({ userId: r.id, role: "dispatcher" }, JWT_SECRET, { expiresIn: "2h" }), ip: `10.250.${(i + 1) & 255}.1` }));
  console.log(`[setup] ✓ ${operators.length} operators`);
}

async function seedOrders() {
  // STATIC orders across all statuses for realistic panel query volume.
  const statuses = ["pending", "offered", "accepted", "in_progress", "completed", "cancelled"] as const;
  const now = new Date();
  const driverPool = drivers.slice(0, Math.max(1, drivers.length));
  const rows: (typeof ridesTable.$inferInsert)[] = [];
  for (let i = 0; i < STATIC_ORDERS; i++) {
    const st = statuses[i % statuses.length];
    const needsDriver = ["accepted", "in_progress", "completed"].includes(st);
    rows.push({
      fromCity: "stressgrad", toCity: "stresston", scheduledAt: now, status: st,
      price: String(RIDE_PRICE), passengers: 1, carClass: "economy",
      source: ORDER_MARKER, comment: "STRESS_STATIC",
      driverId: needsDriver ? driverPool[i % driverPool.length].id : null,
    });
  }
  await db.insert(ridesTable).values(rows);

  // CONTESTED orders for the accept-race (dispatch correctness): status 'offered'
  // with a pending order_offer to each of the 3 racing drivers (accept requires an
  // active offer — server returns 403 MUST_ACCEPT_OFFER_FIRST otherwise).
  const contested = Array.from({ length: CONTESTED }, () => ({ fromCity: "stressgrad", toCity: "stresston", scheduledAt: now, status: "offered" as const, price: String(RIDE_PRICE), passengers: 1, carClass: "economy", source: ORDER_MARKER, comment: "STRESS_CONTESTED", mode: "dispatch" }));
  contestedRideIds = (await db.insert(ridesTable).values(contested).returning({ id: ridesTable.id })).map((r) => r.id);
  const offers: (typeof orderOffersTable.$inferInsert)[] = [];
  contestedRideIds.forEach((rid, idx) => {
    for (let k = 0; k < 3; k++) { const d = drivers[idx * 3 + k]; if (d) offers.push({ rideId: rid, driverId: d.id, status: "pending", expiresAt: new Date(Date.now() + 120_000) }); }
  });
  if (offers.length) await db.insert(orderOffersTable).values(offers);

  // INPROGRESS rides owned by distinct drivers for the complete-burst (money integrity).
  const ipStart = CONTESTED * 3; // reserve first CONTESTED*3 drivers for the race
  const ip: (typeof ridesTable.$inferInsert)[] = [];
  const ipDrivers: number[] = [];
  for (let i = 0; i < INPROGRESS; i++) {
    const d = drivers[ipStart + i];
    if (!d) break;
    ipDrivers.push(d.id);
    ip.push({ fromCity: "stressgrad", toCity: "stresston", scheduledAt: now, status: "in_progress", price: String(RIDE_PRICE), passengers: 1, carClass: "economy", source: ORDER_MARKER, comment: "STRESS_INPROGRESS", driverId: d.id, mode: "dispatch" });
  }
  inprogressRideIds = (await db.insert(ridesTable).values(ip).returning({ id: ridesTable.id })).map((r) => r.id);
  if (ipDrivers.length) await db.update(usersTable).set({ status: "busy" }).where(inArray(usersTable.id, ipDrivers));
  console.log(`[setup] ✓ seeded ${STATIC_ORDERS} static + ${contestedRideIds.length} contested + ${inprogressRideIds.length} in-progress orders`);
}

function connectWS(d: Driver): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(() => { wsErrors++; resolve(); }, 8_000);
    try {
      const ws = new WebSocket(WS_BASE); d.ws = ws;
      ws.on("open", () => { wsConnects++; ws.send(JSON.stringify({ type: "auth", token: d.token })); });
      ws.on("message", (data) => { wsMsgs++; try { const m = JSON.parse(data.toString()); if (m.type === "auth_ok") { d.authed = true; wsAuthed++; clearTimeout(t); resolve(); } } catch { /* */ } });
      ws.on("error", () => { wsErrors++; clearTimeout(t); resolve(); });
      ws.on("close", () => { d.ws = undefined; });
    } catch { wsErrors++; clearTimeout(t); resolve(); }
  });
}
async function connectAll() {
  for (let i = 0; i < drivers.length; i += RAMP) await Promise.all(drivers.slice(i, i + RAMP).map(connectWS));
  console.log(`[setup] ✓ ws connects=${wsConnects} authed=${wsAuthed} errors=${wsErrors}`);
}
async function setOnline() {
  for (let i = 0; i < drivers.length; i += RAMP) await Promise.all(drivers.slice(i, i + RAMP).map((d) => call("PATCH", "/api/drivers/status", d.token, { status: "online" }, driverLat, dErr, d.ip)));
  console.log(`[setup] ✓ drivers online`);
}

function startLoops() {
  const gps = setInterval(() => {
    if (stopped) return;
    for (const d of drivers) if (d.ws?.readyState === WebSocket.OPEN && d.authed) { try { d.ws.send(JSON.stringify({ type: "driver_location", lat: 41.3 + (Math.random() - 0.5) * 0.2, lng: 69.28 + (Math.random() - 0.5) * 0.2 })); } catch { /* */ } }
  }, GPS_MS);
  const poll = setInterval(() => {
    if (stopped) return;
    const SAMPLE = Math.min(200, drivers.length);
    for (let i = 0; i < SAMPLE; i++) { const d = drivers[Math.floor(Math.random() * drivers.length)]; call("GET", "/api/drivers/available-rides", d.token, null, driverLat, dErr, d.ip).catch(() => {}); }
  }, POLL_MS);
  // Operator panel query flood — weighted realistic mix.
  const opQueries = [
    "/api/rides/?limit=50", "/api/rides/?limit=50", "/api/rides/?status=pending&limit=50",
    "/api/rides/?status=accepted,in_progress&limit=50", "/api/rides/?status=completed&limit=50",
    "/api/dispatcher/stats", "/api/drivers/crm?limit=50", "/api/rides/archive?limit=50",
  ];
  const op = setInterval(() => {
    if (stopped || !operators.length) return;
    for (const o of operators) { const path = opQueries[Math.floor(Math.random() * opQueries.length)]; call("GET", path, o.token, null, operLat, oErr, o.ip).catch(() => {}); }
  }, 800);
  return { gps, poll, op };
}

async function sampleServer() {
  try {
    const res = await fetch(`${API_BASE}/api/system/load`, { signal: AbortSignal.timeout(5000) });
    const j: any = await res.json();
    const p = j.dbPool || j.pool || {};
    poolSamples.push({ total: p.total ?? p.totalCount ?? 0, idle: p.idle ?? p.idleCount ?? 0, waiting: p.waiting ?? p.waitingCount ?? 0, rss: j.memory?.rssMB ?? j.rssMB ?? 0 });
  } catch { /* */ }
}

const acceptStatus: Record<string, number> = {};
let acceptSampleBody = "";
async function acceptOne(token: string, rideId: number, ip: string): Promise<number> {
  const start = performance.now();
  try {
    const res = await fetch(`${API_BASE}/api/drivers/accept`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Forwarded-For": ip }, body: JSON.stringify({ rideId }), signal: AbortSignal.timeout(15_000) });
    driverLat.push(performance.now() - start);
    const body = await res.text().catch(() => "");
    acceptStatus[String(res.status)] = (acceptStatus[String(res.status)] || 0) + 1;
    if (res.status !== 200 && res.status !== 409 && res.status !== 403 && !acceptSampleBody) acceptSampleBody = `${res.status}: ${body.slice(0, 160)}`;
    // 409 (already_taken) and 403 (offer consumed by winner) are EXPECTED race-loser
    // outcomes, not errors. Only count real failures (5xx / network).
    if (!res.ok && res.status !== 409 && res.status !== 403) dErr();
    return res.status;
  } catch (e) { driverLat.push(performance.now() - start); dErr(); acceptStatus["0"] = (acceptStatus["0"] || 0) + 1; if (!acceptSampleBody) acceptSampleBody = `0: ${(e as Error).message}`; return 0; }
}
async function acceptRace() {
  console.log(`[race] dispatch correctness: ${contestedRideIds.length} orders × 3 drivers racing /accept…`);
  const tasks: Promise<void>[] = [];
  contestedRideIds.forEach((rideId, idx) => {
    for (let k = 0; k < 3; k++) {
      const d = drivers[idx * 3 + k];
      if (!d) continue;
      tasks.push((async () => {
        const st = await acceptOne(d.token, rideId, d.ip);
        if (st === 200) acceptWins++; else if (st === 409) acceptConflicts++; else acceptOther++;
      })());
    }
  });
  await Promise.all(tasks);
  console.log(`[race] accept results: wins=${acceptWins} conflicts(409)=${acceptConflicts} other=${acceptOther} statusDist=${JSON.stringify(acceptStatus)}`);
  if (acceptSampleBody) console.log(`[race] sample non-200/409 response → ${acceptSampleBody}`);
}

async function completeBurst() {
  console.log(`[burst] money integrity: ${inprogressRideIds.length} simultaneous /complete…`);
  const idToDriver = new Map<number, Driver>();
  const ipStart = CONTESTED * 3;
  inprogressRideIds.forEach((rid, i) => { const d = drivers[ipStart + i]; if (d) idToDriver.set(rid, d); });
  await Promise.all([...idToDriver.entries()].map(async ([rideId, d]) => {
    const st = await call("POST", "/api/drivers/complete", d.token, { rideId }, driverLat, dErr, d.ip);
    if (st === 200) completeOk++; else completeFail++;
  }));
  console.log(`[burst] complete results: ok=${completeOk} fail=${completeFail}`);
}

function report() {
  const maxWait = Math.max(0, ...poolSamples.map((s) => s.waiting));
  const maxTotal = Math.max(0, ...poolSamples.map((s) => s.total));
  const maxRss = Math.max(0, ...poolSamples.map((s) => s.rss));
  console.log(`\n========== RESULTS N=${N} operators=${OPERATORS} dur=${DURATION}s ==========`);
  console.log(`DRIVER api:   calls=${driverLat.length} errs=${driverErr} p50=${pct(driverLat, .5)}ms p95=${pct(driverLat, .95)}ms p99=${pct(driverLat, .99)}ms`);
  console.log(`OPERATOR api: calls=${operLat.length} errs=${operErr} p50=${pct(operLat, .5)}ms p95=${pct(operLat, .95)}ms p99=${pct(operLat, .99)}ms`);
  console.log(`DB pool:      max_total=${maxTotal}/60 max_waiting=${maxWait}   server RSS max=${maxRss}MB`);
  console.log(`WebSocket:    authed=${wsAuthed}/${N} msgs_in=${wsMsgs} ws_errors=${wsErrors}`);
  console.log(`DISPATCH:     contested=${contestedRideIds.length} accept_wins=${acceptWins} conflicts=${acceptConflicts} (want wins==contested, 1 per order)`);
  console.log(`MONEY:        complete_ok=${completeOk}/${inprogressRideIds.length}`);
}

async function verifyCorrectness() {
  console.log(`\n[verify] checking money + dispatch integrity…`);
  // MONEY: each completed in-progress ride must have exactly ONE transaction.
  if (inprogressRideIds.length) {
    // A correct completion writes exactly ONE 'commission' row (+ one 'income' payout) per ride.
    // Double-charge = >1 commission row for a ride; lost commission = completed ride with 0.
    const comm = await db.select({ rideId: transactionsTable.rideId, n: sql<number>`count(*)::int` })
      .from(transactionsTable).where(and(inArray(transactionsTable.rideId, inprogressRideIds), eq(transactionsTable.type, "commission"))).groupBy(transactionsTable.rideId);
    const completedRides = await db.select({ id: ridesTable.id, status: ridesTable.status }).from(ridesTable).where(inArray(ridesTable.id, inprogressRideIds));
    const completedCount = completedRides.filter((r) => r.status === "completed").length;
    const doubled = comm.filter((t) => t.n > 1);
    const withComm = new Set(comm.map((t) => t.rideId));
    const lost = completedRides.filter((r) => r.status === "completed" && !withComm.has(r.id)).length;
    console.log(`[verify] MONEY: completed=${completedCount}/${inprogressRideIds.length}  rides_with_commission=${comm.length}  DOUBLE_CHARGED=${doubled.length}  LOST_COMMISSION=${lost}`);
    if (doubled.length) console.log(`[verify]   ⚠ double-charged rideIds: ${doubled.map((d) => d.rideId).join(",")}`);
  }
  // DISPATCH: no ride with >1 accepted offer; each contested ride has exactly one driver.
  if (contestedRideIds.length) {
    const dblOffers = await db.select({ rideId: orderOffersTable.rideId, n: sql<number>`count(*)::int` })
      .from(orderOffersTable).where(and(inArray(orderOffersTable.rideId, contestedRideIds), eq(orderOffersTable.status, "accepted"))).groupBy(orderOffersTable.rideId);
    const multi = dblOffers.filter((o) => o.n > 1);
    const cRides = await db.select({ id: ridesTable.id, driverId: ridesTable.driverId, status: ridesTable.status }).from(ridesTable).where(inArray(ridesTable.id, contestedRideIds));
    const assigned = cRides.filter((r) => r.driverId != null).length;
    console.log(`[verify] DISPATCH: contested=${contestedRideIds.length} assigned_to_one_driver=${assigned} rides_with_multiple_accepted_offers=${multi.length} (want 0)`);
  }
}

async function cleanup() {
  if (stopped) return; stopped = true;
  console.log(`\n[cleanup] closing sockets + deleting ALL synthetic rows…`);
  for (const d of drivers) { try { d.ws?.close(); } catch { /* */ } }
  await new Promise((r) => setTimeout(r, 500));
  try {
    const dRows = await db.select({ id: usersTable.id }).from(usersTable).where(or(like(usersTable.phone, `${DRIVER_PREFIX}%`), like(usersTable.login, `${OP_LOGIN_PREFIX}%`)));
    const ids = dRows.map((r) => r.id);
    const synRides = await db.select({ id: ridesTable.id }).from(ridesTable).where(or(eq(ridesTable.source, ORDER_MARKER), ids.length ? inArray(ridesTable.driverId, ids) : sql`false`));
    const rideIds = synRides.map((r) => r.id);
    if (rideIds.length) {
      await db.delete(transactionsTable).where(inArray(transactionsTable.rideId, rideIds));
      await db.delete(orderOffersTable).where(inArray(orderOffersTable.rideId, rideIds));
    }
    if (ids.length) {
      await db.delete(transactionsTable).where(inArray(transactionsTable.driverId, ids));
      await db.delete(orderOffersTable).where(inArray(orderOffersTable.driverId, ids));
    }
    if (rideIds.length) await db.delete(ridesTable).where(inArray(ridesTable.id, rideIds));
    if (ids.length) {
      await db.delete(driverSessionsTable).where(inArray(driverSessionsTable.driverId, ids));
      const del = await db.delete(usersTable).where(inArray(usersTable.id, ids)).returning({ id: usersTable.id });
      console.log(`[cleanup] ✓ deleted ${del.length} users, ${rideIds.length} rides + their txns/offers`);
    }
  } catch (e) { console.error(`[cleanup] FAILED:`, (e as Error).message); }
}

async function run() {
  console.log(`\n=== COMBINED STRESS N=${N} ops=${OPERATORS} dur=${DURATION}s (contested=${CONTESTED} inprogress=${INPROGRESS}) ===`);
  if (N <= 0) { console.log("[cleanup-only] purging synthetic data by marker…"); await cleanup(); return; }
  await provisionDrivers(N);
  await provisionOperators(OPERATORS);
  await seedOrders();
  await connectAll();
  await setOnline();
  const loops = startLoops();
  const t0 = Date.now();
  let racedAccept = false, racedComplete = false, nextSample = t0 + 3000;
  while (Date.now() - t0 < DURATION * 1000) {
    await new Promise((r) => setTimeout(r, 200));
    const el = Date.now() - t0;
    if (Date.now() >= nextSample) { await sampleServer(); nextSample += 3000; }
    if (!racedAccept && el > DURATION * 1000 * 0.35) { racedAccept = true; acceptRace().catch(() => {}); }
    if (!racedComplete && el > DURATION * 1000 * 0.6) { racedComplete = true; completeBurst().catch(() => {}); }
  }
  clearInterval(loops.gps); clearInterval(loops.poll); clearInterval(loops.op);
  await new Promise((r) => setTimeout(r, 1500)); // let races settle
  report();
  await verifyCorrectness();
  await cleanup();
}

process.on("SIGINT", async () => { console.log("\n[SIGINT] cleaning up…"); await cleanup(); process.exit(0); });
process.on("SIGTERM", async () => { await cleanup(); process.exit(0); });
run().then(() => process.exit(0)).catch(async (e) => { console.error("[FATAL]", e); await cleanup(); process.exit(1); });
