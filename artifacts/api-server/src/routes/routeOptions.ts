import { Router, type IRouter } from "express";
import { db, routeOptionsTable, routesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { authMiddleware, requireRole, AuthRequest } from "../middlewares/auth.js";
import { z } from "zod";
import { validateBody } from "../middlewares/validate.js";

const createRouteOptionBodySchema = z.object({
  routeId: z.union([z.number(), z.string()]),
  tariffClass: z.string(),
  optionKey: z.string(),
  label: z.string(),
}).passthrough();
const updateRouteOptionBodySchema = z.object({}).passthrough();

const router: IRouter = Router();

const TARIFF_CLASSES = ["economy", "comfort", "business"] as const;

router.get("/", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const routeIdQ = req.query.routeId;
    const wherePart = routeIdQ ? eq(routeOptionsTable.routeId, parseInt(String(routeIdQ))) : undefined;
    const opts = await db.select().from(routeOptionsTable).where(wherePart as any).orderBy(
      asc(routeOptionsTable.routeId),
      asc(routeOptionsTable.tariffClass),
      asc(routeOptionsTable.sortOrder)
    );
    res.json({ options: opts });
  } catch (err: any) {
    req.log.error({ err }, "Get route options error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/", authMiddleware, requireRole("dispatcher", "admin"), validateBody(createRouteOptionBodySchema), async (req: AuthRequest, res) => {
  try {
    const { routeId, tariffClass, optionKey, label, price, commission, sortOrder, isActive } = req.body;
    if (!routeId || !tariffClass || !optionKey || !label) {
      res.status(400).json({ error: "validation_error", message: "Заполните routeId, tariffClass, optionKey, label" });
      return;
    }
    if (!TARIFF_CLASSES.includes(tariffClass)) {
      res.status(400).json({ error: "validation_error", message: `tariffClass должен быть одним из ${TARIFF_CLASSES.join(", ")}` });
      return;
    }
    const [route] = await db.select().from(routesTable).where(eq(routesTable.id, Number(routeId)));
    if (!route) {
      res.status(404).json({ error: "not_found", message: "Маршрут не найден" });
      return;
    }
    const [created] = await db.insert(routeOptionsTable).values({
      routeId: Number(routeId),
      tariffClass,
      optionKey: String(optionKey).trim(),
      label: String(label).trim(),
      price: Number(price) || 0,
      commission: Number(commission) || 0,
      sortOrder: Number(sortOrder) || 0,
      isActive: isActive !== false,
    }).returning();
    req.log.info({ id: created.id }, "Route option created");
    res.status(201).json(created);
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "duplicate", message: "Опция с таким ключом уже существует для этого маршрута и тарифа" });
      return;
    }
    req.log.error({ err }, "Create route option error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.patch("/:id", authMiddleware, requireRole("dispatcher", "admin"), validateBody(updateRouteOptionBodySchema), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const { label, price, commission, sortOrder, isActive } = req.body;
    const updateData: Record<string, any> = {};
    if (label !== undefined) updateData.label = String(label).trim();
    if (price !== undefined) updateData.price = Number(price) || 0;
    if (commission !== undefined) updateData.commission = Number(commission) || 0;
    if (sortOrder !== undefined) updateData.sortOrder = Number(sortOrder) || 0;
    if (isActive !== undefined) updateData.isActive = isActive !== false;
    const [updated] = await db.update(routeOptionsTable).set(updateData).where(eq(routeOptionsTable.id, id)).returning();
    if (!updated) {
      res.status(404).json({ error: "not_found", message: "Опция не найдена" });
      return;
    }
    req.log.info({ id }, "Route option updated");
    res.json(updated);
  } catch (err: any) {
    req.log.error({ err }, "Update route option error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.delete("/:id", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(routeOptionsTable).where(eq(routeOptionsTable.id, id));
    req.log.info({ id }, "Route option deleted");
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "Delete route option error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
