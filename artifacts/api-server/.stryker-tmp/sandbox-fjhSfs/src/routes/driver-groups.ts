// @ts-nocheck
import { z } from "zod";
import { Router } from "express";
import { validateBody } from "../middlewares/validate.js";
import { db, driverGroupsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { authMiddleware, requireRole } from "../middlewares/auth.js";
import type { AuthRequest } from "../middlewares/auth.js";

const driverGroupCreateBodySchema = z.object({
  name: z.string(),
  label: z.string(),
  level: z.union([z.number(), z.string()]),
}).passthrough();

const driverGroupUpdateBodySchema = z.object({}).passthrough();

const router = Router();

router.get("/", authMiddleware, async (_req, res) => {
  try {
    const groups = await db.select().from(driverGroupsTable).orderBy(asc(driverGroupsTable.level));
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/", authMiddleware, requireRole("admin"), validateBody(driverGroupCreateBodySchema), async (req: AuthRequest, res) => {
  try {
    const { name, label, level, isActive } = req.body;
    if (!name || !label || level == null) {
      return res.status(400).json({ error: "name, label, level required" });
    }
    const [group] = await db.insert(driverGroupsTable).values({
      name,
      label,
      level: parseInt(level),
      isActive: isActive !== false,
    }).returning();
    res.json({ group });
  } catch (err: any) {
    if (err?.constraint) {
      return res.status(409).json({ error: "duplicate_name" });
    }
    res.status(500).json({ error: "server_error" });
  }
});

router.patch("/:id", authMiddleware, requireRole("admin", "dispatcher"), validateBody(driverGroupUpdateBodySchema), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "invalid_id" });
    const { name, label, level, isActive } = req.body;
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (label !== undefined) updates.label = label;
    if (level !== undefined) updates.level = parseInt(level);
    if (isActive !== undefined) updates.isActive = isActive;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "no_updates" });
    const [updated] = await db.update(driverGroupsTable).set(updates).where(eq(driverGroupsTable.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "not_found" });
    res.json({ group: updated });
  } catch (err: any) {
    if (err?.constraint) {
      return res.status(409).json({ error: "duplicate_name" });
    }
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "invalid_id" });
    const [deleted] = await db.delete(driverGroupsTable).where(eq(driverGroupsTable.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: "not_found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
