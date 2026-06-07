import { WebSocketServer, WebSocket } from "ws";
import { clog } from "./logger.js";
import { Server } from "http";
import jwt from "jsonwebtoken";
import { db, orderOffersTable, ridesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { JWT_SECRET } from "./jwt-secret.js";
import { errorMessage } from "./errors.js";
import { WS_PUBSUB_ENABLED, publishBroadcast, startBroadcastSubscriber } from "./ws-pubsub.js";

interface AuthenticatedWS extends WebSocket {
  userId?: number;
  userRole?: string;
  isAlive?: boolean;
  sessionId?: string;
  _mappedUserId?: number;
  _presenceMarked?: boolean;
}

const driverSessions = new Map<number, string>();

// ===== Voice call state machine (Variant A hardening) =====
type CallState = "ringing" | "active";
interface CallRecord {
  callId: string;
  callerId: number;
  calleeId: number;
  callerRole: string;
  calleeRole: string;
  state: CallState;
  startedAt: number;
}
const activeCalls = new Map<string, CallRecord>();
const userInCall = new Map<number, string>(); // userId -> callId
const callOfferTimestamps = new Map<number, number[]>(); // userId -> ms timestamps
const CALL_OFFER_RATE_LIMIT_PER_MIN = 5;
const CALL_RING_TIMEOUT_MS = 45_000;

function genCallId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function canCall(callerRole: string | undefined, calleeRole: string | undefined): boolean {
  // Allow admin/dispatcher to/from anyone, allow driver<->dispatcher, allow passenger->dispatcher.
  // FORBID driver -> driver and any unknown role combos.
  const c = (callerRole || "").toLowerCase();
  const t = (calleeRole || "").toLowerCase();
  if (!c || !t) return false;
  if (c === "driver" && t === "driver") return false;
  const allowed = new Set(["admin", "dispatcher", "driver", "passenger"]);
  if (!allowed.has(c) || !allowed.has(t)) return false;
  return true;
}

function checkCallRateLimit(userId: number): boolean {
  const now = Date.now();
  const arr = (callOfferTimestamps.get(userId) || []).filter((t) => now - t < 60_000);
  if (arr.length >= CALL_OFFER_RATE_LIMIT_PER_MIN) {
    callOfferTimestamps.set(userId, arr);
    return false;
  }
  arr.push(now);
  callOfferTimestamps.set(userId, arr);
  return true;
}

function cleanupCall(callId: string) {
  const c = activeCalls.get(callId);
  if (!c) return;
  activeCalls.delete(callId);
  if (userInCall.get(c.callerId) === callId) userInCall.delete(c.callerId);
  if (userInCall.get(c.calleeId) === callId) userInCall.delete(c.calleeId);
}

function getActiveCallFor(userId: number): CallRecord | null {
  const cid = userInCall.get(userId);
  if (!cid) return null;
  return activeCalls.get(cid) || null;
}

// Periodic timeout sweep for unanswered ringing calls
const callTimeoutSweep = setInterval(() => {
  const now = Date.now();
  for (const c of Array.from(activeCalls.values())) {
    if (c.state === "ringing" && now - c.startedAt > CALL_RING_TIMEOUT_MS) {
      clog.log(`[WS CALL] ringing TIMEOUT callId=${c.callId} caller=${c.callerId} callee=${c.calleeId}`);
      try { broadcastToUser(c.callerId, { type: "call_reject", fromUserId: c.calleeId, reason: "no_answer", callId: c.callId }); } catch {}
      try { broadcastToUser(c.calleeId, { type: "call_end", fromUserId: c.callerId, reason: "no_answer", callId: c.callId }); } catch {}
      cleanupCall(c.callId);
    }
  }
}, 5_000);
// ===== End voice call state machine =====

let wss: WebSocketServer | null = null;

const onlineUsers = new Map<number, { role: string; count: number }>();

// userId -> set of that user's live sockets. Lets broadcastToUser() route in
// O(sockets-per-user) instead of scanning every connected client (O(n)).
const userSockets = new Map<number, Set<AuthenticatedWS>>();

function registerUserSocket(userId: number, ws: AuthenticatedWS): void {
  const prev = ws._mappedUserId as number | undefined;
  if (prev !== undefined && prev !== userId) unregisterUserSocket(prev, ws);
  let set = userSockets.get(userId);
  if (!set) { set = new Set(); userSockets.set(userId, set); }
  set.add(ws);
  ws._mappedUserId = userId;
}

function unregisterUserSocket(userId: number, ws: AuthenticatedWS): void {
  const set = userSockets.get(userId);
  if (set) {
    set.delete(ws);
    if (set.size === 0) userSockets.delete(userId);
  }
}
const offlineGraceTimers = new Map<number, ReturnType<typeof setTimeout>>();
const OFFLINE_GRACE_MS = 30_000;

type ChatMessageHandler = (ws: AuthenticatedWS, payload: any) => void;
let chatMessageHandler: ChatMessageHandler | null = null;
let typingHandler: ((ws: AuthenticatedWS, payload: any) => void) | null = null;
let readHandler: ((ws: AuthenticatedWS, payload: any) => void) | null = null;
let deliveredHandler: ((ws: AuthenticatedWS, payload: any) => void) | null = null;

export function onChatMessage(handler: ChatMessageHandler) {
  chatMessageHandler = handler;
}

export function onTyping(handler: (ws: AuthenticatedWS, payload: any) => void) {
  typingHandler = handler;
}

export function onMessageRead(handler: (ws: AuthenticatedWS, payload: any) => void) {
  readHandler = handler;
}

export function onMessageDelivered(handler: (ws: AuthenticatedWS, payload: any) => void) {
  deliveredHandler = handler;
}

export function isUserOnline(userId: number): boolean {
  return onlineUsers.has(userId);
}

export function getOnlineUserIds(): number[] {
  return Array.from(onlineUsers.keys());
}

function markUserOnline(userId: number, role: string) {
  const graceTimer = offlineGraceTimers.get(userId);
  if (graceTimer) {
    clearTimeout(graceTimer);
    offlineGraceTimers.delete(userId);
  }
  const existing = onlineUsers.get(userId);
  if (existing) {
    existing.count++;
  } else {
    onlineUsers.set(userId, { role, count: 1 });
    broadcastToAll({ type: "user_online", userId, role });
    clog.log(`[WS] CONNECT: userId=${userId} role=${role}`);
  }
}

function markUserOffline(userId: number) {
  const existing = onlineUsers.get(userId);
  if (!existing) return;
  existing.count--;
  if (existing.count <= 0) {
    const graceTimer = setTimeout(() => {
      offlineGraceTimers.delete(userId);
      const stillOnline = onlineUsers.get(userId);
      if (stillOnline && stillOnline.count <= 0) {
        onlineUsers.delete(userId);
        broadcastToAll({ type: "user_offline", userId });
        clog.log(`[WS] DISCONNECT: userId=${userId} (after ${OFFLINE_GRACE_MS / 1000}s grace)`);
      }
    }, OFFLINE_GRACE_MS);
    offlineGraceTimers.set(userId, graceTimer);
  }
}

async function deliverPendingOffers(driverId: number, ws: AuthenticatedWS) {
  try {
    const pendingOffers = await db.select({
      id: orderOffersTable.id,
      rideId: orderOffersTable.rideId,
      expiresAt: orderOffersTable.expiresAt,
    }).from(orderOffersTable).where(
      and(
        eq(orderOffersTable.driverId, driverId),
        eq(orderOffersTable.status, "pending"),
      )
    );

    if (pendingOffers.length === 0) return;

    for (const offer of pendingOffers) {
      const now = Date.now();
      const expiresAt = offer.expiresAt ? new Date(offer.expiresAt).getTime() : 0;
      if (expiresAt > 0 && expiresAt <= now) continue;

      const [ride] = await db.select().from(ridesTable).where(
        and(eq(ridesTable.id, offer.rideId), inArray(ridesTable.status, ["pending", "offered"]))
      );
      if (!ride) continue;

      const remainingMs = expiresAt > 0 ? expiresAt - now : 30000;
      clog.log(`[WS PENDING] delivering pending offer ${offer.id} to driver ${driverId}, ride=${offer.rideId}, remainingMs=${remainingMs}`);
      ws.send(JSON.stringify({
        type: "new_order",
        offerId: offer.id,
        ride,
        expiresIn: remainingMs,
      }));
    }
  } catch (err) {
    clog.warn(`[WS PENDING] error delivering pending offers to driver ${driverId}:`, err);
  }
}

export function setupWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: "/api/ws", maxPayload: 65536 });

  // Cluster mode: subscribe this worker to cross-worker broadcasts (Redis pub/sub).
  if (WS_PUBSUB_ENABLED) startBroadcastSubscriber(deliverBroadcastLocal);

  const MAX_CONNECTIONS_PER_USER = 3;

  wss.on("connection", (ws: AuthenticatedWS) => {
    ws.isAlive = true;
    ws._presenceMarked = false;

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "ping" && ws.userId) {
          ws.send(JSON.stringify({ type: "pong" }));
          ws.isAlive = true;
        } else if (msg.type === "auth" && msg.token) {
          try {
            const decoded = jwt.verify(msg.token, JWT_SECRET) as { userId: number; role: string; sid?: string };
            ws.userId = Number(decoded.userId);
            ws.userRole = decoded.role;
            registerUserSocket(ws.userId, ws);

            const isDriver = decoded.role === "driver";
            const maxConns = isDriver ? MAX_CONNECTIONS_PER_USER : 10;
            const existingConns: AuthenticatedWS[] = [];
            wss!.clients.forEach((other: AuthenticatedWS) => {
              if (other !== ws && other.userId === ws.userId && other.readyState === other.OPEN) {
                existingConns.push(other);
              }
            });
            while (existingConns.length >= maxConns) {
              const oldest = existingConns.shift()!;
              if (isDriver) {
                oldest.send(JSON.stringify({ type: "session_replaced" }));
                oldest.close(4001, "Session replaced");
              } else {
                oldest.close(1000, "Too many connections");
              }
            }

            if (decoded.role === "driver") {
              if (!decoded.sid) {
                ws.send(JSON.stringify({ type: "auth_error", message: "Driver token must include a session" }));
                ws.close(4002, "Session required");
                return;
              }
              const { db, driverSessionsTable } = await import("@workspace/db");
              const { eq, and, gt } = await import("drizzle-orm");
              const [validSession] = await db.select({ id: driverSessionsTable.id })
                .from(driverSessionsTable)
                .where(and(
                  eq(driverSessionsTable.driverId, ws.userId!),
                  eq(driverSessionsTable.sessionToken, decoded.sid),
                  gt(driverSessionsTable.expiresAt, new Date())
                ))
                .limit(1);
              if (!validSession) {
                ws.send(JSON.stringify({ type: "auth_error", message: "Session expired" }));
                ws.close(4002, "Session expired");
                return;
              }
              ws.sessionId = decoded.sid;
              driverSessions.set(ws.userId!, decoded.sid);
              clog.log(`[WS SESSION] driverId=${ws.userId} sessionId=${ws.sessionId}`);
            }
            if (!ws._presenceMarked) {
              ws._presenceMarked = true;
              markUserOnline(ws.userId, decoded.role);
            }
            clog.log(`[WS] Auth OK: userId=${ws.userId} (type=${typeof ws.userId}), role=${decoded.role}`);
            ws.send(JSON.stringify({
              type: "auth_ok",
              userId: ws.userId,
              role: decoded.role,
              workerPid: process.pid, // which cluster worker owns this socket (ops/debug)
              ...(decoded.role === "driver" ? { sessionId: ws.sessionId } : {}),
            }));

            if (decoded.role === "driver") {
              deliverPendingOffers(ws.userId, ws).catch(() => {});
            }
          } catch {
            ws.send(JSON.stringify({ type: "auth_error", message: "Invalid token" }));
          }
        } else if (msg.type === "presence_query" && ws.userId) {
          const userIds: number[] = msg.userIds || [];
          const result: Record<number, boolean> = {};
          for (const uid of userIds) {
            result[uid] = onlineUsers.has(uid);
          }
          ws.send(JSON.stringify({ type: "presence_result", online: result }));
        } else if (msg.type === "chat_message" && ws.userId) {
          if (chatMessageHandler) {
            chatMessageHandler(ws, msg);
          }
        } else if (msg.type === "typing" && ws.userId) {
          if (typingHandler) {
            typingHandler(ws, msg);
          }
        } else if (msg.type === "message_read" && ws.userId) {
          if (readHandler) {
            readHandler(ws, msg);
          }
        } else if (msg.type === "message_delivered" && ws.userId) {
          if (deliveredHandler) {
            deliveredHandler(ws, msg);
          }
        } else if (msg.type === "offer_ack" && ws.userId && ws.userRole === "driver") {
          const currentSession = driverSessions.get(ws.userId);
          if (currentSession && currentSession !== msg.sessionId) {
            clog.log(`[WS SESSION STALE] offer_ack driverId=${ws.userId} active=${currentSession} got=${msg.sessionId}`);
            return;
          }
          if (typeof msg.offerId === "number") {
            const [offer] = await db.select({ id: orderOffersTable.id })
              .from(orderOffersTable)
              .where(and(eq(orderOffersTable.id, msg.offerId), eq(orderOffersTable.driverId, ws.userId)));
            if (offer) {
              const { markOfferAcked } = await import("./autodispatch.js");
              markOfferAcked(msg.offerId);
            } else {
              clog.log(`[WS ACK REJECTED] offerId=${msg.offerId} not owned by driverId=${ws.userId}`);
            }
          }
        } else if (
          (msg.type === "call_offer" || msg.type === "call_answer" || msg.type === "ice_candidate" || msg.type === "call_end" || msg.type === "call_reject") && ws.userId
        ) {
          const fromId = ws.userId;
          const fromRole = ws.userRole || "";

          if (msg.type === "call_offer") {
            const targetUserId = Number(msg.targetUserId);
            if (!targetUserId) {
              clog.warn(`[WS CALL] call_offer DROPPED: invalid targetUserId`);
              return;
            }
            // Rate limit
            if (!checkCallRateLimit(fromId)) {
              clog.log(`[WS CALL] call_offer RATE LIMITED: userId=${fromId}`);
              broadcastToUser(fromId, { type: "call_reject", fromUserId: targetUserId, reason: "rate_limited" });
              return;
            }
            // Caller already in a call?
            if (userInCall.has(fromId)) {
              clog.log(`[WS CALL] call_offer REJECTED: caller ${fromId} already in callId=${userInCall.get(fromId)}`);
              broadcastToUser(fromId, { type: "call_reject", fromUserId: targetUserId, reason: "caller_busy" });
              return;
            }
            // Callee already in a call?
            if (userInCall.has(targetUserId)) {
              clog.log(`[WS CALL] call_offer REJECTED: callee ${targetUserId} busy in callId=${userInCall.get(targetUserId)}`);
              broadcastToUser(fromId, { type: "call_reject", fromUserId: targetUserId, reason: "busy" });
              return;
            }
            // Look up callee role + acceptsCalls in one query
            let calleeRole = "";
            try {
              const { db, usersTable } = await import("@workspace/db");
              const { eq } = await import("drizzle-orm");
              const [target] = await db
                .select({ role: usersTable.role, acceptsCalls: usersTable.acceptsCalls })
                .from(usersTable)
                .where(eq(usersTable.id, targetUserId))
                .limit(1);
              if (!target) {
                broadcastToUser(fromId, { type: "call_reject", fromUserId: targetUserId, reason: "unknown_user" });
                return;
              }
              if (target.acceptsCalls === false) {
                clog.log(`[WS CALL] call_offer REJECTED: targetUserId=${targetUserId} has acceptsCalls=false`);
                broadcastToUser(fromId, { type: "call_reject", fromUserId: targetUserId, reason: "calls_disabled" });
                return;
              }
              calleeRole = target.role || "";
            } catch (err) {
              clog.error(`[WS CALL] target lookup error:`, errorMessage(err));
              broadcastToUser(fromId, { type: "call_reject", fromUserId: targetUserId, reason: "server_error" });
              return;
            }
            // ACL: roles allowed to call each other
            if (!canCall(fromRole, calleeRole)) {
              clog.log(`[WS CALL] call_offer FORBIDDEN by ACL: ${fromRole}(${fromId}) -> ${calleeRole}(${targetUserId})`);
              broadcastToUser(fromId, { type: "call_reject", fromUserId: targetUserId, reason: "forbidden" });
              return;
            }
            // Create call record
            const callId = genCallId();
            const rec: CallRecord = {
              callId,
              callerId: fromId,
              calleeId: targetUserId,
              callerRole: fromRole,
              calleeRole,
              state: "ringing",
              startedAt: Date.now(),
            };
            activeCalls.set(callId, rec);
            userInCall.set(fromId, callId);
            userInCall.set(targetUserId, callId);
            clog.log(`[WS CALL] call_offer ACCEPTED callId=${callId} ${fromRole}(${fromId}) -> ${calleeRole}(${targetUserId})`);
            const delivered = broadcastToUser(targetUserId, {
              type: "call_offer",
              fromUserId: fromId,
              fromUserName: msg.fromUserName || "",
              sdp: msg.sdp,
              chatId: msg.chatId,
              chatType: msg.chatType,
              callId,
            });
            if (!delivered) {
              clog.log(`[WS CALL] call_offer NOT DELIVERED: target offline. cleanup callId=${callId}`);
              cleanupCall(callId);
              broadcastToUser(fromId, { type: "call_reject", fromUserId: targetUserId, reason: "user_offline" });
            }
            return;
          }

          // For call_answer / ice_candidate / call_end / call_reject: route via active call FSM
          const call = getActiveCallFor(fromId);
          if (!call) {
            clog.warn(`[WS CALL] ${msg.type} DROPPED: no active call for fromId=${fromId}`);
            return;
          }
          const peerId = call.callerId === fromId ? call.calleeId : call.callerId;

          if (msg.type === "call_answer") {
            if (call.calleeId !== fromId) {
              clog.warn(`[WS CALL] call_answer DROPPED: ${fromId} is not callee of callId=${call.callId}`);
              return;
            }
            call.state = "active";
            clog.log(`[WS CALL] call_answer callId=${call.callId} from callee=${fromId}`);
            broadcastToUser(peerId, {
              type: "call_answer",
              fromUserId: fromId,
              fromUserName: msg.fromUserName || "",
              sdp: msg.sdp,
              callId: call.callId,
            });
            return;
          }

          if (msg.type === "ice_candidate") {
            broadcastToUser(peerId, {
              type: "ice_candidate",
              fromUserId: fromId,
              candidate: msg.candidate,
              callId: call.callId,
            });
            return;
          }

          if (msg.type === "call_end" || msg.type === "call_reject") {
            clog.log(`[WS CALL] ${msg.type} callId=${call.callId} from=${fromId} -> peer=${peerId}`);
            broadcastToUser(peerId, {
              type: msg.type,
              fromUserId: fromId,
              reason: msg.reason || (msg.type === "call_reject" ? "declined" : "hangup"),
              callId: call.callId,
            });
            cleanupCall(call.callId);
            return;
          }
        } else if (msg.type === "driver_location" && ws.userId && ws.userRole === "driver") {
          const currentLocSession = driverSessions.get(ws.userId);
          if (currentLocSession && msg.sessionId !== currentLocSession) {
            return;
          }
          if (typeof msg.lat === "number" && typeof msg.lng === "number") {
            const { updateDriverLocation } = await import("./driver-cache.js");
            updateDriverLocation(ws.userId, msg.lat, msg.lng);
            // Targeted: only dispatchers/admins receive other drivers' positions.
            // Drivers/riders don't need a live feed of every driver in the city —
            // the rider's tracking view polls /api/rides/:id every few seconds.
            broadcastToStaff({ type: "driver_location", driverId: ws.userId, lat: msg.lat, lng: msg.lng });
          }
        }
      } catch {
      }
    });

    ws.on("close", () => {
      if (ws.userId) {
        const cid = userInCall.get(ws.userId);
        if (cid) {
          const c = activeCalls.get(cid);
          if (c) {
            const peerId = c.callerId === ws.userId ? c.calleeId : c.callerId;
            clog.log(`[WS CALL] disconnect cleanup callId=${cid} userId=${ws.userId} -> notify peer=${peerId}`);
            try { broadcastToUser(peerId, { type: "call_end", fromUserId: ws.userId, reason: "peer_disconnected", callId: cid }); } catch {}
            cleanupCall(cid);
          }
        }
      }

      if (ws.userId && ws.userRole === "driver" && ws.sessionId) {
        const current = driverSessions.get(ws.userId);
        if (current === ws.sessionId) {
          driverSessions.delete(ws.userId);
          clog.log(`[WS SESSION] driverId=${ws.userId} session ${ws.sessionId} cleared on close`);
        }
      }
      if (ws.userId && ws._presenceMarked) {
        ws._presenceMarked = false;
        markUserOffline(ws.userId);
      }
      if (ws.userId) unregisterUserSocket(ws.userId, ws);
    });
  });

  const heartbeat = setInterval(() => {
    wss!.clients.forEach((ws: AuthenticatedWS) => {
      if (!ws.isAlive) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => clearInterval(heartbeat));
}

/**
 * Graceful WebSocket shutdown: tell every client we're going away (code 1001 → clients
 * reconnect to the new instance), force-terminate any laggards after 2s, then close the
 * server. Resolves once the WS server is fully closed.
 */
export function closeWebSocket(): Promise<void> {
  return new Promise((resolve) => {
    clearInterval(callTimeoutSweep);
    if (!wss) { resolve(); return; }
    const server = wss;
    try {
      server.clients.forEach((ws: AuthenticatedWS) => {
        try { ws.close(1001, "Server shutting down"); } catch {}
      });
    } catch {}
    const term = setTimeout(() => {
      try { server.clients.forEach((ws: AuthenticatedWS) => { try { ws.terminate(); } catch {} }); } catch {}
    }, 2000);
    term.unref();
    server.close(() => { clearTimeout(term); wss = null; resolve(); });
  });
}

function injectVersion(data: Record<string, any>): Record<string, any> {
  if (data.version !== undefined) return data;
  const ride = data.ride || data.trip;
  if (ride && typeof ride === "object" && typeof ride.version === "number") {
    return { ...data, version: ride.version };
  }
  return data;
}

// Deliver an already-serialized broadcast to THIS worker's local sockets.
function deliverBroadcastLocal(message: string) {
  if (!wss) return;
  wss.clients.forEach((client: AuthenticatedWS) => {
    if (client.readyState === WebSocket.OPEN && client.userId) {
      client.send(message);
    }
  });
}

export function broadcastToAll(data: object) {
  const message = JSON.stringify(injectVersion(data as Record<string, any>));
  if (WS_PUBSUB_ENABLED) {
    // Cluster mode: publish to Redis; every worker's subscriber (including this one)
    // delivers to its own local sockets → each client receives it exactly once.
    publishBroadcast(message);
  } else {
    // Single-process (live 4000): direct local delivery — unchanged behavior.
    deliverBroadcastLocal(message);
  }
}

// ─── driver_status broadcast coalescer ───────────────────────────────────
// driver_status events fan out to every connected client; under a 1000-driver
// ramp (each driver flips online + busy/online during accept/start/complete)
// this used to emit ~6 individual broadcasts per driver × N recipients. Now
// events are buffered for up to STATUS_BATCH_WINDOW_MS and emitted either as
// the original `driver_status` (1 event) or as one `driver_status_batch`
// (many events) with the same individual entries. Clients handle both shapes.
const STATUS_BATCH_WINDOW_MS = 1_000;
const statusBuffer = new Map<number, { driverId: number; status: string; at: number }>();
let statusFlushTimer: NodeJS.Timeout | null = null;

function flushStatusBuffer(): void {
  statusFlushTimer = null;
  if (statusBuffer.size === 0) return;
  // Last write per driverId wins (Map semantics already collapsed transitions).
  const entries = Array.from(statusBuffer.values());
  statusBuffer.clear();
  if (entries.length === 1) {
    broadcastToAll({ type: "driver_status", driverId: entries[0].driverId, status: entries[0].status });
    return;
  }
  broadcastToAll({ type: "driver_status_batch", entries });
}

/**
 * Enqueue a driver_status change for broadcast. Coalesces same-driver flips
 * inside the 1-second batch window, and emits either a single driver_status
 * (1 event) or driver_status_batch (many) at the next flush.
 */
export function enqueueDriverStatusBroadcast(driverId: number, status: string): void {
  statusBuffer.set(driverId, { driverId, status, at: Date.now() });
  if (statusFlushTimer === null) {
    statusFlushTimer = setTimeout(flushStatusBuffer, STATUS_BATCH_WINDOW_MS);
  }
}

export function broadcastToUser(userId: number, data: object): boolean {
  if (!wss) {
    clog.warn(`[WS] broadcastToUser(${userId}): WSS not initialized`);
    return false;
  }
  const numId = Number(userId);
  const sockets = userSockets.get(numId);
  if (!sockets || sockets.size === 0) {
    clog.warn(`[WS] broadcastToUser(${numId}): NO connection found (${wss.clients.size} total clients)`);
    return false;
  }
  const message = JSON.stringify(injectVersion(data as Record<string, any>));
  let sentCount = 0;
  for (const client of sockets) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      sentCount++;
    }
  }
  if (sentCount === 0) {
    clog.warn(`[WS] broadcastToUser(${numId}): sockets tracked but none OPEN`);
    return false;
  }
  const msgType = (data as { type?: string })?.type || "unknown";
  clog.log(`[WS] broadcastToUser(${numId}): sent ${msgType} to ${sentCount} socket(s)`);
  return true;
}

export function broadcastToRole(role: string, data: object) {
  if (!wss) return;
  const message = JSON.stringify(injectVersion(data as Record<string, any>));
  wss.clients.forEach((client: AuthenticatedWS) => {
    if (client.readyState === WebSocket.OPEN && client.userRole === role) {
      client.send(message);
    }
  });
}

/**
 * Broadcast to staff users only (dispatchers + admins). Used for
 * driver_location and other dispatcher-map events that don't need to fan out
 * to every driver — the previous broadcastToAll for driver_location was
 * O(N²) on the message bus (N=1000 → ~2M messages over 90s; N=2000 → 7.5M).
 */
export function broadcastToStaff(data: object): void {
  if (!wss) return;
  const message = JSON.stringify(injectVersion(data as Record<string, any>));
  wss.clients.forEach((client: AuthenticatedWS) => {
    if (
      client.readyState === WebSocket.OPEN &&
      (client.userRole === "dispatcher" || client.userRole === "admin")
    ) {
      client.send(message);
    }
  });
}

export function forceLogoutDriver(driverId: number, reason: string) {
  if (!wss) return;
  const numId = Number(driverId);
  wss.clients.forEach((client: AuthenticatedWS) => {
    if (client.readyState === WebSocket.OPEN && Number(client.userId) === numId && client.userRole === "driver") {
      client.send(JSON.stringify({ type: "force_logout", reason }));
      setTimeout(() => {
        try { client.close(4003, "Force logout"); } catch {}
      }, 500);
    }
  });
  driverSessions.delete(numId);
  clog.log(`[WS] Force logout driver ${numId}: ${reason}`);
}

export function getWsStats() {
  if (!wss) return { totalClients: 0, authenticatedClients: 0, onlineUsers: 0, driverSessions: 0 };
  let total = 0;
  let authenticated = 0;
  wss.clients.forEach((client: AuthenticatedWS) => {
    total++;
    if (client.userId) authenticated++;
  });
  return {
    totalClients: total,
    authenticatedClients: authenticated,
    onlineUsers: onlineUsers.size,
    driverSessions: driverSessions.size,
  };
}
