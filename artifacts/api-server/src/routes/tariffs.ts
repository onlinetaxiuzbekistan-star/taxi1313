import { Router, type IRouter } from "express";
import { validateBody } from "../middlewares/validate.js";
import { tariffCreateBodySchema, adminUpdateBodySchema } from "../middlewares/request-schemas.js";
import { db, tariffsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authMiddleware, requireRole, AuthRequest } from "../middlewares/auth.js";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  try {
    const tariffs = await db.select().from(tariffsTable);
    res.json({ tariffs });
  } catch (err) {
    req.log.error({ err }, "Get tariffs error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/", authMiddleware, requireRole("dispatcher"), validateBody(tariffCreateBodySchema), async (req: AuthRequest, res) => {
  try {
    const { carClass, baseRate, perKmRate, intercityFee, minPrice } = req.body;
    if (!carClass || baseRate == null || perKmRate == null || intercityFee == null || minPrice == null) {
      res.status(400).json({ error: "validation_error", message: "All fields are required" });
      return;
    }
    const numBase = Number(baseRate), numKm = Number(perKmRate), numFee = Number(intercityFee), numMin = Number(minPrice);
    if ([numBase, numKm, numFee, numMin].some(v => !Number.isFinite(v) || v < 0)) {
      res.status(400).json({ error: "validation_error", message: "All numeric values must be non-negative numbers" });
      return;
    }
    const [tariff] = await db.insert(tariffsTable).values({
      carClass, baseRate: numBase, perKmRate: numKm, intercityFee: numFee, minPrice: numMin,
    }).returning();
    res.status(201).json(tariff);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "duplicate", message: "Тариф для этого класса уже существует" });
      return;
    }
    req.log.error({ err }, "Create tariff error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.patch("/:id", authMiddleware, requireRole("dispatcher"), validateBody(adminUpdateBodySchema), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "validation_error", message: "Invalid tariff ID" });
      return;
    }
    const { baseRate, perKmRate, intercityFee, minPrice } = req.body;
    const updateData: any = {};
    if (baseRate !== undefined) {
      const v = Number(baseRate);
      if (!Number.isFinite(v) || v < 0) { res.status(400).json({ error: "validation_error", message: "baseRate must be non-negative" }); return; }
      updateData.baseRate = v;
    }
    if (perKmRate !== undefined) {
      const v = Number(perKmRate);
      if (!Number.isFinite(v) || v < 0) { res.status(400).json({ error: "validation_error", message: "perKmRate must be non-negative" }); return; }
      updateData.perKmRate = v;
    }
    if (intercityFee !== undefined) {
      const v = Number(intercityFee);
      if (!Number.isFinite(v) || v < 0) { res.status(400).json({ error: "validation_error", message: "intercityFee must be non-negative" }); return; }
      updateData.intercityFee = v;
    }
    if (minPrice !== undefined) {
      const v = Number(minPrice);
      if (!Number.isFinite(v) || v < 0) { res.status(400).json({ error: "validation_error", message: "minPrice must be non-negative" }); return; }
      updateData.minPrice = v;
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: "validation_error", message: "No fields to update" });
      return;
    }

    const [tariff] = await db.update(tariffsTable).set(updateData).where(eq(tariffsTable.id, id)).returning();
    if (!tariff) {
      res.status(404).json({ error: "not_found", message: "Tariff not found" });
      return;
    }
    res.json(tariff);
  } catch (err) {
    req.log.error({ err }, "Update tariff error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.delete("/:id", authMiddleware, requireRole("dispatcher"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const [tariff] = await db.delete(tariffsTable).where(eq(tariffsTable.id, id)).returning();
    if (!tariff) {
      res.status(404).json({ error: "not_found", message: "Tariff not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete tariff error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
