import { Router, type IRouter } from "express";
import { validateBody } from "../middlewares/validate.js";
import { districtCreateBodySchema, adminUpdateBodySchema } from "../middlewares/request-schemas.js";
import { db, districtsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authMiddleware, requireRole, AuthRequest } from "../middlewares/auth.js";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  try {
    const { cityId } = req.query as Record<string, string>;
    let query = db.select().from(districtsTable).$dynamic();
    if (cityId) {
      query = query.where(eq(districtsTable.cityId, cityId));
    }
    const districts = await query.orderBy(districtsTable.name);
    res.json({ districts });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/", authMiddleware, requireRole("dispatcher", "admin"), validateBody(districtCreateBodySchema), async (req: AuthRequest, res) => {
  try {
    const { name, cityId, extraCharge, lat, lng } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: "validation_error", message: "Название обязательно" }); return; }
    if (!cityId) { res.status(400).json({ error: "validation_error", message: "Город обязателен" }); return; }
    const [district] = await db.insert(districtsTable).values({
      name: name.trim(), cityId, extraCharge: extraCharge || 0,
      lat: lat || null, lng: lng || null,
    }).returning();
    res.status(201).json(district);
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.patch("/:id", authMiddleware, requireRole("dispatcher", "admin"), validateBody(adminUpdateBodySchema), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, cityId, extraCharge, lat, lng, isActive } = req.body;
    const upd: any = {};
    if (name !== undefined) upd.name = name.trim();
    if (cityId !== undefined) upd.cityId = cityId;
    if (extraCharge !== undefined) upd.extraCharge = extraCharge;
    if (lat !== undefined) upd.lat = lat;
    if (lng !== undefined) upd.lng = lng;
    if (isActive !== undefined) upd.isActive = isActive;
    const [district] = await db.update(districtsTable).set(upd).where(eq(districtsTable.id, id)).returning();
    if (!district) { res.status(404).json({ error: "not_found" }); return; }
    res.json(district);
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.delete("/:id", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const [district] = await db.delete(districtsTable).where(eq(districtsTable.id, id)).returning();
    if (!district) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
