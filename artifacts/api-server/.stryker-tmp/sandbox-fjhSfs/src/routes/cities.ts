// @ts-nocheck
import { Router, type IRouter } from "express";
import { validateBody } from "../middlewares/validate.js";
import { cityCreateBodySchema, adminUpdateBodySchema } from "../middlewares/request-schemas.js";
import { db, citiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authMiddleware, requireRole, AuthRequest } from "../middlewares/auth.js";
import { logActivity } from "../lib/activity.js";

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  try {
    const cities = await db.select().from(citiesTable).orderBy(citiesTable.nameRu);
    res.json({ cities });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/", authMiddleware, requireRole("dispatcher", "admin"), validateBody(cityCreateBodySchema), async (req: AuthRequest, res) => {
  try {
    const { nameRu, nameUz, slug, branchId, lat, lng } = req.body;
    if (!nameRu?.trim()) {
      res.status(400).json({ error: "validation_error", message: "Название обязательно" });
      return;
    }
    const autoSlug = slug || nameRu.trim().toLowerCase().replace(/\s+/g, "-");
    const [city] = await db.insert(citiesTable).values({
      nameRu: nameRu.trim(), nameUz: nameUz || null, slug: autoSlug,
      branchId: branchId || null, lat: lat || null, lng: lng || null,
    }).returning();
    await logActivity(req.userId!, "", "create", "city", city.id, `Добавлен город: ${city.nameRu}`);
    res.status(201).json(city);
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.patch("/:id", authMiddleware, requireRole("dispatcher", "admin"), validateBody(adminUpdateBodySchema), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const { nameRu, nameUz, branchId, lat, lng, isActive } = req.body;
    const upd: any = { updatedAt: new Date() };
    if (nameRu !== undefined) upd.nameRu = nameRu.trim();
    if (nameUz !== undefined) upd.nameUz = nameUz;
    if (branchId !== undefined) upd.branchId = branchId;
    if (lat !== undefined) upd.lat = lat;
    if (lng !== undefined) upd.lng = lng;
    if (isActive !== undefined) upd.isActive = isActive;
    const [city] = await db.update(citiesTable).set(upd).where(eq(citiesTable.id, id)).returning();
    if (!city) { res.status(404).json({ error: "not_found" }); return; }
    await logActivity(req.userId!, "", "update", "city", id, `Обновлён город: ${city.nameRu}`);
    res.json(city);
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.delete("/:id", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const [city] = await db.delete(citiesTable).where(eq(citiesTable.id, id)).returning();
    if (!city) { res.status(404).json({ error: "not_found" }); return; }
    await logActivity(req.userId!, "", "delete", "city", id, `Удалён город: ${city.nameRu}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
