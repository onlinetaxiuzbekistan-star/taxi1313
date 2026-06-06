// @ts-nocheck
import { Router, type IRouter } from "express";
import { validateBody } from "../middlewares/validate.js";
import { branchCreateBodySchema, adminUpdateBodySchema } from "../middlewares/request-schemas.js";
import { db, branchesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authMiddleware, requireRole, AuthRequest } from "../middlewares/auth.js";
import { logActivity } from "../lib/activity.js";

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  try {
    const branches = await db.select().from(branchesTable).orderBy(branchesTable.name);
    res.json({ branches });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/", authMiddleware, requireRole("dispatcher", "admin"), validateBody(branchCreateBodySchema), async (req: AuthRequest, res) => {
  try {
    const { name, address, phone } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ error: "validation_error", message: "Название обязательно" });
      return;
    }
    const [branch] = await db.insert(branchesTable).values({
      name: name.trim(), address: address || null, phone: phone || null,
    }).returning();
    await logActivity(req.userId!, "", "create", "branch", branch.id, `Создан филиал: ${branch.name}`);
    res.status(201).json(branch);
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.patch("/:id", authMiddleware, requireRole("dispatcher", "admin"), validateBody(adminUpdateBodySchema), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, address, phone, isActive } = req.body;
    const upd: any = { updatedAt: new Date() };
    if (name !== undefined) upd.name = name.trim();
    if (address !== undefined) upd.address = address;
    if (phone !== undefined) upd.phone = phone;
    if (isActive !== undefined) upd.isActive = isActive;
    const [branch] = await db.update(branchesTable).set(upd).where(eq(branchesTable.id, id)).returning();
    if (!branch) { res.status(404).json({ error: "not_found" }); return; }
    await logActivity(req.userId!, "", "update", "branch", id, `Обновлён филиал: ${branch.name}`);
    res.json(branch);
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.delete("/:id", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const [branch] = await db.delete(branchesTable).where(eq(branchesTable.id, id)).returning();
    if (!branch) { res.status(404).json({ error: "not_found" }); return; }
    await logActivity(req.userId!, "", "delete", "branch", id, `Удалён филиал: ${branch.name}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
