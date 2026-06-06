import { Router, type IRouter } from "express";
import { db, addressesTable, addressGroupsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authMiddleware, requireRole, AuthRequest } from "../middlewares/auth.js";

const router: IRouter = Router();

router.get("/groups", async (_req, res) => {
  try {
    const groups = await db.select().from(addressGroupsTable).orderBy(addressGroupsTable.name);
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/groups", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const { name, cityId } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: "validation_error", message: "Название обязательно" }); return; }
    const [group] = await db.insert(addressGroupsTable).values({ name: name.trim(), cityId: cityId || null }).returning();
    res.status(201).json(group);
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.delete("/groups/:id", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const [g] = await db.delete(addressGroupsTable).where(eq(addressGroupsTable.id, id)).returning();
    if (!g) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.get("/", async (req, res) => {
  try {
    const addresses = await db.select().from(addressesTable).orderBy(addressesTable.name);
    res.json({ addresses });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const { name, groupId, cityId, lat, lng, extraPrice } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: "validation_error", message: "Название обязательно" }); return; }
    const [addr] = await db.insert(addressesTable).values({
      name: name.trim(), groupId: groupId || null, cityId: cityId || null,
      lat: lat || null, lng: lng || null, extraPrice: extraPrice || 0,
    }).returning();
    res.status(201).json(addr);
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.patch("/:id", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, groupId, cityId, lat, lng, extraPrice, isActive } = req.body;
    const upd: any = {};
    if (name !== undefined) upd.name = name.trim();
    if (groupId !== undefined) upd.groupId = groupId;
    if (cityId !== undefined) upd.cityId = cityId;
    if (lat !== undefined) upd.lat = lat;
    if (lng !== undefined) upd.lng = lng;
    if (extraPrice !== undefined) upd.extraPrice = extraPrice;
    if (isActive !== undefined) upd.isActive = isActive;
    const [addr] = await db.update(addressesTable).set(upd).where(eq(addressesTable.id, id)).returning();
    if (!addr) { res.status(404).json({ error: "not_found" }); return; }
    res.json(addr);
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.delete("/:id", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const [addr] = await db.delete(addressesTable).where(eq(addressesTable.id, id)).returning();
    if (!addr) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
