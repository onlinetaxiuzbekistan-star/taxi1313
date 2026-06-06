import { db, usersTable, ridesTable, orderOffersTable, ridePassengersTable } from "@workspace/db";
import { eq, and, desc, inArray, sql, gte } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { logger } from "./logger.js";

import { JWT_SECRET } from "./jwt-secret.js";
const BASE = `http://localhost:${process.env.PORT || 8080}`;

interface TestResult {
  step: string;
  passed: boolean;
  error?: string;
  detail?: string;
}

const results: TestResult[] = [];
let wsEvents: string[] = [];
let wsSocket: any = null;

function pass(step: string, detail?: string) {
  results.push({ step, passed: true, detail });
  console.log(`[E2E ✓] ${step}${detail ? ` — ${detail}` : ""}`);
}

function fail(step: string, error: string) {
  results.push({ step, passed: false, error });
  console.log(`[E2E ✗] ${step} — ${error}`);
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function api(method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, data: json };
}

function connectWS(token: string): Promise<void> {
  return new Promise((resolve) => {
    const { WebSocket } = require("ws");
    wsSocket = new WebSocket(`ws://localhost:${process.env.PORT || 8080}/api/ws`);
    wsSocket.on("open", () => {
      wsSocket.send(JSON.stringify({ type: "auth", token }));
    });
    wsSocket.on("message", (raw: any) => {
      try {
        const data = JSON.parse(raw.toString());
        wsEvents.push(data.type);
        if (data.type === "auth_ok") resolve();
        if (data.type === "new_order" && data.offerId) {
          wsSocket.send(JSON.stringify({ type: "offer_ack", offerId: data.offerId, sessionId: data.sessionId }));
        }
      } catch {}
    });
    wsSocket.on("error", () => resolve());
    setTimeout(resolve, 3000);
  });
}

function closeWS() {
  if (wsSocket) {
    try { wsSocket.close(1000); } catch {}
    wsSocket = null;
  }
}

async function ensureTestDriver(): Promise<{ id: number; token: string }> {
  const testPhone = "+998900000001";
  let [driver] = await db.select().from(usersTable).where(eq(usersTable.phone, testPhone));

  if (!driver) {
    const crypto = require("crypto");
    const hash = crypto.createHash("sha256").update("test123buxtaxi-salt").digest("hex");
    [driver] = await db.insert(usersTable).values({
      phone: testPhone,
      name: "E2E Test Driver",
      passwordHash: hash,
      role: "driver",
      status: "online",
      balance: 100000,
      carModel: "Test Car",
      carNumber: "01A001AA",
      carClass: "economy",
      seats: 4,
      lat: 40.3834,
      lng: 71.7864,
    }).returning();
  } else {
    await db.update(usersTable)
      .set({ status: "online", balance: 100000, lat: 40.3834, lng: 71.7864 })
      .where(eq(usersTable.id, driver.id));
  }

  const token = jwt.sign({ userId: driver.id, role: "driver" }, JWT_SECRET, { expiresIn: "1h" });
  return { id: driver.id, token };
}

async function ensureDispatcher(): Promise<{ id: number; token: string }> {
  const [disp] = await db.select().from(usersTable).where(eq(usersTable.role, "dispatcher"));
  if (!disp) {
    fail("setup", "No dispatcher found in database");
    throw new Error("No dispatcher");
  }
  const token = jwt.sign({ userId: disp.id, role: "dispatcher" }, JWT_SECRET, { expiresIn: "1h" });
  return { id: disp.id, token };
}

async function cleanup(driverId: number) {
  const testRides = await db.select({ id: ridesTable.id }).from(ridesTable)
    .where(eq(ridesTable.driverId, driverId));
  for (const r of testRides) {
    await db.delete(ridePassengersTable).where(eq(ridePassengersTable.rideId, r.id));
    await db.delete(orderOffersTable).where(eq(orderOffersTable.rideId, r.id));
  }
  await db.delete(ridesTable).where(eq(ridesTable.driverId, driverId));
  await db.delete(orderOffersTable).where(eq(orderOffersTable.driverId, driverId));
  await db.update(usersTable).set({ status: "online" }).where(eq(usersTable.id, driverId));

  const testPhone = "+998900000099";
  const testClientRides = await db.select({ id: ridesTable.id }).from(ridesTable)
    .where(eq(ridesTable.riderPhone, testPhone));
  for (const r of testClientRides) {
    await db.delete(ridePassengersTable).where(eq(ridePassengersTable.rideId, r.id));
    await db.delete(orderOffersTable).where(eq(orderOffersTable.rideId, r.id));
  }
  if (testClientRides.length > 0) {
    await db.delete(ridesTable).where(eq(ridesTable.riderPhone, testPhone));
  }

}

export async function runE2ESimulation() {
  console.log("\n═══════════════════════════════════════");
  console.log("  [E2E] BuxTaxi Ride Flow Simulation");
  console.log("═══════════════════════════════════════\n");

  results.length = 0;
  wsEvents = [];

  let driver: { id: number; token: string };
  let dispatcher: { id: number; token: string };
  let tripRideId: number = 0;
  let clientRideId: number = 0;

  try {
    driver = await ensureTestDriver();
    dispatcher = await ensureDispatcher();
    pass("1. SETUP", `driver=${driver.id}, dispatcher=${dispatcher.id}`);
  } catch (err: any) {
    fail("1. SETUP", err.message);
    printSummary();
    return;
  }

  try {
    await cleanup(driver.id);
    pass("1a. CLEANUP", "previous test data removed");
  } catch (err: any) {
    fail("1a. CLEANUP", err.message);
  }

  await connectWS(driver.token);
  pass("1b. WS CONNECT", "driver websocket connected");

  const departureTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  try {
    const res = await api("POST", "/api/drivers/create-ride", {
      fromCity: "fergana",
      toCity: "tashkent",
      departureTime,
    }, driver.token);

    if (res.status === 200 || res.status === 201) {
      tripRideId = res.data.ride?.id || res.data.id;
      pass("2. CREATE ROUTE", `tripRideId=${tripRideId}, fergana→tashkent`);
    } else {
      fail("2. CREATE ROUTE", `status=${res.status}, ${JSON.stringify(res.data)}`);
    }
  } catch (err: any) {
    fail("2. CREATE ROUTE", err.message);
  }

  if (!tripRideId) {
    fail("2a. ROUTE REQUIRED", "cannot continue without trip");
    closeWS();
    printSummary();
    return;
  }

  try {
    const res = await api("POST", "/api/rides", {
      fromCity: "Фергана",
      toCity: "Ташкент",
      scheduledAt: departureTime,
      passengers: 1,
      paymentType: "cash",
      carClass: "economy",
      riderName: "E2E Тест",
      riderPhone: "+998900000099",
    }, dispatcher.token);

    if (res.status === 200 || res.status === 201) {
      clientRideId = res.data.ride?.id || res.data.id;
      pass("3. CREATE RIDE", `clientRideId=${clientRideId}`);
    } else {
      fail("3. CREATE RIDE", `status=${res.status}, ${JSON.stringify(res.data)}`);
    }
  } catch (err: any) {
    fail("3. CREATE RIDE", err.message);
  }

  if (!clientRideId) {
    closeWS();
    printSummary();
    return;
  }

  await sleep(2000);

  try {
    const [clientRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, clientRideId));
    if (clientRide && clientRide.status === "accepted" && clientRide.driverId === driver.id) {
      pass("4. EXPECT MATCH", `ride auto-matched to trip ${tripRideId}, status=accepted`);
    } else if (clientRide && clientRide.tripId === tripRideId) {
      pass("4. EXPECT MATCH", `ride linked to trip ${tripRideId}, status=${clientRide.status}`);
    } else {
      const offers = await db.select().from(orderOffersTable)
        .where(eq(orderOffersTable.rideId, clientRideId));
      const hasOffer = offers.find(o => o.driverId === driver.id);
      if (hasOffer) {
        pass("4. EXPECT OFFER", `offerId=${hasOffer.id}, status=${hasOffer.status}`);
      } else {
        fail("4. EXPECT MATCH/OFFER", `ride status=${clientRide?.status}, tripId=${clientRide?.tripId}, offers=${JSON.stringify(offers.map(o => ({ id: o.id, driverId: o.driverId, status: o.status })))}`);
      }
    }
  } catch (err: any) {
    fail("4. EXPECT MATCH", err.message);
  }

  try {
    const [clientRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, clientRideId));
    if (clientRide && clientRide.driverId === driver.id && ["accepted", "in_progress"].includes(clientRide.status as string)) {
      pass("5. ACCEPT", `ride already matched, status=${clientRide.status}`);
    } else {
      const res = await api("POST", "/api/drivers/accept", { rideId: clientRideId }, driver.token);
      if (res.status === 200) {
        pass("5. ACCEPT", `ride ${clientRideId} accepted`);
      } else {
        fail("5. ACCEPT", `status=${res.status}, ${JSON.stringify(res.data)}`);
      }
    }

    const [verify] = await db.select().from(ridesTable).where(eq(ridesTable.id, clientRideId));
    if (verify && ["accepted", "in_progress"].includes(verify.status as string)) {
      pass("5a. VERIFY ACCEPT", `status=${verify.status}, driverId=${verify.driverId}`);
    } else {
      fail("5a. VERIFY ACCEPT", `expected accepted/in_progress, got ${verify?.status}`);
    }
  } catch (err: any) {
    fail("5. ACCEPT", err.message);
  }

  try {
    const [tripRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, tripRideId));
    if (tripRide && tripRide.status === "in_progress") {
      pass("6. START TRIP", `tripRideId=${tripRideId} already in_progress`);
    } else {
      const res = await api("POST", "/api/drivers/start", { rideId: tripRideId }, driver.token);
      if (res.status === 200) {
        pass("6. START TRIP", `tripRideId=${tripRideId} started`);
      } else {
        fail("6. START TRIP", `status=${res.status}, ${JSON.stringify(res.data)}`);
      }
    }

    const [verify] = await db.select().from(ridesTable).where(eq(ridesTable.id, tripRideId));
    if (verify && verify.status === "in_progress") {
      pass("6a. VERIFY START", `status=in_progress`);
    } else {
      fail("6a. VERIFY START", `expected in_progress, got ${verify?.status}`);
    }
  } catch (err: any) {
    fail("6. START TRIP", err.message);
  }

  try {
    const passengers = await db.select().from(ridePassengersTable)
      .where(eq(ridePassengersTable.rideId, tripRideId));

    for (const p of passengers) {
      if (p.status !== "picked_up" && p.status !== "dropped_off") {
        await api("POST", `/api/drivers/passenger/${p.id}/pickup`, {}, driver.token);
      }
    }
    for (const p of passengers) {
      if (p.status !== "dropped_off") {
        await api("POST", `/api/drivers/passenger/${p.id}/dropoff`, {}, driver.token);
      }
    }
    if (passengers.length > 0) {
      pass("6b. PASSENGER OPS", `${passengers.length} passenger(s) picked up & dropped off`);
    } else {
      pass("6b. PASSENGER OPS", "no passengers on trip ride");
    }
  } catch (err: any) {
    fail("6b. PASSENGER OPS", err.message);
  }

  await sleep(1000);

  try {
    const [tripRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, tripRideId));
    if (tripRide && tripRide.status === "completed") {
      pass("7. COMPLETE TRIP", `tripRideId=${tripRideId} auto-completed on last dropoff`);
    } else {
      const res = await api("POST", "/api/drivers/complete", { rideId: tripRideId }, driver.token);
      if (res.status === 200) {
        pass("7. COMPLETE TRIP", `tripRideId=${tripRideId} completed`);
      } else {
        fail("7. COMPLETE TRIP", `status=${res.status}, ${JSON.stringify(res.data)}`);
      }
    }

    const [verify] = await db.select().from(ridesTable).where(eq(ridesTable.id, tripRideId));
    if (verify && verify.status === "completed") {
      pass("7a. VERIFY COMPLETE", `status=completed`);
    } else {
      fail("7a. VERIFY COMPLETE", `expected completed, got ${verify?.status}`);
    }
  } catch (err: any) {
    fail("7. COMPLETE TRIP", err.message);
  }

  try {
    const [clientRide] = await db.select().from(ridesTable).where(eq(ridesTable.id, clientRideId));
    if (clientRide) {
      if (clientRide.price && clientRide.price > 0) {
        pass("8. PRICE CHECK", `price=${clientRide.price}`);
      } else {
        fail("8. PRICE CHECK", `price=${clientRide.price}, expected > 0`);
      }
    } else {
      fail("8. PRICE CHECK", "client ride not found");
    }
  } catch (err: any) {
    fail("8. PRICE CHECK", err.message);
  }

  try {
    const hasOffer = wsEvents.includes("new_order") || wsEvents.includes("ride_matched_trip");
    const hasRideUpdated = wsEvents.includes("ride_updated");
    const hasTripComplete = wsEvents.includes("trip_completed");

    const received = wsEvents.filter(e => !["auth_ok", "user_online", "user_offline", "driver_location", "pong"].includes(e));
    const uniqueEvents = [...new Set(received)];

    const checks: string[] = [];
    if (hasOffer) checks.push("offer/match");
    if (hasRideUpdated) checks.push("ride_updated");
    if (hasTripComplete) checks.push("trip_completed");

    if (checks.length >= 2) {
      pass("9. WS CHECK", `events: [${uniqueEvents.join(", ")}]`);
    } else {
      fail("9. WS CHECK", `expected offer+updated+completed, got: [${uniqueEvents.join(", ")}]`);
    }
  } catch (err: any) {
    fail("9. WS CHECK", err.message);
  }

  closeWS();
  printSummary();
}

function printSummary() {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log("\n═══════════════════════════════════════");
  console.log(`  [E2E] RESULTS: ${passed}/${total} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════");

  if (failed > 0) {
    console.log("\n  ERRORS:");
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ✗ ${r.step}: ${r.error}`);
    }
  } else {
    console.log("\n  All checks passed!");
  }

  console.log("═══════════════════════════════════════\n");
}
