// @ts-nocheck
import { Router, type IRouter } from "express";
import { db, routesTable, routeOptionsTable } from "@workspace/db";
import { eq, asc, desc, and, sql, max, or } from "drizzle-orm";
import { authMiddleware, requireRole, AuthRequest } from "../middlewares/auth.js";
import { z } from "zod";
import { validateBody } from "../middlewares/validate.js";

const createRouteBodySchema = z.object({
  fromCity: z.string(),
  toCity: z.string(),
  distanceKm: z.union([z.number(), z.string()]),
  durationMin: z.union([z.number(), z.string()]),
}).passthrough();
const updateRouteBodySchema = z.object({}).passthrough();

const router: IRouter = Router();

const TARIFF_CLASSES = ["economy", "comfort", "business"] as const;

const DEFAULT_OPTIONS = [
  { key: "trunk_small", label: "Малый багаж", price: 10000, sort: 1 },
  { key: "trunk_large", label: "Большой багаж", price: 20000, sort: 2 },
  { key: "roof", label: "Верхний багажник", price: 30000, sort: 3 },
  { key: "parcel_s", label: "Посылка маленькая", price: 15000, sort: 4 },
  { key: "parcel_m", label: "Посылка средняя", price: 25000, sort: 5 },
  { key: "parcel_l", label: "Посылка большая", price: 40000, sort: 6 },
];

function groupOptionsByTariff(options: any[]) {
  const tariffs: Record<string, any[]> = { economy: [], comfort: [], business: [] };
  for (const opt of options) {
    const tc = opt.tariffClass || "economy";
    if (!tariffs[tc]) tariffs[tc] = [];
    tariffs[tc].push(opt);
  }
  return tariffs;
}

router.get("/", async (req, res) => {
  try {
    const cityFilter = typeof req.query.city === 'string' && req.query.city.trim()
      ? req.query.city.trim()
      : null;
    const whereClause = cityFilter
      ? or(eq(routesTable.fromCity, cityFilter), eq(routesTable.toCity, cityFilter))
      : undefined;
    const routes = await db.select().from(routesTable).where(whereClause as any).orderBy(
      sql`CASE WHEN ${routesTable.sortOrder} = 0 THEN 9999 ELSE ${routesTable.sortOrder} END`,
      asc(routesTable.id)
    );
    const allOptions = await db.select().from(routeOptionsTable).orderBy(asc(routeOptionsTable.sortOrder));
    const optionsByRoute: Record<number, typeof allOptions> = {};
    for (const opt of allOptions) {
      if (!optionsByRoute[opt.routeId]) optionsByRoute[opt.routeId] = [];
      optionsByRoute[opt.routeId].push(opt);
    }
    const routesWithOptions = routes.map(r => ({
      ...r,
      options: optionsByRoute[r.id] || [],
      tariffOptions: groupOptionsByTariff(optionsByRoute[r.id] || []),
    }));
    res.json({ routes: routesWithOptions });
  } catch (err) {
    req.log.error({ err }, "Get routes error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const [route] = await db.select().from(routesTable).where(eq(routesTable.id, parseInt(req.params.id)));
    if (!route) {
      res.status(404).json({ error: "not_found", message: "Направление не найдено" });
      return;
    }
    const options = await db.select().from(routeOptionsTable)
      .where(eq(routeOptionsTable.routeId, route.id))
      .orderBy(asc(routeOptionsTable.sortOrder));
    res.json({ ...route, options, tariffOptions: groupOptionsByTariff(options) });
  } catch (err) {
    req.log.error({ err }, "Get route error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/", authMiddleware, requireRole("dispatcher", "admin"), validateBody(createRouteBodySchema), async (req: AuthRequest, res) => {
  try {
    const { fromCity, toCity, distanceKm, durationMin, priceEconomy, priceComfort, priceBusiness, priceMail, priceFrontEconomy, priceFrontComfort, priceFrontBusiness, roundTripDiscountPercent, isActive, sortOrder } = req.body;

    if (!fromCity || !toCity) {
      res.status(400).json({ error: "validation_error", message: "Укажите города отправления и назначения" });
      return;
    }
    if (!distanceKm || distanceKm <= 0) {
      res.status(400).json({ error: "validation_error", message: "Укажите корректное расстояние" });
      return;
    }
    if (!durationMin || durationMin <= 0) {
      res.status(400).json({ error: "validation_error", message: "Укажите корректное время в пути" });
      return;
    }

    let finalSortOrder = 0;
    if (sortOrder !== undefined && sortOrder !== null && sortOrder !== "") {
      finalSortOrder = parseInt(sortOrder);
    } else {
      const [maxRow] = await db.select({ maxSort: max(routesTable.sortOrder) }).from(routesTable);
      finalSortOrder = (maxRow?.maxSort ?? 0) + 1;
    }

    const backEconomy = parseFloat(priceEconomy || "0");
    const backComfort = parseFloat(priceComfort || "0");
    const backBusiness = parseFloat(priceBusiness || "0");

    const [route] = await db.insert(routesTable).values({
      fromCity,
      toCity,
      distanceKm: parseFloat(distanceKm),
      durationMin: parseInt(durationMin),
      priceEconomy: backEconomy,
      priceComfort: backComfort,
      priceBusiness: backBusiness,
      priceFrontEconomy: parseFloat(priceFrontEconomy || "0") || backEconomy,
      priceFrontComfort: parseFloat(priceFrontComfort || "0") || backComfort,
      priceFrontBusiness: parseFloat(priceFrontBusiness || "0") || backBusiness,
      priceMail: parseFloat(priceMail || "0"),
      roundTripDiscountPercent: parseFloat(roundTripDiscountPercent ?? "10"),
      sortOrder: finalSortOrder,
      isActive: isActive !== false,
    }).returning();

    for (const tc of TARIFF_CLASSES) {
      for (const opt of DEFAULT_OPTIONS) {
        await db.insert(routeOptionsTable).values({
          routeId: route.id,
          tariffClass: tc,
          optionKey: opt.key,
          label: opt.label,
          price: opt.price,
          sortOrder: opt.sort,
        });
      }
    }

    const options = await db.select().from(routeOptionsTable).where(eq(routeOptionsTable.routeId, route.id)).orderBy(asc(routeOptionsTable.sortOrder));

    req.log.info({ routeId: route.id }, "Route created");
    res.status(201).json({ ...route, options, tariffOptions: groupOptionsByTariff(options) });
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "duplicate", message: "Такое направление уже существует" });
      return;
    }
    req.log.error({ err }, "Create route error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.patch("/:id", authMiddleware, requireRole("dispatcher", "admin"), validateBody(updateRouteBodySchema), async (req: AuthRequest, res) => {
  try {
    const routeId = parseInt(req.params.id);
    const { fromCity, toCity, distanceKm, durationMin, priceEconomy, priceComfort, priceBusiness, priceMail, priceFrontEconomy, priceFrontComfort, priceFrontBusiness, roundTripDiscountPercent, isActive, sortOrder, options, tariffOptions } = req.body;

    const [existing] = await db.select().from(routesTable).where(eq(routesTable.id, routeId));
    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Направление не найдено" });
      return;
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (fromCity !== undefined) updateData.fromCity = fromCity;
    if (toCity !== undefined) updateData.toCity = toCity;
    if (distanceKm !== undefined) updateData.distanceKm = parseFloat(distanceKm);
    if (durationMin !== undefined) updateData.durationMin = parseInt(durationMin);
    if (priceEconomy !== undefined) updateData.priceEconomy = parseFloat(priceEconomy);
    if (priceComfort !== undefined) updateData.priceComfort = parseFloat(priceComfort);
    if (priceBusiness !== undefined) updateData.priceBusiness = parseFloat(priceBusiness);
    if (priceFrontEconomy !== undefined) updateData.priceFrontEconomy = parseFloat(priceFrontEconomy);
    if (priceFrontComfort !== undefined) updateData.priceFrontComfort = parseFloat(priceFrontComfort);
    if (priceFrontBusiness !== undefined) updateData.priceFrontBusiness = parseFloat(priceFrontBusiness);
    if (priceMail !== undefined) updateData.priceMail = parseFloat(priceMail);
    if (roundTripDiscountPercent !== undefined) updateData.roundTripDiscountPercent = parseFloat(roundTripDiscountPercent);
    if (sortOrder !== undefined) updateData.sortOrder = parseInt(sortOrder);
    if (isActive !== undefined) updateData.isActive = isActive;

    const [route] = await db.update(routesTable).set(updateData).where(eq(routesTable.id, routeId)).returning();

    if (tariffOptions && typeof tariffOptions === "object") {
      for (const [tc, opts] of Object.entries(tariffOptions)) {
        if (!Array.isArray(opts)) continue;
        for (const opt of opts as any[]) {
          if (opt.id) {
            await db.update(routeOptionsTable).set({
              label: opt.label,
              price: parseFloat(opt.price),
              isActive: opt.isActive !== false,
            }).where(eq(routeOptionsTable.id, opt.id));
          }
        }
      }
    } else if (Array.isArray(options)) {
      for (const opt of options) {
        if (opt.id) {
          await db.update(routeOptionsTable).set({
            label: opt.label,
            price: parseFloat(opt.price),
            isActive: opt.isActive !== false,
          }).where(eq(routeOptionsTable.id, opt.id));
        }
      }
    }

    const routeOptions = await db.select().from(routeOptionsTable)
      .where(eq(routeOptionsTable.routeId, routeId))
      .orderBy(asc(routeOptionsTable.sortOrder));

    req.log.info({ routeId }, "Route updated");
    res.json({ ...route, options: routeOptions, tariffOptions: groupOptionsByTariff(routeOptions) });
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "duplicate", message: "Такое направление уже существует" });
      return;
    }
    req.log.error({ err }, "Update route error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.delete("/:id", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    const routeId = parseInt(req.params.id);
    const [existing] = await db.select().from(routesTable).where(eq(routesTable.id, routeId));
    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Направление не найдено" });
      return;
    }

    await db.delete(routeOptionsTable).where(eq(routeOptionsTable.routeId, routeId));
    await db.delete(routesTable).where(eq(routesTable.id, routeId));
    req.log.info({ routeId }, "Route deleted");
    res.json({ success: true, message: "Направление удалено" });
  } catch (err) {
    req.log.error({ err }, "Delete route error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
