/**
 * LAYER 2 sub-step 3 verification: cross-worker targeted sends (broadcastToUser/Staff).
 * Connects K dispatcher clients (spread across workers), then publishes directly to the
 * namespaced :send channel and checks delivery:
 *   - a "user" send reaches ONLY the target client, on whatever worker it's on
 *   - a "staff" send reaches ALL staff clients across all workers
 *   Usage: WS_CHANNEL_PREFIX=ws4001 node dist/cluster-targeted-test.mjs [K]
 */
import jwt from "jsonwebtoken";
import { WebSocket } from "ws";
import Redis from "ioredis";
import { JWT_SECRET } from "../../src/lib/jwt-secret.js";

const WS_URL = process.env.WS_URL || "ws://127.0.0.1:4001/api/ws";
const PREFIX = process.env.WS_CHANNEL_PREFIX || "ws4001";
const K = Number(process.argv[2] ?? 8);

interface C { id: number; pid?: number; ws: WebSocket; got: Set<string>; }
const clients: C[] = [];

function connect(userId: number): Promise<C> {
  return new Promise((res) => {
    const token = jwt.sign({ userId, role: "dispatcher" }, JWT_SECRET, { expiresIn: "1h" });
    const ws = new WebSocket(WS_URL);
    const c: C = { id: userId, ws, got: new Set() };
    let done = false; const fin = () => { if (!done) { done = true; res(c); } };
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
    ws.on("message", (d) => { try { const m = JSON.parse(d.toString()); c.got.add(m.type); if (m.type === "auth_ok") { c.pid = m.workerPid; fin(); } } catch { /* */ } });
    ws.on("error", fin); setTimeout(fin, 6000);
  });
}

(async () => {
  const redis = new Redis(process.env.REDIS_URL!);
  for (let i = 0; i < K; i++) clients.push(await connect(900050 + i));
  await new Promise((r) => setTimeout(r, 500));
  const pids = [...new Set(clients.map((c) => c.pid))];

  const target = clients[K - 1];
  clients.forEach((c) => c.got.clear());
  redis.publish(`${PREFIX}:send`, JSON.stringify({ kind: "user", target: target.id, message: JSON.stringify({ type: "xuser" }) }));
  await new Promise((r) => setTimeout(r, 800));
  const userRecv = clients.filter((c) => c.got.has("xuser"));
  const userPass = userRecv.length === 1 && userRecv[0].id === target.id;

  clients.forEach((c) => c.got.clear());
  redis.publish(`${PREFIX}:send`, JSON.stringify({ kind: "staff", target: null, message: JSON.stringify({ type: "xstaff" }) }));
  await new Promise((r) => setTimeout(r, 800));
  const staffRecv = clients.filter((c) => c.got.has("xstaff"));
  const staffPass = staffRecv.length === clients.length;

  console.log("\n========== TARGETED CROSS-WORKER SEND TEST ==========");
  console.log(`clients: ${clients.length}, distinct worker PIDs: ${pids.length} (${pids.join(",")})`);
  console.log(`user-send → received by ${userRecv.length} client [${userRecv.map((c) => c.id).join(",")}], target=${target.id} (pid ${target.pid})  ${userPass ? "✓ PASS — only the target, cross-worker" : "✗ FAIL"}`);
  console.log(`staff-send → received by ${staffRecv.length}/${clients.length} staff across workers  ${staffPass ? "✓ PASS" : "✗ FAIL"}`);
  console.log("=====================================================\n");
  clients.forEach((c) => { try { c.ws.close(); } catch { /* */ } });
  redis.quit();
  process.exit(userPass && staffPass ? 0 : 1);
})();
