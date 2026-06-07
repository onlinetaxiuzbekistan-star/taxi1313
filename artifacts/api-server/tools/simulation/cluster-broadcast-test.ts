/**
 * LAYER 1 verification: cross-worker WebSocket broadcast via Redis pub/sub.
 * Connects K dispatcher WS clients to the clustered instance (port 4001). They spread
 * across workers. Each client that connects triggers a `user_online` broadcast. If the
 * Redis pub/sub layer works, the first client receives user_online for EVERY later
 * client — including those on OTHER workers. Without it, it would only see clients on
 * its own worker.
 *   Usage: node dist/cluster-broadcast-test.mjs [K]
 */
import jwt from "jsonwebtoken";
import { WebSocket } from "ws";
import { JWT_SECRET } from "../../src/lib/jwt-secret.js";

const WS_URL = process.env.WS_URL || "ws://127.0.0.1:4001/api/ws";
const K = Number(process.argv[2] ?? 12);

interface C { id: number; pid?: number; online: Set<number>; ws: WebSocket; }
const clients: C[] = [];

function connect(userId: number): Promise<C> {
  return new Promise((resolve) => {
    const token = jwt.sign({ userId, role: "dispatcher" }, JWT_SECRET, { expiresIn: "1h" });
    const ws = new WebSocket(WS_URL);
    const c: C = { id: userId, online: new Set(), ws };
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(c); } };
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
    ws.on("message", (d) => {
      try {
        const m = JSON.parse(d.toString());
        if (m.type === "auth_ok") { c.pid = m.workerPid; finish(); }
        if (m.type === "user_online" && m.userId) c.online.add(m.userId);
        if (m.type === "user_offline" && m.userId) c.online.delete(m.userId);
      } catch { /* */ }
    });
    ws.on("error", finish);
    setTimeout(finish, 6000);
  });
}

(async () => {
  console.log(`[cluster-test] connecting ${K} clients to ${WS_URL}…`);
  for (let i = 0; i < K; i++) {
    clients.push(await connect(900001 + i));
    await new Promise((r) => setTimeout(r, 250)); // stagger so each connect's broadcast fans out
  }
  await new Promise((r) => setTimeout(r, 1500)); // settle

  const pids = clients.map((c) => c.pid).filter(Boolean) as number[];
  const distinctPids = [...new Set(pids)];
  const first = clients[0];
  const otherClients = clients.slice(1);
  const recvAll = otherClients.filter((c) => first.online.has(c.id)).length;
  const crossWorker = otherClients.filter((c) => c.pid && c.pid !== first.pid);
  const recvCross = crossWorker.filter((c) => first.online.has(c.id)).length;
  const pass = crossWorker.length > 0 && recvCross === crossWorker.length;

  console.log("\n========== CROSS-WORKER BROADCAST TEST ==========");
  console.log(`clients connected:            ${clients.length}/${K}`);
  console.log(`distinct worker PIDs:         ${distinctPids.length} (${distinctPids.join(", ")})  ${distinctPids.length > 1 ? "✓ spread across workers" : "⚠ all on one worker"}`);
  console.log(`first client (pid ${first.pid}) saw user_online for: ${recvAll}/${otherClients.length} others`);
  console.log(`  └ of ${crossWorker.length} on OTHER workers, received: ${recvCross}  ${pass ? "✓ PASS — pub/sub crosses workers" : "✗ FAIL"}`);
  console.log("=================================================\n");

  clients.forEach((c) => { try { c.ws.close(); } catch { /* */ } });
  process.exit(0);
})();
