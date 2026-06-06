import { z } from "zod";
import { Router, type IRouter } from "express";
import { validateBody } from "../middlewares/validate.js";
import { db, messagesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { authMiddleware, AuthRequest } from "../middlewares/auth.js";
import { broadcastToAll } from "../lib/websocket.js";

const messageCreateBodySchema = z.object({
  message: z.string(),
}).passthrough();

const router: IRouter = Router();

router.get("/:rideId/messages", async (req, res) => {
  try {
    const messages = await db.select().from(messagesTable)
      .where(eq(messagesTable.rideId, parseInt(req.params.rideId)))
      .orderBy(asc(messagesTable.createdAt));
    res.json({ messages });
  } catch (err) {
    req.log.error({ err }, "Get messages error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/:rideId/messages", authMiddleware, validateBody(messageCreateBodySchema), async (req: AuthRequest, res) => {
  try {
    const { message } = req.body;
    const rideId = parseInt(req.params.rideId);

    const [msg] = await db.insert(messagesTable).values({
      rideId,
      senderId: req.userId!,
      senderRole: req.userRole!,
      message,
    }).returning();

    broadcastToAll({ type: "new_message", message: msg });
    res.status(201).json(msg);
  } catch (err) {
    req.log.error({ err }, "Send message error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
