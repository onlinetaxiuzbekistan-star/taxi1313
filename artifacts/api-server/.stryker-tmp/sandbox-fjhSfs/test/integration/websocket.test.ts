// @ts-nocheck
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { startTestDb, stopTestDb } from "./setup.js";

const SECRET = "test-session-secret-at-least-32-characters-long";

let server: http.Server;
let port = 0;
let closeWs: () => Promise<void>;

beforeAll(async () => {
  const url = await startTestDb();
  process.env.DATABASE_URL = url;
  process.env.REDIS_URL = "redis://127.0.0.1:6379/15";
  process.env.SESSION_SECRET = SECRET;
  process.env.NODE_ENV = "test";
  process.env.TELEGRAM_BOT_TOKEN = "test:dummy";

  const { setupWebSocket, closeWebSocket } = await import("../../src/lib/websocket.js");
  closeWs = closeWebSocket;
  server = http.createServer();
  setupWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  port = (server.address() as any).port;
}, 180_000);

afterAll(async () => {
  try { await closeWs?.(); } catch { /* ignore */ }
  await new Promise<void>((r) => server.close(() => r()));
  await stopTestDb();
});

function wsAuth(token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`);
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("ws timeout")); }, 5000);
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "auth_ok" || msg.type === "auth_error") {
        clearTimeout(timer);
        ws.close();
        resolve(msg);
      }
    });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

describe("WebSocket connection auth", () => {
  it("accepts a valid (dispatcher) token → auth_ok", async () => {
    const token = jwt.sign({ userId: 1, role: "dispatcher" }, SECRET, { expiresIn: "1h" });
    const msg = await wsAuth(token);
    expect(msg.type).toBe("auth_ok");
  });

  it("rejects an invalid token → auth_error", async () => {
    const msg = await wsAuth("garbage.token.value");
    expect(msg.type).toBe("auth_error");
  });

  it("rejects a driver token without a session → auth_error", async () => {
    const token = jwt.sign({ userId: 2, role: "driver" }, SECRET, { expiresIn: "1h" });
    const msg = await wsAuth(token);
    expect(msg.type).toBe("auth_error");
  });
});
