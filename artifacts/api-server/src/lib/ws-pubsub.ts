/**
 * Cross-worker WebSocket broadcast via Redis pub/sub (clustering foundation).
 *
 * In a single Node process, broadcastToAll() delivers directly to local sockets.
 * Under clustering, a broadcast must reach clients on EVERY worker, so instead we
 * publish the message to a Redis channel; each worker's subscriber then delivers it
 * to its OWN local sockets. The publishing worker also receives its own message via
 * the subscriber, so every client gets it exactly once (broadcastToAll must NOT also
 * deliver locally when pub/sub is enabled).
 *
 * Fully gated + namespaced:
 *   - WS_PUBSUB=1 (or CLUSTER_WORKERS>1) turns it on. Live single-process server runs
 *     with neither set → identical direct-delivery behavior, zero risk.
 *   - WS_CHANNEL_PREFIX isolates instances (the port-4001 test uses a different prefix
 *     so it can never cross-talk with the live 4000 server).
 */
import { redis } from "./redis.js";
import { clog } from "./logger.js";

const PREFIX = process.env.WS_CHANNEL_PREFIX || "ws";
const BROADCAST_CHANNEL = `${PREFIX}:broadcast`;

export const WS_PUBSUB_ENABLED =
  process.env.WS_PUBSUB === "1" || (Number(process.env.CLUSTER_WORKERS) || 1) > 1;

let pub: ReturnType<typeof redis.duplicate> | null = null;
let sub: ReturnType<typeof redis.duplicate> | null = null;

export function publishBroadcast(message: string): void {
  if (!WS_PUBSUB_ENABLED) return;
  if (!pub) pub = redis.duplicate();
  pub.publish(BROADCAST_CHANNEL, message).catch(() => {});
}

/** Subscribe this worker to the broadcast channel; deliver each message to local sockets. */
export function startBroadcastSubscriber(onMessage: (message: string) => void): void {
  if (!WS_PUBSUB_ENABLED || sub) return;
  sub = redis.duplicate();
  sub.on("error", (e: Error) => clog.error("[WS PUBSUB] subscriber error:", e.message));
  sub.on("message", (_channel: string, message: string) => {
    try { onMessage(message); } catch { /* never let a bad payload crash delivery */ }
  });
  sub.subscribe(BROADCAST_CHANNEL)
    .then(() => clog.log(`[WS PUBSUB] subscribed to ${BROADCAST_CHANNEL} (pid ${process.pid})`))
    .catch((e: Error) => clog.error("[WS PUBSUB] subscribe failed:", e.message));
}

export function stopBroadcastPubSub(): void {
  try { sub?.quit(); } catch { /* */ }
  try { pub?.quit(); } catch { /* */ }
  sub = null;
  pub = null;
}
