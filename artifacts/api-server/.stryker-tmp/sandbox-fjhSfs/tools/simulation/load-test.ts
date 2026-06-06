// @ts-nocheck
import WebSocket from "ws";
import crypto from "crypto";
import os from "os";

const API_BASE = process.env.API_BASE || "http://localhost:8080";
const WS_BASE = process.env.WS_BASE || "ws://localhost:8080/api/ws";

const DRIVER_COUNT = 200;
const ORDER_COUNT = 200;
const LOCATION_INTERVAL_MS = 3000;
const RIDE_COMPLETE_MIN_MS = 10000;
const RIDE_COMPLETE_MAX_MS = 20000;
const ACCEPT_PROBABILITY = 0.7;

const CITIES = ["Ташкент", "Фергана"];
const ROUTES: [string, string][] = [
  ["Ташкент", "Фергана"],
  ["Фергана", "Ташкент"],
];

const BUKHARA_CENTER = { lat: 39.77, lng: 64.42 };
const TASHKENT_CENTER = { lat: 41.31, lng: 69.28 };
const FERGANA_CENTER = { lat: 40.38, lng: 71.79 };
const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  "Ташкент": TASHKENT_CENTER,
  "Фергана": FERGANA_CENTER,
  "Бухара": BUKHARA_CENTER,
};

function randomCoord(center: { lat: number; lng: number }, radiusKm: number = 15) {
  const latOff = (Math.random() - 0.5) * (radiusKm / 111);
  const lngOff = (Math.random() - 0.5) * (radiusKm / (111 * Math.cos(center.lat * Math.PI / 180)));
  return { lat: center.lat + latOff, lng: center.lng + lngOff };
}

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "buxtaxi-salt").digest("hex");
}

interface DriverInfo {
  id: number;
  phone: string;
  token: string;
  sessionId?: string;
  ws?: WebSocket;
  assignedRideId?: number;
  accepted: boolean;
  completed: boolean;
  city: string;
}

interface OrderInfo {
  rideId: number;
  fromCity: string;
  toCity: string;
  createdAt: number;
  assignedAt?: number;
  completedAt?: number;
  assignedDriverId?: number;
  status: string;
}

interface Metrics {
  driversCreated: number;
  driversOnline: number;
  wsConnected: number;
  ordersCreated: number;
  ordersAssigned: number;
  ordersAccepted: number;
  ordersCompleted: number;
  ordersFailed: number;
  apiErrors: number;
  wsErrors: number;
  assignTimes: number[];
  apiResponseTimes: number[];
  wsDelays: number[];
  startTime: number;
}

const metrics: Metrics = {
  driversCreated: 0,
  driversOnline: 0,
  wsConnected: 0,
  ordersCreated: 0,
  ordersAssigned: 0,
  ordersAccepted: 0,
  ordersCompleted: 0,
  ordersFailed: 0,
  apiErrors: 0,
  wsErrors: 0,
  assignTimes: [],
  apiResponseTimes: [],
  wsDelays: [],
  startTime: Date.now(),
};

const drivers: DriverInfo[] = [];
const orders: OrderInfo[] = [];
const completedRideIds = new Set<number>();

let dispatcherToken = "";

async function apiCall(method: string, path: string, body?: any, token?: string): Promise<any> {
  const start = performance.now();
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const dur = performance.now() - start;
    metrics.apiResponseTimes.push(dur);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`${res.status}: ${errText.substring(0, 200)}`);
    }
    return await res.json();
  } catch (err: any) {
    metrics.apiErrors++;
    throw err;
  }
}

async function loginDispatcher(): Promise<string> {
  console.log("[LOAD TEST] Logging in as dispatcher...");
  const res = await apiCall("POST", "/api/auth/login", {
    phone: "+998901234567",
    password: "password",
  });
  return res.token;
}

async function createDriverBatch(startIdx: number, count: number): Promise<DriverInfo[]> {
  const created: DriverInfo[] = [];
  const password = "loadtest123";

  const promises = [];
  for (let i = startIdx; i < startIdx + count; i++) {
    const phoneNum = `+998${String(700000000 + i).padStart(9, "0")}`;
    const city = CITIES[i % CITIES.length];
    const firstName = `LoadTest${i}`;
    const lastName = `Driver${i}`;

    promises.push(
      apiCall("POST", "/api/drivers/admin/create", {
        firstName,
        lastName,
        phone: phoneNum,
        password,
        city,
        carBrand: "Chevrolet",
        carModel: "Lacetti",
        carNumber: `${String(i).padStart(2, "0")}A${String(i).padStart(3, "0")}DA`,
        carClass: "economy",
        seats: 4,
      }, dispatcherToken)
        .then(async (res) => {
          const loginRes = await apiCall("POST", "/api/auth/login", {
            phone: phoneNum,
            password,
          });
          const driverInfo: DriverInfo = {
            id: res.driver?.id || res.id,
            phone: phoneNum,
            token: loginRes.token,
            accepted: false,
            completed: false,
            city,
          };
          created.push(driverInfo);
          metrics.driversCreated++;
        })
        .catch((err) => {
          if (err.message?.includes("phone_taken") || err.message?.includes("уже зарегистрирован")) {
            return apiCall("POST", "/api/auth/login", { phone: phoneNum, password })
              .then((loginRes) => {
                const driverInfo: DriverInfo = {
                  id: loginRes.user?.id || 0,
                  phone: phoneNum,
                  token: loginRes.token,
                  accepted: false,
                  completed: false,
                  city,
                };
                created.push(driverInfo);
                metrics.driversCreated++;
              })
              .catch(() => {
                console.error(`[LOAD TEST] Failed to login existing driver ${phoneNum}`);
              });
          }
          console.error(`[LOAD TEST] Failed to create driver ${phoneNum}: ${err.message?.substring(0, 100)}`);
        })
    );
  }

  await Promise.all(promises);
  return created;
}

async function giveDriversBalance(driverBatch: DriverInfo[]): Promise<void> {
  const ids = driverBatch.map(d => d.id).filter(id => id > 0);
  if (ids.length === 0) return;

  const idList = ids.join(",");
  const { execSync } = await import("child_process");
  try {
    execSync(
      `psql "$DATABASE_URL" -c "UPDATE users SET balance = 100000 WHERE id IN (${idList}) AND balance <= 0;"`,
      { stdio: "pipe", timeout: 10000 }
    );
  } catch (err: any) {
    console.error(`[LOAD TEST] Balance update failed: ${err.message?.substring(0, 100)}`);
  }
}

async function setDriversOnline(driverBatch: DriverInfo[]): Promise<void> {
  const promises = driverBatch.map((d) =>
    apiCall("PATCH", "/api/drivers/status", { status: "online" }, d.token)
      .then(() => {
        metrics.driversOnline++;
      })
      .catch((err) => {
        console.error(`[LOAD TEST] Failed to set driver ${d.id} online: ${err.message?.substring(0, 80)}`);
      })
  );
  await Promise.all(promises);
}

async function updateDriverLocations(driverBatch: DriverInfo[]): Promise<void> {
  const promises = driverBatch.map((d) => {
    const center = CITY_COORDS[d.city] || TASHKENT_CENTER;
    const loc = randomCoord(center, 10);
    return apiCall("PATCH", "/api/drivers/location", { lat: loc.lat, lng: loc.lng }, d.token)
      .catch(() => {});
  });
  await Promise.all(promises);
}

function connectDriverWS(driver: DriverInfo): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(), 5000);

    try {
      const ws = new WebSocket(WS_BASE);
      driver.ws = ws;

      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "auth", token: driver.token }));
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === "auth_ok") {
            driver.sessionId = msg.sessionId;
            metrics.wsConnected++;
            clearTimeout(timeout);
            resolve();
          }

          if (msg.type === "new_order" && !driver.accepted) {
            const receivedAt = Date.now();
            const offerId = msg.offerId;
            const rideId = msg.ride?.id;

            if (offerId) {
              ws.send(JSON.stringify({ type: "offer_ack", offerId, sessionId: driver.sessionId }));
            }

            if (rideId && Math.random() < ACCEPT_PROBABILITY) {
              setTimeout(() => {
                apiCall("POST", "/api/drivers/accept", { rideId }, driver.token)
                  .then(() => {
                    driver.accepted = true;
                    driver.assignedRideId = rideId;
                    metrics.ordersAccepted++;

                    const order = orders.find(o => o.rideId === rideId);
                    if (order) {
                      order.assignedAt = receivedAt;
                      order.assignedDriverId = driver.id;
                      order.status = "accepted";
                      const assignTime = receivedAt - order.createdAt;
                      metrics.assignTimes.push(assignTime);
                      metrics.ordersAssigned++;
                    }

                    const completeDelay = RIDE_COMPLETE_MIN_MS + Math.random() * (RIDE_COMPLETE_MAX_MS - RIDE_COMPLETE_MIN_MS);
                    setTimeout(() => completeRide(driver, rideId), completeDelay);
                  })
                  .catch(() => {});
              }, 500 + Math.random() * 2000);
            }
          }
        } catch {}
      });

      ws.on("error", () => {
        metrics.wsErrors++;
        clearTimeout(timeout);
        resolve();
      });

      ws.on("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    } catch {
      clearTimeout(timeout);
      resolve();
    }
  });
}

function markCompleted(driver: DriverInfo, rideId: number) {
  if (completedRideIds.has(rideId)) return;
  completedRideIds.add(rideId);
  driver.completed = true;
  metrics.ordersCompleted++;
  const order = orders.find(o => o.rideId === rideId);
  if (order) { order.completedAt = Date.now(); order.status = "completed"; }
}

async function completeRide(driver: DriverInfo, rideId: number) {
  if (completedRideIds.has(rideId)) return;
  try {
    const preStartCheck = await apiCall("GET", `/api/rides/${rideId}`, undefined, driver.token).catch(() => null);
    if (preStartCheck?.status === "completed") {
      markCompleted(driver, rideId);
      return;
    }

    if (preStartCheck?.status === "in_progress") {
    } else if (preStartCheck?.status === "accepted") {
      try {
        await apiCall("POST", "/api/drivers/start", { rideId }, driver.token);
      } catch (e: any) {
        const msg = e.message || "";
        if (msg.includes("already") || msg.includes("in_progress") || msg.includes("В пути") || msg.includes("version_conflict")) {
        } else {
          return;
        }
      }
    } else {
      return;
    }

    await new Promise(r => setTimeout(r, 500));

    const rideData = await apiCall("GET", `/api/rides/${rideId}`, undefined, driver.token).catch(() => null);
    const passengers: any[] = rideData?.seatPassengers || [];

    for (const p of passengers) {
      if (p.status === "waiting" || p.status === "assigned") {
        try {
          await apiCall("POST", `/api/drivers/passenger/${p.id}/pickup`, {}, driver.token);
        } catch {}
        await new Promise(r => setTimeout(r, 100));
      }
    }
    await new Promise(r => setTimeout(r, 200));

    const rideData2 = await apiCall("GET", `/api/rides/${rideId}`, undefined, driver.token).catch(() => null);
    const passengers2: any[] = rideData2?.seatPassengers || passengers;
    for (const p of passengers2) {
      if (p.status !== "dropped_off") {
        try {
          await apiCall("POST", `/api/drivers/passenger/${p.id}/dropoff`, {}, driver.token);
        } catch {}
        await new Promise(r => setTimeout(r, 100));
      }
    }

    await new Promise(r => setTimeout(r, 300));

    const checkData = await apiCall("GET", `/api/rides/${rideId}`, undefined, driver.token).catch(() => null);
    const checkStatus = checkData?.status;

    if (checkStatus === "completed") {
      markCompleted(driver, rideId);
    } else if (checkStatus === "in_progress") {
      try {
        await apiCall("POST", "/api/drivers/complete", { rideId }, driver.token);
        markCompleted(driver, rideId);
      } catch (compErr: any) {
        const msg = compErr.message || "";
        if (msg.includes("passengers_not_dropped")) {
          try {
            const rd3 = await apiCall("GET", `/api/rides/${rideId}`, undefined, driver.token).catch(() => null);
            const pax3: any[] = rd3?.seatPassengers || [];
            for (const p of pax3) {
              if (p.status !== "dropped_off") {
                if (p.status === "waiting" || p.status === "assigned") {
                  await apiCall("POST", `/api/drivers/passenger/${p.id}/pickup`, {}, driver.token).catch(() => {});
                  await new Promise(r => setTimeout(r, 50));
                }
                await apiCall("POST", `/api/drivers/passenger/${p.id}/dropoff`, {}, driver.token).catch(() => {});
                await new Promise(r => setTimeout(r, 50));
              }
            }
            const rd4 = await apiCall("GET", `/api/rides/${rideId}`, undefined, driver.token).catch(() => null);
            if (rd4?.status === "completed") {
              markCompleted(driver, rideId);
            } else {
              await apiCall("POST", "/api/drivers/complete", { rideId }, driver.token);
              markCompleted(driver, rideId);
            }
          } catch (e2: any) {
            console.error(`[LOAD TEST] Complete retry failed driver=${driver.id} ride=${rideId}: ${(e2.message || "").substring(0, 100)}`);
          }
        } else if (msg.includes("invalid_status")) {
          const rd5 = await apiCall("GET", `/api/rides/${rideId}`, undefined, driver.token).catch(() => null);
          if (rd5?.status === "completed") {
            markCompleted(driver, rideId);
          }
        } else if (!msg.includes("already_completed")) {
          console.error(`[LOAD TEST] Complete failed driver=${driver.id} ride=${rideId}: ${msg.substring(0, 100)}`);
        }
      }
    } else {
      console.error(`[LOAD TEST] Unexpected ride status: ride=${rideId} status=${checkStatus}`);
    }
  } catch (err: any) {
    console.error(`[LOAD TEST] CompleteRide error driver=${driver.id} ride=${rideId}: ${(err.message || "").substring(0, 100)}`);
  }
}

async function createOrders(count: number): Promise<void> {
  const batchSize = 20;
  for (let batch = 0; batch < count; batch += batchSize) {
    const end = Math.min(batch + batchSize, count);
    const promises = [];

    for (let i = batch; i < end; i++) {
      const route = ROUTES[i % ROUTES.length];
      const fromCenter = CITY_COORDS[route[0]] || TASHKENT_CENTER;
      const toCenter = CITY_COORDS[route[1]] || FERGANA_CENTER;
      const fromLoc = randomCoord(fromCenter, 5);
      const toLoc = randomCoord(toCenter, 5);

      const scheduledAt = new Date(Date.now() + 30 * 60 * 1000 + Math.random() * 120 * 60 * 1000);

      promises.push(
        apiCall("POST", "/api/rides", {
          fromCity: route[0],
          toCity: route[1],
          fromAddress: `Тест адрес ${i}`,
          toAddress: `Тест адрес назначения ${i}`,
          scheduledAt: scheduledAt.toISOString(),
          passengers: 1,
          carClass: "economy",
          riderName: `Тест Пассажир ${i}`,
          riderPhone: `+998${String(800000000 + i).padStart(9, "0")}`,
          paymentType: "cash",
          seats: { front: 0, back: 1 },
        }, dispatcherToken)
          .then((res) => {
            const rideId = res.ride?.id || res.id;
            if (rideId) {
              orders.push({
                rideId,
                fromCity: route[0],
                toCity: route[1],
                createdAt: Date.now(),
                status: "pending",
              });
              metrics.ordersCreated++;
            }
          })
          .catch((err) => {
            metrics.ordersFailed++;
            console.error(`[LOAD TEST] Order ${i} failed: ${err.message?.substring(0, 100)}`);
          })
      );
    }

    await Promise.all(promises);
    if (batch + batchSize < count) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
}

function startLocationUpdates(driverBatch: DriverInfo[]): NodeJS.Timeout {
  return setInterval(() => {
    for (const d of driverBatch) {
      if (d.ws?.readyState === WebSocket.OPEN && d.sessionId) {
        const center = CITY_COORDS[d.city] || TASHKENT_CENTER;
        const loc = randomCoord(center, 10);
        d.ws.send(JSON.stringify({
          type: "driver_location",
          lat: loc.lat,
          lng: loc.lng,
          sessionId: d.sessionId,
        }));
      }
    }
  }, LOCATION_INTERVAL_MS);
}

function getSystemUsage() {
  const cpus = os.cpus();
  const loadAvg = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memUsed = totalMem - freeMem;
  const proc = process.memoryUsage();

  return {
    cpuLoad1m: Math.round(loadAvg[0] * 100) / 100,
    cpuCores: cpus.length,
    cpuPct: Math.round((loadAvg[0] / cpus.length) * 100),
    ramTotalMB: Math.round(totalMem / 1024 / 1024),
    ramUsedMB: Math.round(memUsed / 1024 / 1024),
    ramPct: Math.round((memUsed / totalMem) * 100),
    heapUsedMB: Math.round(proc.heapUsed / 1024 / 1024),
    rssMB: Math.round(proc.rss / 1024 / 1024),
  };
}

function printProgressBar(label: string, current: number, total: number) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const filled = Math.round(pct / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  process.stdout.write(`\r  ${label}: [${bar}] ${pct}% (${current}/${total})`);
}

function printReport() {
  const elapsed = (Date.now() - metrics.startTime) / 1000;
  const avgAssign = metrics.assignTimes.length > 0
    ? Math.round(metrics.assignTimes.reduce((a, b) => a + b, 0) / metrics.assignTimes.length)
    : 0;
  const maxAssign = metrics.assignTimes.length > 0 ? Math.round(Math.max(...metrics.assignTimes)) : 0;
  const minAssign = metrics.assignTimes.length > 0 ? Math.round(Math.min(...metrics.assignTimes)) : 0;
  const p95Assign = metrics.assignTimes.length > 0
    ? Math.round(metrics.assignTimes.sort((a, b) => a - b)[Math.floor(metrics.assignTimes.length * 0.95)])
    : 0;
  const avgApi = metrics.apiResponseTimes.length > 0
    ? Math.round(metrics.apiResponseTimes.reduce((a, b) => a + b, 0) / metrics.apiResponseTimes.length)
    : 0;
  const p95Api = metrics.apiResponseTimes.length > 0
    ? Math.round(metrics.apiResponseTimes.sort((a, b) => a - b)[Math.floor(metrics.apiResponseTimes.length * 0.95)])
    : 0;
  const sys = getSystemUsage();
  const successRate = metrics.ordersCreated > 0
    ? Math.round((metrics.ordersCompleted / metrics.ordersCreated) * 1000) / 10
    : 0;
  const assignRate = metrics.ordersCreated > 0
    ? Math.round((metrics.ordersAssigned / metrics.ordersCreated) * 1000) / 10
    : 0;

  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║               🚀 LOAD TEST REPORT                          ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║  Duration:           ${elapsed.toFixed(1)}s`);
  console.log(`║  Total API calls:    ${metrics.apiResponseTimes.length}`);
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  DRIVERS                                                   ║");
  console.log(`║  Created:            ${metrics.driversCreated}/${DRIVER_COUNT}`);
  console.log(`║  Online:             ${metrics.driversOnline}`);
  console.log(`║  WS Connected:       ${metrics.wsConnected}`);
  console.log(`║  WS Errors:          ${metrics.wsErrors}`);
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  ORDERS                                                    ║");
  console.log(`║  Created:            ${metrics.ordersCreated}/${ORDER_COUNT}`);
  console.log(`║  Assigned:           ${metrics.ordersAssigned}`);
  console.log(`║  Accepted:           ${metrics.ordersAccepted}`);
  console.log(`║  Completed:          ${metrics.ordersCompleted}`);
  console.log(`║  Failed:             ${metrics.ordersFailed}`);
  console.log(`║  Assign Rate:        ${assignRate}%`);
  console.log(`║  Success Rate:       ${successRate}%`);
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  PERFORMANCE                                               ║");
  console.log(`║  Avg Assign Time:    ${avgAssign}ms`);
  console.log(`║  Min Assign Time:    ${minAssign}ms`);
  console.log(`║  Max Assign Time:    ${maxAssign}ms`);
  console.log(`║  P95 Assign Time:    ${p95Assign}ms`);
  console.log(`║  Avg API Response:   ${avgApi}ms`);
  console.log(`║  P95 API Response:   ${p95Api}ms`);
  console.log(`║  API Errors:         ${metrics.apiErrors}`);
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  SYSTEM RESOURCES                                          ║");
  console.log(`║  CPU Load (1m):      ${sys.cpuPct}% (${sys.cpuLoad1m}/${sys.cpuCores} cores)`);
  console.log(`║  RAM Used:           ${sys.ramUsedMB}MB / ${sys.ramTotalMB}MB (${sys.ramPct}%)`);
  console.log(`║  Process Heap:       ${sys.heapUsedMB}MB`);
  console.log(`║  Process RSS:        ${sys.rssMB}MB`);
  console.log("╚══════════════════════════════════════════════════════════════╝");

  if (metrics.ordersCreated > 0 && metrics.ordersAssigned === 0) {
    console.log("\n⚠️  No orders were assigned — dispatch may not have matched drivers to routes.");
    console.log("   Check if drivers are in the correct cities and routes exist in the DB.");
  }
  if (metrics.wsErrors > 10) {
    console.log("\n⚠️  High WebSocket error count — server may be under heavy load.");
  }
}

async function cleanup() {
  console.log("\n[LOAD TEST] Cleaning up...");

  for (const d of drivers) {
    if (d.ws?.readyState === WebSocket.OPEN) {
      d.ws.close();
    }
  }

  const batchSize = 50;
  for (let i = 0; i < drivers.length; i += batchSize) {
    const batch = drivers.slice(i, i + batchSize);
    await Promise.all(
      batch.map(d =>
        apiCall("PATCH", "/api/drivers/status", { status: "offline" }, d.token).catch(() => {})
      )
    );
  }

  console.log("[LOAD TEST] Cleanup complete.");
}

async function run() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║      BuxTaxi Load Test — 200 Drivers × 200 Orders          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  try {
    dispatcherToken = await loginDispatcher();
    console.log("[LOAD TEST] ✓ Dispatcher authenticated\n");

    console.log(`[LOAD TEST] Phase 1: Creating ${DRIVER_COUNT} drivers...`);
    const batchSize = 25;
    for (let i = 0; i < DRIVER_COUNT; i += batchSize) {
      const count = Math.min(batchSize, DRIVER_COUNT - i);
      const batch = await createDriverBatch(i, count);
      drivers.push(...batch);
      printProgressBar("Drivers created", drivers.length, DRIVER_COUNT);
    }
    console.log(`\n[LOAD TEST] ✓ ${drivers.length} drivers created\n`);

    console.log("[LOAD TEST] Phase 2: Setting driver balances...");
    await giveDriversBalance(drivers);
    console.log("[LOAD TEST] ✓ Balances set\n");

    console.log("[LOAD TEST] Phase 3: Setting initial locations...");
    await updateDriverLocations(drivers);
    console.log("[LOAD TEST] ✓ Locations set\n");

    console.log("[LOAD TEST] Phase 4: Setting drivers online...");
    const onlineBatchSize = 50;
    for (let i = 0; i < drivers.length; i += onlineBatchSize) {
      const batch = drivers.slice(i, i + onlineBatchSize);
      await setDriversOnline(batch);
      printProgressBar("Drivers online", metrics.driversOnline, drivers.length);
    }
    console.log(`\n[LOAD TEST] ✓ ${metrics.driversOnline} drivers online\n`);

    console.log(`[LOAD TEST] Phase 5: Connecting ${drivers.length} WebSockets...`);
    const wsBatchSize = 25;
    for (let i = 0; i < drivers.length; i += wsBatchSize) {
      const batch = drivers.slice(i, i + wsBatchSize);
      await Promise.all(batch.map(d => connectDriverWS(d)));
      printProgressBar("WS connected", metrics.wsConnected, drivers.length);
    }
    console.log(`\n[LOAD TEST] ✓ ${metrics.wsConnected} WebSockets connected\n`);

    const locationTimer = startLocationUpdates(drivers);
    console.log("[LOAD TEST] ✓ Location updates started (every 3s)\n");

    await new Promise(r => setTimeout(r, 2000));

    console.log(`[LOAD TEST] Phase 6: Creating ${ORDER_COUNT} orders...`);
    await createOrders(ORDER_COUNT);
    console.log(`[LOAD TEST] ✓ ${metrics.ordersCreated} orders created\n`);

    console.log("[LOAD TEST] Phase 7: Waiting for dispatch + accept + complete...");
    const maxWaitMs = 90000;
    const startWait = Date.now();
    while (Date.now() - startWait < maxWaitMs) {
      await new Promise(r => setTimeout(r, 3000));

      const pending = metrics.ordersCreated - metrics.ordersCompleted - metrics.ordersFailed;
      const assigned = metrics.ordersAssigned;
      const completed = metrics.ordersCompleted;

      process.stdout.write(
        `\r  [${Math.round((Date.now() - startWait) / 1000)}s] ` +
        `Assigned: ${assigned} | Accepted: ${metrics.ordersAccepted} | ` +
        `Completed: ${completed} | Pending: ${pending}   `
      );

      if (metrics.ordersCompleted + metrics.ordersFailed >= metrics.ordersCreated) {
        break;
      }

      if (Date.now() - startWait > 60000 && metrics.ordersAssigned === 0) {
        console.log("\n[LOAD TEST] ⚠️ No assignments after 60s, stopping wait.");
        break;
      }
    }
    console.log();

    clearInterval(locationTimer);

    printReport();

    await cleanup();

  } catch (err: any) {
    console.error(`\n[LOAD TEST] Fatal error: ${err.message}`);
    console.error(err.stack);
    printReport();
    await cleanup();
    process.exit(1);
  }
}

run().then(() => {
  console.log("\n[LOAD TEST] Done.");
  process.exit(0);
}).catch((err) => {
  console.error("[LOAD TEST] Unhandled error:", err);
  process.exit(1);
});
