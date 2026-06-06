import { Router } from "express";
import { db, blockedAppsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { authMiddleware, requireRole, AuthRequest } from "../middlewares/auth.js";

const router = Router();

router.get("/", authMiddleware, async (_req, res) => {
  try {
    const apps = await db.select().from(blockedAppsTable).orderBy(desc(blockedAppsTable.createdAt));
    res.json({ apps });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/", authMiddleware, requireRole("admin", "dispatcher"), async (req: AuthRequest, res) => {
  try {
    const { name, packageName, urlScheme } = req.body || {};
    if (!name || typeof name !== "string" || !packageName || typeof packageName !== "string") {
      res.status(400).json({ error: "validation_error", message: "Название и пакетное имя обязательны" });
      return;
    }
    const [app] = await db.insert(blockedAppsTable).values({
      name: name.trim(),
      packageName: packageName.trim(),
      urlScheme: typeof urlScheme === "string" ? urlScheme.trim() || null : null,
      enabled: true,
    }).returning();
    res.json({ app });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.patch("/:id", authMiddleware, requireRole("admin", "dispatcher"), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "validation_error", message: "Некорректный ID" });
      return;
    }
    const updates: Record<string, any> = {};
    if (req.body.name !== undefined && typeof req.body.name === "string") updates.name = req.body.name.trim();
    if (req.body.packageName !== undefined && typeof req.body.packageName === "string") updates.packageName = req.body.packageName.trim();
    if (req.body.urlScheme !== undefined) updates.urlScheme = typeof req.body.urlScheme === "string" ? req.body.urlScheme.trim() || null : null;
    if (req.body.enabled !== undefined) updates.enabled = Boolean(req.body.enabled);
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "validation_error", message: "Нечего обновлять" });
      return;
    }
    const [app] = await db.update(blockedAppsTable).set(updates).where(eq(blockedAppsTable.id, id)).returning();
    if (!app) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ app });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/:id", authMiddleware, requireRole("admin", "dispatcher"), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [app] = await db.delete(blockedAppsTable).where(eq(blockedAppsTable.id, id)).returning();
    if (!app) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
