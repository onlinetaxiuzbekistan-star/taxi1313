import { z } from "zod";
import { Router, type IRouter } from "express";
import { validateBody } from "../middlewares/validate.js";
import { authMiddleware, AuthRequest } from "../middlewares/auth.js";
import { broadcastToAll } from "../lib/websocket.js";
import * as chatService from "../lib/services/chat.service.js";

const messageCreateBodySchema = z.object({
  message: z.string(),
}).passthrough();

const router: IRouter = Router();

router.get("/:rideId/messages", async (req, res) => {
  try {
    const messages = await chatService.getRideMessagesOrdered(parseInt(req.params.rideId));
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

    const msg = await chatService.insertMessage({
      rideId,
      senderId: req.userId!,
      senderRole: req.userRole!,
      message,
    });

    broadcastToAll({ type: "new_message", message: msg });
    res.status(201).json(msg);
  } catch (err) {
    req.log.error({ err }, "Send message error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
