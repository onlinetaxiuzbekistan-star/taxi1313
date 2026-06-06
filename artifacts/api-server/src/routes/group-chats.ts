import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db, groupChatsTable, groupChatMembersTable, groupChatMessagesTable, groupJoinRequestsTable, usersTable } from "@workspace/db";
import { eq, and, asc, desc, sql, inArray } from "drizzle-orm";
import { authMiddleware, requireRole, AuthRequest } from "../middlewares/auth.js";
import { broadcastToUser } from "../lib/websocket.js";

async function isMemberOrDispatcher(userId: number, userRole: string, chatId: number): Promise<boolean> {
  if (userRole === "dispatcher" || userRole === "admin") return true;
  const [membership] = await db.select({ id: groupChatMembersTable.id })
    .from(groupChatMembersTable)
    .where(and(eq(groupChatMembersTable.chatId, chatId), eq(groupChatMembersTable.userId, userId)))
    .limit(1);
  return !!membership;
}

const PHOTO_DIR = path.resolve(process.cwd(), "artifacts", "uploads", "chat");
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PHOTO_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `gc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
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

async function getSenderName(userId: number): Promise<string> {
  const user = await db.select({ name: usersTable.name, role: usersTable.role, id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.id, userId)).limit(1);
  if (!user[0]) return "Пользователь";
  if (user[0].role === "driver") return `${user[0].name} (#${user[0].id})`;
  return user[0].name || "Пользователь";
}

async function getChatMemberIds(chatId: number): Promise<number[]> {
  const members = await db.select({ userId: groupChatMembersTable.userId })
    .from(groupChatMembersTable)
    .where(eq(groupChatMembersTable.chatId, chatId));
  return members.map(m => m.userId);
}

async function broadcastToChatMembers(chatId: number, senderId: number, payload: object) {
  const memberIds = await getChatMemberIds(chatId);
  for (const uid of memberIds) {
    broadcastToUser(uid, payload);
  }
  if (!memberIds.includes(senderId)) {
    broadcastToUser(senderId, payload);
  }
}

router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const myId = req.userId!;
    const myRole = req.userRole!;

    let chats;
    if (myRole === "dispatcher" || myRole === "admin") {
      chats = await db.select().from(groupChatsTable).orderBy(desc(groupChatsTable.updatedAt));
    } else {
      const myMemberships = await db.select({ chatId: groupChatMembersTable.chatId })
        .from(groupChatMembersTable)
        .where(eq(groupChatMembersTable.userId, myId));

      const chatIds = myMemberships.map(m => m.chatId);
      if (chatIds.length === 0) {
        res.json({ chats: [] });
        return;
      }

      chats = await db.select().from(groupChatsTable)
        .where(sql`${groupChatsTable.id} IN ${chatIds}`)
        .orderBy(desc(groupChatsTable.updatedAt));
    }

    const chatIds = chats.map(c => c.id);
    let lastMessages: any[] = [];
    let memberCounts: any[] = [];

    if (chatIds.length > 0) {
      lastMessages = (await db.execute(sql`
        SELECT DISTINCT ON (chat_id) chat_id, message, type, sender_name, created_at
        FROM group_chat_messages
        WHERE chat_id IN ${chatIds}
        ORDER BY chat_id, created_at DESC
      `)).rows as any[];

      memberCounts = (await db.execute(sql`
        SELECT chat_id, COUNT(*) as count
        FROM group_chat_members
        WHERE chat_id IN ${chatIds}
        GROUP BY chat_id
      `)).rows as any[];
    }

    const enriched = chats.map(chat => {
      const lastMsg = lastMessages.find(m => m.chat_id === chat.id);
      const mc = memberCounts.find(m => m.chat_id === chat.id);
      let preview = "";
      if (lastMsg) {
        if (lastMsg.type === "photo") preview = "📷 Фото";
        else if (lastMsg.type === "voice") preview = "🎤 Голосовое";
        else preview = lastMsg.message;
      }
      return {
        ...chat,
        lastMessage: preview,
        lastMessageAt: lastMsg?.created_at || null,
        lastSenderName: lastMsg?.sender_name || "",
        memberCount: parseInt(mc?.count || "0"),
      };
    });

    res.json({ chats: enriched });
  } catch (err: any) {
    res.status(500).json({ error: "server_error", message: err?.message });
  }
});

router.post("/", authMiddleware, requireRole(["dispatcher", "admin"]), async (req: AuthRequest, res) => {
  try {
    const { name, chatType, cityId, branchId, driverGroupId, driverGroupIds, description, memberIds } = req.body;

    if (!name?.trim()) {
      res.status(400).json({ error: "validation_error", message: "Название обязательно" });
      return;
    }

    const [chat] = await db.insert(groupChatsTable).values({
      name: name.trim(),
      chatType: chatType || "custom",
      cityId: cityId || null,
      branchId: branchId || null,
      driverGroupId: driverGroupId || null,
      createdBy: req.userId!,
      description: description || "",
    }).returning();

    await db.insert(groupChatMembersTable).values({
      chatId: chat.id,
      userId: req.userId!,
      role: "admin",
    });

    if (memberIds?.length > 0) {
      const uniqueIds = [...new Set(memberIds.filter((id: number) => id !== req.userId!))] as number[];
      if (uniqueIds.length > 0) {
        await db.insert(groupChatMembersTable).values(
          uniqueIds.map((uid: number) => ({
            chatId: chat.id,
            userId: uid,
            role: "member" as const,
          }))
        );
      }
    }

    if (chatType === "city" && cityId) {
      const cityDrivers = await db.select({ id: usersTable.id }).from(usersTable)
        .where(and(eq(usersTable.role, "driver"), eq(usersTable.city, String(cityId))));
      const driverIds = cityDrivers.map(d => d.id).filter(id => id !== req.userId!);
      if (driverIds.length > 0) {
        await db.insert(groupChatMembersTable).values(
          driverIds.map(uid => ({ chatId: chat.id, userId: uid, role: "member" as const }))
        ).onConflictDoNothing();
      }
    }

    if (chatType === "driver_group") {
      const groupIds: number[] = Array.isArray(driverGroupIds) && driverGroupIds.length > 0
        ? driverGroupIds
        : driverGroupId ? [driverGroupId] : [];
      for (const gid of groupIds) {
        const groupDrivers = await db.select({ id: usersTable.id }).from(usersTable)
          .where(and(eq(usersTable.role, "driver"), eq(usersTable.groupId, gid)));
        const driverIds = groupDrivers.map(d => d.id).filter(id => id !== req.userId!);
        if (driverIds.length > 0) {
          await db.insert(groupChatMembersTable).values(
            driverIds.map(uid => ({ chatId: chat.id, userId: uid, role: "member" as const }))
          ).onConflictDoNothing();
        }
      }
    }

    res.status(201).json(chat);
  } catch (err: any) {
    res.status(500).json({ error: "server_error", message: err?.message });
  }
});

router.get("/available", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const myId = req.userId!;
    const [me] = await db.select({ city: usersTable.city }).from(usersTable).where(eq(usersTable.id, myId)).limit(1);
    if (!me?.city) { res.json({ groups: [] }); return; }

    const myCityRows = await db.execute(sql`SELECT id FROM cities WHERE name_ru = ${me.city} LIMIT 1`);
    const myCityId = (myCityRows.rows as any[])[0]?.id;
    if (!myCityId) { res.json({ groups: [] }); return; }

    const myMemberships = await db.select({ chatId: groupChatMembersTable.chatId })
      .from(groupChatMembersTable).where(eq(groupChatMembersTable.userId, myId));
    const memberChatIds = myMemberships.map(m => m.chatId);

    let groups;
    if (memberChatIds.length > 0) {
      groups = await db.select().from(groupChatsTable)
        .where(sql`${groupChatsTable.cityId} = ${myCityId} AND ${groupChatsTable.id} NOT IN ${memberChatIds}`);
    } else {
      groups = await db.select().from(groupChatsTable)
        .where(eq(groupChatsTable.cityId, myCityId));
    }

    const myPendingReqs = await db.select({ chatId: groupJoinRequestsTable.chatId })
      .from(groupJoinRequestsTable)
      .where(and(eq(groupJoinRequestsTable.userId, myId), eq(groupJoinRequestsTable.status, "pending")));
    const pendingChatIds = new Set(myPendingReqs.map(r => r.chatId));

    const memberCounts = groups.length > 0
      ? (await db.execute(sql`SELECT chat_id, COUNT(*) as count FROM group_chat_members WHERE chat_id IN ${groups.map(g => g.id)} GROUP BY chat_id`)).rows as any[]
      : [];

    const enriched = groups.map(g => ({
      id: g.id,
      name: g.name,
      description: g.description,
      chatType: g.chatType,
      memberCount: parseInt(memberCounts.find((m: any) => m.chat_id === g.id)?.count || "0"),
      hasPendingRequest: pendingChatIds.has(g.id),
    }));

    res.json({ groups: enriched });
  } catch (err: any) {
    res.status(500).json({ error: "server_error", message: err?.message });
  }
});

router.get("/join-requests", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const requests = await db.execute(sql`
      SELECT r.id, r.chat_id, r.user_id, r.status, r.created_at,
             u.name as user_name, u.phone as user_phone, u.city as user_city,
             gc.name as chat_name
      FROM group_join_requests r
      JOIN users u ON u.id = r.user_id
      JOIN group_chats gc ON gc.id = r.chat_id
      WHERE r.status = 'pending'
      ORDER BY r.created_at DESC
    `);
    res.json({ requests: requests.rows });
  } catch (err: any) {
    res.status(500).json({ error: "server_error", message: err?.message });
  }
});

router.get("/join-requests/count", authMiddleware, requireRole("dispatcher", "admin"), async (_req: AuthRequest, res) => {
  try {
    const result = await db.execute(sql`SELECT COUNT(*) as count FROM group_join_requests WHERE status = 'pending'`);
    res.json({ count: parseInt((result.rows as any[])[0]?.count || "0") });
  } catch {
    res.json({ count: 0 });
  }
});

router.post("/join-requests/:id/approve", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isFinite(requestId) || requestId <= 0) { res.status(400).json({ error: "invalid_id" }); return; }
    const [request] = await db.select().from(groupJoinRequestsTable).where(eq(groupJoinRequestsTable.id, requestId)).limit(1);
    if (!request || request.status !== "pending") { res.status(404).json({ error: "not_found" }); return; }

    await db.update(groupJoinRequestsTable).set({ status: "approved", processedBy: req.userId!, processedAt: new Date() })
      .where(eq(groupJoinRequestsTable.id, requestId));

    const [existing] = await db.select().from(groupChatMembersTable)
      .where(and(eq(groupChatMembersTable.chatId, request.chatId), eq(groupChatMembersTable.userId, request.userId))).limit(1);
    if (!existing) {
      await db.insert(groupChatMembersTable).values({ chatId: request.chatId, userId: request.userId, role: "member" });
    }

    broadcastToUser(request.userId, { type: "join_request_approved", chatId: request.chatId });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "server_error", message: err?.message });
  }
});

router.post("/join-requests/:id/reject", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isFinite(requestId) || requestId <= 0) { res.status(400).json({ error: "invalid_id" }); return; }
    const [request] = await db.select().from(groupJoinRequestsTable).where(eq(groupJoinRequestsTable.id, requestId)).limit(1);
    if (!request || request.status !== "pending") { res.status(404).json({ error: "not_found" }); return; }

    await db.update(groupJoinRequestsTable).set({ status: "rejected", processedBy: req.userId!, processedAt: new Date() })
      .where(eq(groupJoinRequestsTable.id, requestId));

    broadcastToUser(request.userId, { type: "join_request_rejected", chatId: request.chatId });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "server_error", message: err?.message });
  }
});

router.post("/:id/request-join", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const chatId = Number(req.params.id);
    if (!Number.isFinite(chatId) || chatId <= 0) { res.status(400).json({ error: "invalid_id" }); return; }
    const myId = req.userId!;

    const [chat] = await db.select().from(groupChatsTable).where(eq(groupChatsTable.id, chatId)).limit(1);
    if (!chat) { res.status(404).json({ error: "not_found" }); return; }

    if (chat.cityId) {
      const [me] = await db.select({ city: usersTable.city }).from(usersTable).where(eq(usersTable.id, myId)).limit(1);
      if (me?.city) {
        const myCityRows = await db.execute(sql`SELECT id FROM cities WHERE name_ru = ${me.city} LIMIT 1`);
        const myCityId = (myCityRows.rows as any[])[0]?.id;
        if (myCityId !== chat.cityId) { res.status(403).json({ error: "wrong_city" }); return; }
      }
    }

    const [existing] = await db.select().from(groupChatMembersTable)
      .where(and(eq(groupChatMembersTable.chatId, chatId), eq(groupChatMembersTable.userId, myId))).limit(1);
    if (existing) { res.status(400).json({ error: "already_member" }); return; }

    const [pendingReq] = await db.select().from(groupJoinRequestsTable)
      .where(and(eq(groupJoinRequestsTable.chatId, chatId), eq(groupJoinRequestsTable.userId, myId), eq(groupJoinRequestsTable.status, "pending"))).limit(1);
    if (pendingReq) { res.status(400).json({ error: "already_requested" }); return; }

    const [request] = await db.insert(groupJoinRequestsTable).values({ chatId, userId: myId }).returning();
    res.status(201).json({ request });
  } catch (err: any) {
    res.status(500).json({ error: "server_error", message: err?.message });
  }
});

router.get("/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const chatId = parseInt(req.params.id, 10);
    const [chat] = await db.select().from(groupChatsTable).where(eq(groupChatsTable.id, chatId));
    if (!chat) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    if (req.userRole !== "dispatcher" && req.userRole !== "admin") {
      const [membership] = await db.select().from(groupChatMembersTable)
        .where(and(eq(groupChatMembersTable.chatId, chatId), eq(groupChatMembersTable.userId, req.userId!)));
      if (!membership) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
    }

    const members = await db.select({
      id: groupChatMembersTable.id,
      userId: groupChatMembersTable.userId,
      role: groupChatMembersTable.role,
      joinedAt: groupChatMembersTable.joinedAt,
    }).from(groupChatMembersTable).where(eq(groupChatMembersTable.chatId, chatId));

    const memberUserIds = members.map(m => m.userId);
    let users: any[] = [];
    if (memberUserIds.length > 0) {
      users = await db.select({
        id: usersTable.id,
        name: usersTable.name,
        phone: usersTable.phone,
        role: usersTable.role,
      }).from(usersTable).where(sql`${usersTable.id} IN ${memberUserIds}`);
    }

    const enrichedMembers = members.map(m => {
      const user = users.find(u => u.id === m.userId);
      return {
        ...m,
        userName: user?.name || "Неизвестный",
        userPhone: user?.phone || "",
        userRole: user?.role || "",
      };
    });

    res.json({ chat, members: enrichedMembers });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

router.patch("/:id/settings", authMiddleware, requireRole(["dispatcher", "admin"]), async (req: AuthRequest, res) => {
  try {
    const chatId = parseInt(req.params.id);
    const { photosEnabled, voiceEnabled, callsEnabled } = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (typeof photosEnabled === "boolean") updates.photosEnabled = photosEnabled;
    if (typeof voiceEnabled === "boolean") updates.voiceEnabled = voiceEnabled;
    if (typeof callsEnabled === "boolean") updates.callsEnabled = callsEnabled;

    const [updated] = await db.update(groupChatsTable).set(updates).where(eq(groupChatsTable.id, chatId)).returning();
    if (!updated) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({
      photosEnabled: updated.photosEnabled,
      voiceEnabled: updated.voiceEnabled,
      callsEnabled: updated.callsEnabled,
    });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/:id", authMiddleware, requireRole(["dispatcher", "admin"]), async (req: AuthRequest, res) => {
  try {
    const chatId = parseInt(req.params.id);
    await db.delete(groupChatsTable).where(eq(groupChatsTable.id, chatId));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/:id/members", authMiddleware, requireRole(["dispatcher", "admin"]), async (req: AuthRequest, res) => {
  try {
    const chatId = parseInt(req.params.id);
    const { userIds } = req.body;
    if (!userIds?.length) {
      res.status(400).json({ error: "validation_error", message: "userIds required" });
      return;
    }

    await db.insert(groupChatMembersTable).values(
      userIds.map((uid: number) => ({ chatId, userId: uid, role: "member" as const }))
    ).onConflictDoNothing();

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/:id/members/:userId", authMiddleware, requireRole(["dispatcher", "admin"]), async (req: AuthRequest, res) => {
  try {
    const chatId = parseInt(req.params.id);
    const userId = parseInt(req.params.userId);

    await db.delete(groupChatMembersTable).where(
      and(eq(groupChatMembersTable.chatId, chatId), eq(groupChatMembersTable.userId, userId))
    );

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/:id/messages", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const chatId = parseInt(req.params.id);
    if (!(await isMemberOrDispatcher(req.userId!, req.userRole || "", chatId))) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    const messages = await db.select().from(groupChatMessagesTable)
      .where(eq(groupChatMessagesTable.chatId, chatId))
      .orderBy(asc(groupChatMessagesTable.createdAt))
      .limit(200);

    res.json({ messages });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/:id/messages", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const chatId = parseInt(req.params.id);
    if (!(await isMemberOrDispatcher(req.userId!, req.userRole || "", chatId))) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    const { message } = req.body;
    if (!message?.trim()) {
      res.status(400).json({ error: "validation_error", message: "Сообщение обязательно" });
      return;
    }

    const senderName = await getSenderName(req.userId!);

    const [msg] = await db.insert(groupChatMessagesTable).values({
      chatId,
      senderId: req.userId!,
      senderRole: req.userRole!,
      senderName,
      message: message.trim(),
      type: "text",
      status: "sent",
    }).returning();

    await db.update(groupChatsTable).set({ updatedAt: new Date() }).where(eq(groupChatsTable.id, chatId));

    await broadcastToChatMembers(chatId, req.userId!, {
      type: "new_group_chat_message",
      chatId,
      message: msg,
    });

    res.status(201).json(msg);
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/:id/send-photo", authMiddleware, (req, res, next) => {
  photoUpload.single("photo")(req, res, (err: any) => {
    if (err) {
      res.status(400).json({ error: "upload_error", message: err.message });
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

    const chatId = parseInt(req.params.id);
    if (!(await isMemberOrDispatcher(req.userId!, req.userRole || "", chatId))) {
      if (file?.path) { try { fs.unlinkSync(file.path); } catch {} }
      res.status(403).json({ error: "forbidden" }); return;
    }
    const [chatCheck] = await db.select({ photosEnabled: groupChatsTable.photosEnabled }).from(groupChatsTable).where(eq(groupChatsTable.id, chatId));
    if (chatCheck && !chatCheck.photosEnabled) {
      if (file?.path) { try { fs.unlinkSync(file.path); } catch {} }
      res.status(403).json({ error: "disabled", message: "Фото отключены в этом чате" });
      return;
    }

    const caption = req.body.caption?.trim() || "";
    const senderName = await getSenderName(req.userId!);
    const photoUrl = `/api/uploads/chat/${file.filename}`;
    const messageText = JSON.stringify({ photoUrl, caption });

    const [msg] = await db.insert(groupChatMessagesTable).values({
      chatId,
      senderId: req.userId!,
      senderRole: req.userRole!,
      senderName,
      message: messageText,
      type: "photo",
      status: "sent",
    }).returning();

    await db.update(groupChatsTable).set({ updatedAt: new Date() }).where(eq(groupChatsTable.id, chatId));

    await broadcastToChatMembers(chatId, req.userId!, {
      type: "new_group_chat_message",
      chatId,
      message: msg,
    });

    res.status(201).json(msg);
  } catch (err: any) {
    if (file?.path) { try { fs.unlinkSync(file.path); } catch {} }
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/:id/send-voice", authMiddleware, (req, res, next) => {
  const voiceDir = path.resolve(process.cwd(), "artifacts", "uploads", "voice");
  fs.mkdirSync(voiceDir, { recursive: true });
  const voiceUpload = multer({
    storage: multer.diskStorage({
      destination: (_r, _f, cb) => cb(null, voiceDir),
      filename: (_r, _f, cb) => cb(null, `gc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webm`),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
  });
  voiceUpload.single("voice")(req, res, (err: any) => {
    if (err) {
      res.status(400).json({ error: "upload_error", message: err.message });
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

    const chatId = parseInt(req.params.id);
    if (!(await isMemberOrDispatcher(req.userId!, req.userRole || "", chatId))) {
      if (file?.path) { try { fs.unlinkSync(file.path); } catch {} }
      res.status(403).json({ error: "forbidden" }); return;
    }
    const [chatCheck] = await db.select({ voiceEnabled: groupChatsTable.voiceEnabled }).from(groupChatsTable).where(eq(groupChatsTable.id, chatId));
    if (chatCheck && !chatCheck.voiceEnabled) {
      if (file?.path) { try { fs.unlinkSync(file.path); } catch {} }
      res.status(403).json({ error: "disabled", message: "Голосовые сообщения отключены в этом чате" });
      return;
    }

    const duration = req.body.duration ? parseFloat(req.body.duration) : 0;
    const senderName = await getSenderName(req.userId!);
    const audioUrl = `/api/uploads/voice/${file.filename}`;
    const messageText = JSON.stringify({ audioUrl, duration: Math.round(duration) });

    const [msg] = await db.insert(groupChatMessagesTable).values({
      chatId,
      senderId: req.userId!,
      senderRole: req.userRole!,
      senderName,
      message: messageText,
      type: "voice",
      status: "sent",
    }).returning();

    await db.update(groupChatsTable).set({ updatedAt: new Date() }).where(eq(groupChatsTable.id, chatId));

    await broadcastToChatMembers(chatId, req.userId!, {
      type: "new_group_chat_message",
      chatId,
      message: msg,
    });

    res.status(201).json(msg);
  } catch {
    if (file?.path) { try { fs.unlinkSync(file.path); } catch {} }
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
