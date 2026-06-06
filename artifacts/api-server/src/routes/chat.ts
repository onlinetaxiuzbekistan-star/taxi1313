import { Router, type IRouter } from "express";
import { clog } from "../lib/logger.js";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { db, messagesTable, usersTable, ridesTable, chatParticipantsTable } from "@workspace/db";
import { eq, and, or, asc, desc, sql, inArray } from "drizzle-orm";
import { authMiddleware, requireRole, AuthRequest } from "../middlewares/auth.js";
import { broadcastToUser, broadcastToRole, onChatMessage, onTyping, onMessageRead, onMessageDelivered } from "../lib/websocket.js";
import { notifyNewChatMessage, notifyChatMessageToRecipients } from "../lib/notifications.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOICE_DIR = path.resolve(process.cwd(), "artifacts", "uploads", "voice");
fs.mkdirSync(VOICE_DIR, { recursive: true });

const PHOTO_DIR = path.resolve(process.cwd(), "artifacts", "uploads", "chat");
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const voiceStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, VOICE_DIR),
  filename: (_req, _file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `${unique}.webm`);
  },
});

const voiceUpload = multer({
  storage: voiceStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files allowed"));
    }
  },
});

const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PHOTO_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"));
  },
});

const router: IRouter = Router();

async function getRideParticipantIds(rideId: number): Promise<number[]> {
  const participants = await db.select({ userId: chatParticipantsTable.userId })
    .from(chatParticipantsTable)
    .where(eq(chatParticipantsTable.rideId, rideId));
  return participants.map(p => p.userId);
}

async function broadcastToRideParticipants(rideId: number, senderId: number, payload: object) {
  const participantIds = await getRideParticipantIds(rideId);
  for (const uid of participantIds) {
    broadcastToUser(uid, payload);
  }
  if (!participantIds.includes(senderId)) {
    broadcastToUser(senderId, payload);
  }
  broadcastToRole("dispatcher", payload);
  broadcastToRole("admin", payload);
}

async function ensureParticipant(rideId: number, userId: number, role: string, name: string) {
  try {
    await db.insert(chatParticipantsTable).values({
      rideId, userId, role, name,
    }).onConflictDoNothing();
  } catch {}
}

async function getSenderName(userId: number): Promise<string> {
  const user = await db.select({ name: usersTable.name, role: usersTable.role, id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.id, userId)).limit(1);
  if (!user[0]) return "Пользователь";
  if (user[0].role === "driver") {
    return `${user[0].name} (#${user[0].id})`;
  }
  return user[0].name || "Пользователь";
}

router.get("/messages", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.query.rideId as string) || 0;
    const peerId = parseInt(req.query.peerId as string) || 0;
    const myId = req.userId!;

    let messages: any[];
    if (rideId > 0) {
      const myRole = req.userRole;
      if (myRole !== "dispatcher" && myRole !== "admin") {
        const participantIds = await getRideParticipantIds(rideId);
        const ride = await db.select({ driverId: ridesTable.driverId }).from(ridesTable)
          .where(eq(ridesTable.id, rideId)).limit(1);
        const isDriver = ride.length > 0 && ride[0].driverId === myId;
        if (!participantIds.includes(myId) && !isDriver) {
          res.status(403).json({ error: "forbidden" });
          return;
        }
      }
      messages = await db.select().from(messagesTable)
        .where(eq(messagesTable.rideId, rideId))
        .orderBy(asc(messagesTable.createdAt))
        .limit(200);
    } else if (peerId) {
      messages = await db.select().from(messagesTable)
        .where(
          or(
            and(eq(messagesTable.senderId, myId), eq(messagesTable.recipientId, peerId)),
            and(eq(messagesTable.senderId, peerId), eq(messagesTable.recipientId, myId)),
          )
        )
        .orderBy(asc(messagesTable.createdAt))
        .limit(200);
    } else {
      messages = [];
    }

    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.get("/participants", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const rideId = parseInt(req.query.rideId as string) || 0;
    if (!rideId) {
      res.json({ participants: [] });
      return;
    }

    const participants = await db.select().from(chatParticipantsTable)
      .where(eq(chatParticipantsTable.rideId, rideId));

    res.json({ participants });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/join", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { rideId } = req.body;
    if (!rideId) {
      res.status(400).json({ error: "rideId required" });
      return;
    }

    const name = await getSenderName(req.userId!);
    await ensureParticipant(rideId, req.userId!, req.userRole!, name);

    const payload = {
      type: "participant_joined",
      rideId,
      userId: req.userId,
      role: req.userRole,
      name,
    };
    await broadcastToRideParticipants(rideId, req.userId!, payload);

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/send", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { peerId, rideId, message } = req.body;
    if (!message?.trim()) {
      res.status(400).json({ error: "validation_error", message: "Сообщение обязательно" });
      return;
    }

    const senderName = await getSenderName(req.userId!);

    if (rideId && rideId > 0) {
      await ensureParticipant(rideId, req.userId!, req.userRole!, senderName);
    }

    const [msg] = await db.insert(messagesTable).values({
      rideId: rideId || 0,
      senderId: req.userId!,
      senderRole: req.userRole!,
      senderName,
      recipientId: peerId ? parseInt(peerId) : null,
      message: message.trim(),
      type: "text",
      status: "sent",
    }).returning();

    const payload = { type: "new_chat_message", message: msg };

    if (rideId && rideId > 0) {
      await broadcastToRideParticipants(rideId, req.userId!, payload);
      const participantIds = await getRideParticipantIds(rideId);
      notifyChatMessageToRecipients(participantIds, req.userId!, senderName, message.trim(), rideId).catch(() => {});
    } else if (peerId) {
      broadcastToUser(parseInt(peerId), payload);
      broadcastToUser(req.userId!, payload);
      notifyNewChatMessage(parseInt(peerId), req.userId!, senderName, message.trim(), 0, req.userId!).catch(() => {});
    } else {
      broadcastToUser(req.userId!, payload);
    }

    res.status(201).json(msg);
  } catch (err: any) {
    req.log?.error?.({ err: err?.message || err }, "Chat send error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/send-voice", authMiddleware, (req, res, next) => {
  voiceUpload.single("voice")(req, res, (err: any) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "Файл слишком большой (макс 10МБ)" : err.message || "Ошибка загрузки";
      res.status(400).json({ error: "upload_error", message: msg });
      return;
    }
    next();
  });
}, async (req: AuthRequest, res) => {
  const file = (req as any).file;
  try {
    if (!file) {
      res.status(400).json({ error: "validation_error", message: "Голосовой файл обязателен" });
      return;
    }

    const peerId = req.body.peerId ? parseInt(req.body.peerId) : null;
    const rideId = req.body.rideId ? parseInt(req.body.rideId) : 0;
    const duration = req.body.duration ? parseFloat(req.body.duration) : 0;

    const senderName = await getSenderName(req.userId!);

    if (rideId > 0) {
      await ensureParticipant(rideId, req.userId!, req.userRole!, senderName);
    }

    const audioUrl = `/api/uploads/voice/${file.filename}`;
    const messageText = JSON.stringify({ audioUrl, duration: Math.round(duration) });

    const [msg] = await db.insert(messagesTable).values({
      rideId: rideId || 0,
      senderId: req.userId!,
      senderRole: req.userRole!,
      senderName,
      recipientId: peerId,
      message: messageText,
      type: "voice",
      status: "sent",
    }).returning();

    const payload = { type: "new_chat_message", message: msg };
    const voicePreview = "🎤 Голосовое сообщение";

    if (rideId > 0) {
      await broadcastToRideParticipants(rideId, req.userId!, payload);
      const participantIds = await getRideParticipantIds(rideId);
      notifyChatMessageToRecipients(participantIds, req.userId!, senderName, voicePreview, rideId).catch(() => {});
    } else if (peerId) {
      broadcastToUser(peerId, payload);
      broadcastToUser(req.userId!, payload);
      notifyNewChatMessage(peerId, req.userId!, senderName, voicePreview, 0, req.userId!).catch(() => {});
    } else {
      broadcastToUser(req.userId!, payload);
    }

    res.status(201).json(msg);
  } catch (err: any) {
    if (file?.path) {
      try { fs.unlinkSync(file.path); } catch {}
    }
    req.log?.error?.({ err: err?.message || err }, "Voice send error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/send-photo", authMiddleware, (req, res, next) => {
  photoUpload.single("photo")(req, res, (err: any) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "Файл слишком большой (макс 10МБ)" : err.message || "Ошибка загрузки";
      res.status(400).json({ error: "upload_error", message: msg });
      return;
    }
    next();
  });
}, async (req: AuthRequest, res) => {
  const file = (req as any).file;
  try {
    if (!file) {
      res.status(400).json({ error: "validation_error", message: "Фото обязательно" });
      return;
    }

    const peerId = req.body.peerId ? parseInt(req.body.peerId) : null;
    const rideId = req.body.rideId ? parseInt(req.body.rideId) : 0;
    const caption = req.body.caption?.trim() || "";

    const senderName = await getSenderName(req.userId!);

    if (rideId > 0) {
      await ensureParticipant(rideId, req.userId!, req.userRole!, senderName);
    }

    const photoUrl = `/api/uploads/chat/${file.filename}`;
    const messageText = JSON.stringify({ photoUrl, caption });

    const [msg] = await db.insert(messagesTable).values({
      rideId: rideId || 0,
      senderId: req.userId!,
      senderRole: req.userRole!,
      senderName,
      recipientId: peerId,
      message: messageText,
      type: "photo",
      status: "sent",
    }).returning();

    const payload = { type: "new_chat_message", message: msg };
    const photoPreview = caption ? `📷 ${caption}` : "📷 Фото";

    if (rideId > 0) {
      await broadcastToRideParticipants(rideId, req.userId!, payload);
      const participantIds = await getRideParticipantIds(rideId);
      notifyChatMessageToRecipients(participantIds, req.userId!, senderName, photoPreview, rideId).catch(() => {});
    } else if (peerId) {
      broadcastToUser(peerId, payload);
      broadcastToUser(req.userId!, payload);
      notifyNewChatMessage(peerId, req.userId!, senderName, photoPreview, 0, req.userId!).catch(() => {});
    } else {
      broadcastToUser(req.userId!, payload);
    }

    res.status(201).json(msg);
  } catch (err: any) {
    if (file?.path) {
      try { fs.unlinkSync(file.path); } catch {}
    }
    req.log?.error?.({ err: err?.message || err }, "Photo send error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/read", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { rideId, messageIds } = req.body;
    if (!messageIds?.length) {
      res.json({ ok: true });
      return;
    }

    await db.update(messagesTable)
      .set({ status: "read" })
      .where(
        and(
          sql`${messagesTable.id} IN ${messageIds}`,
          sql`${messagesTable.senderId} != ${req.userId!}`,
        )
      );

    const payload = {
      type: "messages_read",
      rideId: rideId || 0,
      messageIds,
      readBy: req.userId,
    };

    if (rideId && rideId > 0) {
      await broadcastToRideParticipants(rideId, req.userId!, payload);
    } else {
      const msgs = await db.select({ senderId: messagesTable.senderId })
        .from(messagesTable)
        .where(sql`${messagesTable.id} IN ${messageIds}`)
        .limit(1);
      if (msgs.length > 0) {
        broadcastToUser(msgs[0].senderId, payload);
        broadcastToUser(req.userId!, payload);
      }
    }

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/conversations", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const myId = req.userId!;

    const rows = await db.execute(sql`
      SELECT 
        CASE WHEN sender_id = ${myId} THEN recipient_id ELSE sender_id END AS peer_id,
        MAX(id) AS last_msg_id,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE sender_id != ${myId} AND status != 'read') AS unread_count,
        MAX(CASE WHEN sender_id != ${myId} THEN type END) AS last_type
      FROM messages
      WHERE (sender_id = ${myId} OR recipient_id = ${myId}) AND ride_id = 0
      GROUP BY peer_id
      ORDER BY last_msg_id DESC
      LIMIT 50
    `);

    const peerIds = (rows.rows as any[]).map(r => r.peer_id).filter(Boolean);
    if (peerIds.length === 0) {
      res.json({ conversations: [] });
      return;
    }

    const peers = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      phone: usersTable.phone,
      role: usersTable.role,
    }).from(usersTable).where(sql`${usersTable.id} IN ${peerIds}`);

    const lastMsgIds = (rows.rows as any[]).map(r => r.last_msg_id);
    const lastMessages = lastMsgIds.length > 0 ? await db.select().from(messagesTable)
      .where(sql`${messagesTable.id} IN ${lastMsgIds}`) : [];

    const conversations = (rows.rows as any[]).map(r => {
      const peer = peers.find(p => p.id === r.peer_id);
      const lastMsg = lastMessages.find(m => m.id === r.last_msg_id);
      let preview = lastMsg?.message || "";
      if (lastMsg?.type === "photo") preview = "📷 Фото";
      else if (lastMsg?.type === "voice") preview = "🎤 Голосовое";
      return {
        peerId: r.peer_id,
        peerName: peer?.name || "Неизвестный",
        peerPhone: peer?.phone || "",
        peerRole: peer?.role || "",
        lastMessage: preview,
        lastMessageType: lastMsg?.type || "text",
        lastMessageAt: lastMsg?.createdAt || null,
        totalMessages: parseInt(r.total),
        unreadCount: parseInt(r.unread_count || "0"),
      };
    });

    res.json({ conversations });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.get("/dispatcher-info", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { isUserOnline } = await import("../lib/websocket.js");
    const dispatchers = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      phone: usersTable.phone,
      acceptsCalls: usersTable.acceptsCalls,
    }).from(usersTable).where(
      or(eq(usersTable.role, "dispatcher"), eq(usersTable.role, "admin"))
    );
    if (dispatchers.length > 0) {
      const onlineDispatcher = dispatchers.find(d => isUserOnline(d.id) && d.acceptsCalls !== false);
      const anyOnline = dispatchers.find(d => isUserOnline(d.id));
      const best = onlineDispatcher || anyOnline || dispatchers[0];
      res.json({ id: best.id, name: best.name, phone: best.phone });
    } else {
      res.json({ id: null, name: null, error: "no_dispatchers" });
    }
  } catch (err: any) {
    clog.error("[dispatcher-info] error:", err?.message);
    res.json({ id: null, name: null, error: "server_error" });
  }
});

router.get("/unread-total", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const myId = req.userId!;
    const dmResult = (await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM messages
      WHERE recipient_id = ${myId} AND status != 'read' AND ride_id = 0
    `)).rows as any[];
    const dmCount = parseInt(dmResult[0]?.cnt || "0");
    res.json({ total: dmCount });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

onChatMessage(async (ws, payload) => {
  try {
    const { peerId, rideId, message } = payload;
    if (!message?.trim() || !ws.userId) return;

    const senderName = await getSenderName(ws.userId);

    if (rideId && rideId > 0) {
      await ensureParticipant(rideId, ws.userId, ws.userRole || "unknown", senderName);
    }

    const [msg] = await db.insert(messagesTable).values({
      rideId: rideId || 0,
      senderId: ws.userId,
      senderRole: ws.userRole || "unknown",
      senderName,
      recipientId: peerId || null,
      message: message.trim(),
      type: "text",
      status: "sent",
    }).returning();

    const wsPayload = { type: "new_chat_message", message: msg };
    if (rideId && rideId > 0) {
      await broadcastToRideParticipants(rideId, ws.userId, wsPayload);
    } else if (peerId) {
      broadcastToUser(peerId, wsPayload);
      broadcastToUser(ws.userId, wsPayload);
    } else {
      broadcastToUser(ws.userId, wsPayload);
    }
  } catch {
  }
});

onTyping(async (ws, payload) => {
  try {
    const { rideId, peerId } = payload;
    if (!ws.userId) return;

    const typingPayload = {
      type: "typing",
      rideId: rideId || 0,
      userId: ws.userId,
      userName: await getSenderName(ws.userId),
      userRole: ws.userRole,
    };

    if (rideId && rideId > 0) {
      await broadcastToRideParticipants(rideId, ws.userId, typingPayload);
    } else if (peerId) {
      broadcastToUser(peerId, typingPayload);
    }
  } catch {}
});

onMessageRead(async (ws, payload) => {
  try {
    const { rideId, messageIds } = payload;
    if (!ws.userId || !messageIds?.length) return;

    await db.update(messagesTable)
      .set({ status: "read" })
      .where(
        and(
          sql`${messagesTable.id} IN ${messageIds}`,
          sql`${messagesTable.senderId} != ${ws.userId}`,
        )
      );

    const readPayload = {
      type: "messages_read",
      rideId: rideId || 0,
      messageIds,
      readBy: ws.userId,
    };

    if (rideId && rideId > 0) {
      await broadcastToRideParticipants(rideId, ws.userId, readPayload);
    } else {
      const msgs = await db.select({ senderId: messagesTable.senderId })
        .from(messagesTable)
        .where(sql`${messagesTable.id} IN ${messageIds}`)
        .limit(1);
      if (msgs.length > 0) {
        broadcastToUser(msgs[0].senderId, readPayload);
        broadcastToUser(ws.userId, readPayload);
      }
    }
  } catch {}
});

onMessageDelivered(async (ws, payload) => {
  try {
    const { messageIds, rideId } = payload;
    if (!ws.userId || !messageIds?.length) return;

    await db.update(messagesTable)
      .set({ status: "delivered" })
      .where(
        and(
          sql`${messagesTable.id} IN ${messageIds}`,
          sql`${messagesTable.senderId} != ${ws.userId}`,
          eq(messagesTable.status, "sent"),
        )
      );

    const deliveredPayload = {
      type: "messages_delivered",
      rideId: rideId || 0,
      messageIds,
      deliveredTo: ws.userId,
    };

    if (rideId && rideId > 0) {
      await broadcastToRideParticipants(rideId, ws.userId, deliveredPayload);
    } else {
      const msgs = await db.select({ senderId: messagesTable.senderId })
        .from(messagesTable)
        .where(sql`${messagesTable.id} IN ${messageIds}`)
        .limit(1);
      if (msgs.length > 0) {
        broadcastToUser(msgs[0].senderId, deliveredPayload);
      }
    }
  } catch {}
});

export default router;
