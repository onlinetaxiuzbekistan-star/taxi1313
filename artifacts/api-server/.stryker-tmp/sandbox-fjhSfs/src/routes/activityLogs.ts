// @ts-nocheck
import { Router, type IRouter } from "express";
import { db, activityLogsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { authMiddleware, requireRole, AuthRequest } from "../middlewares/auth.js";

const router: IRouter = Router();

router.get("/", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const logs = await db.select().from(activityLogsTable)
      .orderBy(desc(activityLogsTable.createdAt))
      .limit(limit);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
