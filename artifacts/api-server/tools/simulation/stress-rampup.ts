/**
 * Focused stress test for production-readiness sign-off.
 *
 * Provisions N synthetic drivers (+998950 prefix), opens one WebSocket each,
 * exercises the realistic hot path: GPS update every 5s, offer poll every 7s.
 * Measures API latency (p50/p95/p99), DB-pool saturation, Node RSS/heap, error
 * rates. Cleans up — even on SIGINT/crash — by deleting any +998950 rows.
 *
 * Usage:
 *   tsx tools/simulation/stress-rampup.ts <N> <durationSec>
 * Authorized for production use 2026-06-06 (explicit user confirmation).
 */
import { db, usersTable, driverSessionsTable } from "@workspace/db";
import { inArray, like, sql } from "drizzle-orm";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { WebSocket } from "ws";
import { JWT_SECRET } from "../../src/lib/jwt-secret.js";

const API_BASE = process.env.API_BASE || "http://127.0.0.1:4000";
const WS_BASE = process.env.WS_BASE || "ws://127.0.0.1:4000/api/ws";
const STRESS_PREFIX = "+998950";

const ARG_N = Number(process.argv[2] ?? 100);
const ARG_DURATION = Number(process.argv[3] ?? 60);
const GPS_INTERVAL_MS = 5_000;
const OFFER_POLL_MS = 7_000;
const RAMP_CONCURRENCY = 50;

interface Driver {
  id: number;
  token: string;
  ws?: WebSocket;
  authed: boolean;
}

const drivers: Driver[] = [];
const apiLatencies: number[] = [];
let apiErrors = 0;
let wsConnects = 0;
let wsAuthed = 0;
let wsErrors = 0;
let wsMessages = 0;
let stopped = false;

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor(s.length * p));
  return Math.round(s[idx] * 100) / 100;
}

async function apiCall(method: string, path: string, token?: string, body?: unknown): Promise<number> {
  const start = performance.now();
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const dur = performance.now() - start;
    apiLatencies.push(dur);
    if (!res.ok) apiErrors++;
    await res.text().catch(() => "");
    return res.status;
  } catch {
    apiErrors++;
    apiLatencies.push(performance.now() - start);
    return 0;
  }
}

async function provisionDrivers(n: number): Promise<void> {
  console.log(`[ramp] provisioning ${n} synthetic drivers (${STRESS_PREFIX} prefix)…`);
  const t0 = Date.now();
  const BATCH = 100;
  for (let off = 0; off < n; off += BATCH) {
    const slice: (typeof usersTable.$inferInsert)[] = [];
    for (let i = off; i < Math.min(off + BATCH, n); i++) {
      const phone = `${STRESS_PREFIX}${String(i).padStart(5, "0")}`;
      slice.push({
        phone,
        name: `Stress ${i}`,
        passwordHash: "x",
        role: "driver",
        status: "offline",
        carClass: "economy",
        seats: 4,
        balance: "100000",
      });
    }
    const rows = await db.insert(usersTable).values(slice).returning({ id: usersTable.id });
    // Driver tokens require a session (sid claim); create one row per driver,
    // then mint a JWT carrying that sessionToken. Auth middleware verifies it.
    const sessionValues = rows.map((r) => ({
      driverId: r.id,
      sessionToken: crypto.randomBytes(48).toString("hex"),
      deviceId: `stress-${r.id}`,
      deviceName: "stress-test",
      ipAddress: "127.0.0.1",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }));
    await db.insert(driverSessionsTable).values(sessionValues);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const sid = sessionValues[i].sessionToken;
      const token = jwt.sign({ userId: r.id, role: "driver", sid }, JWT_SECRET, { expiresIn: "1h" });
      drivers.push({ id: r.id, token, authed: false });
    }
  }
  console.log(`[ramp] ✓ provisioned ${drivers.length} drivers in ${Date.now() - t0}ms`);
}

function connectWS(d: Driver): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      wsErrors++;
      resolve();
    }, 8_000);
    try {
      const ws = new WebSocket(WS_BASE);
      d.ws = ws;
      ws.on("open", () => {
        wsConnects++;
        ws.send(JSON.stringify({ type: "auth", token: d.token }));
      });
      ws.on("message", (data) => {
        wsMessages++;
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "auth_ok") {
            d.authed = true;
            wsAuthed++;
            clearTimeout(t);
            resolve();
          }
        } catch {
          /* ignore */
        }
      });
      ws.on("error", () => {
        wsErrors++;
        clearTimeout(t);
        resolve();
      });
      ws.on("close", () => {
        d.ws = undefined;
      });
    } catch {
      wsErrors++;
      clearTimeout(t);
      resolve();
    }
  });
}

async function connectAll(): Promise<void> {
  console.log(`[ramp] opening ${drivers.length} WebSockets…`);
  const t0 = Date.now();
  for (let i = 0; i < drivers.length; i += RAMP_CONCURRENCY) {
    const batch = drivers.slice(i, i + RAMP_CONCURRENCY);
    await Promise.all(batch.map(connectWS));
  }
  console.log(
    `[ramp] ✓ ws connects=${wsConnects} authed=${wsAuthed} errors=${wsErrors} in ${Date.now() - t0}ms`,
  );
}

async function setOnline(): Promise<void> {
  console.log(`[ramp] flipping drivers online…`);
  const t0 = Date.now();
  for (let i = 0; i < drivers.length; i += RAMP_CONCURRENCY) {
    const batch = drivers.slice(i, i + RAMP_CONCURRENCY);
    await Promise.all(
      batch.map((d) => apiCall("PATCH", "/api/drivers/status", d.token, { status: "online" })),
    );
  }
  console.log(`[ramp] ✓ all online in ${Date.now() - t0}ms`);
}

function startGpsAndPollLoops(): { gps: NodeJS.Timeout; poll: NodeJS.Timeout } {
  const sendGps = () => {
    if (stopped) return;
    for (const d of drivers) {
      if (d.ws?.readyState === WebSocket.OPEN && d.authed) {
        const lat = 41.3 + (Math.random() - 0.5) * 0.2;
        const lng = 69.28 + (Math.random() - 0.5) * 0.2;
        try {
          d.ws.send(JSON.stringify({ type: "driver_location", lat, lng }));
        } catch {
          /* ignore */
        }
      }
    }
  };
  const pollOffers = async () => {
    if (stopped) return;
    const SAMPLE = Math.min(200, drivers.length);
    for (let i = 0; i < SAMPLE; i++) {
      const d = drivers[Math.floor(Math.random() * drivers.length)];
      apiCall("GET", "/api/drivers/available-rides", d.token).catch(() => {});
    }
  };
  return { gps: setInterval(sendGps, GPS_INTERVAL_MS), poll: setInterval(pollOffers, OFFER_POLL_MS) };
}

async function sampleServerSide(): Promise<{ pgConns: number; rssMB: number; cpuPct: number }> {
  let pgConns = 0;
  try {
    const r = await db.execute(sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = ''`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pgConns = Number((r as any).rows?.[0]?.n ?? 0);
  } catch {
    /* best-effort */
  }
  let rssMB = 0;
  let cpuPct = 0;
  try {
    const { execSync } = await import("node:child_process");
    const pidStr = execSync("systemctl show -p MainPID --value taxi1313-api.service").toString().trim();
    if (pidStr && pidStr !== "0") {
      const stats = execSync(`ps -p ${pidStr} -o rss=,pcpu=`).toString().trim().split(/\s+/);
      rssMB = Math.round(Number(stats[0] || 0) / 1024);
      cpuPct = Number(stats[1] || 0);
    }
  } catch {
    /* best-effort */
  }
  return { pgConns, rssMB, cpuPct };
}

function snapshot(label: string, server: { pgConns: number; rssMB: number; cpuPct: number }) {
  const lat = apiLatencies;
  console.log(
    `[${label}] N=${drivers.length} authed=${wsAuthed} ` +
      `api: calls=${lat.length} errs=${apiErrors} ` +
      `p50=${pct(lat, 0.5)}ms p95=${pct(lat, 0.95)}ms p99=${pct(lat, 0.99)}ms ` +
      `| pg_conns=${server.pgConns} rss=${server.rssMB}MB cpu=${server.cpuPct}% ` +
      `| ws msgs_in=${wsMessages} errs=${wsErrors}`,
  );
}

async function cleanup(): Promise<void> {
  if (stopped) return;
  stopped = true;
  console.log("\n[ramp] cleanup: closing sockets + deleting synthetic drivers");
  for (const d of drivers) {
    try {
      d.ws?.close();
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 500));
  try {
    // First drop sessions for any synthetic drivers, then delete the drivers.
    const stressIds = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(like(usersTable.phone, `${STRESS_PREFIX}%`));
    const idList = stressIds.map((r) => r.id);
    if (idList.length > 0) {
      await db.delete(driverSessionsTable).where(inArray(driverSessionsTable.driverId, idList));
    }
    const del = await db
      .delete(usersTable)
      .where(like(usersTable.phone, `${STRESS_PREFIX}%`))
      .returning({ id: usersTable.id });
    console.log(`[ramp] ✓ deleted ${del.length} synthetic driver rows + sessions`);
  } catch (err) {
    console.error("[ramp] cleanup delete failed:", (err as Error).message);
  }
}

async function run(): Promise<void> {
  console.log(`\n=== STRESS RAMP-UP N=${ARG_N} duration=${ARG_DURATION}s ===`);
  console.log(`API=${API_BASE}  WS=${WS_BASE}\n`);
  const baseline = await sampleServerSide();
  console.log(`[baseline] pg_conns=${baseline.pgConns} rss=${baseline.rssMB}MB cpu=${baseline.cpuPct}%`);
  await provisionDrivers(ARG_N);
  await connectAll();
  await setOnline();
  const loops = startGpsAndPollLoops();
  console.log(`[ramp] steady-state ${ARG_DURATION}s …`);
  const t0 = Date.now();
  const sampleEvery = 10_000;
  let nextSample = t0 + sampleEvery;
  while (Date.now() - t0 < ARG_DURATION * 1000) {
    await new Promise((r) => setTimeout(r, Math.max(100, nextSample - Date.now())));
    if (Date.now() >= nextSample) {
      const s = await sampleServerSide();
      snapshot(`t=${Math.round((Date.now() - t0) / 1000)}s`, s);
      nextSample += sampleEvery;
    }
  }
  clearInterval(loops.gps);
  clearInterval(loops.poll);
  const final = await sampleServerSide();
  snapshot("FINAL", final);
  await cleanup();
}

process.on("SIGINT", async () => {
  console.log("\n[ramp] SIGINT → cleaning up…");
  await cleanup();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(0);
});

run()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("[ramp] FATAL", err);
    await cleanup();
    process.exit(1);
  });
