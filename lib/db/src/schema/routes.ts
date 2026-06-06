import { pgTable, text, serial, real, numeric, integer, boolean, timestamp, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const routesTable = pgTable("routes", {
  id: serial("id").primaryKey(),
  fromCity: text("from_city").notNull(),
  toCity: text("to_city").notNull(),
  distanceKm: real("distance_km").notNull(),
  durationMin: integer("duration_min").notNull(),
  priceEconomy: numeric("price_economy", { precision: 19, scale: 2, mode: "number" }).notNull().default(0),
  priceComfort: numeric("price_comfort", { precision: 19, scale: 2, mode: "number" }).notNull().default(0),
  priceBusiness: numeric("price_business", { precision: 19, scale: 2, mode: "number" }).notNull().default(0),
  priceMail: numeric("price_mail", { precision: 19, scale: 2, mode: "number" }).notNull().default(0),
  priceFrontEconomy: numeric("price_front_economy", { precision: 19, scale: 2, mode: "number" }).notNull().default(0),
  priceFrontComfort: numeric("price_front_comfort", { precision: 19, scale: 2, mode: "number" }).notNull().default(0),
  priceFrontBusiness: numeric("price_front_business", { precision: 19, scale: 2, mode: "number" }).notNull().default(0),
  roundTripDiscountPercent: real("round_trip_discount_percent").notNull().default(10),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("routes_from_to_unique").on(t.fromCity, t.toCity),
  index("routes_from_city_idx").on(t.fromCity),
  index("routes_to_city_idx").on(t.toCity),
  index("routes_active_idx").on(t.isActive),
]);

export const insertRouteSchema = createInsertSchema(routesTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRoute = z.infer<typeof insertRouteSchema>;
export type Route = typeof routesTable.$inferSelect;

export const routeOptionsTable = pgTable("route_options", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull(),
  tariffClass: text("tariff_class").notNull().default("economy"),
  optionKey: text("option_key").notNull(),
  label: text("label").notNull(),
  price: numeric("price", { precision: 19, scale: 2, mode: "number" }).notNull().default(0),
  commission: numeric("commission", { precision: 19, scale: 2, mode: "number" }).notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("route_options_route_idx").on(t.routeId),
  index("route_options_tariff_idx").on(t.routeId, t.tariffClass),
  unique("route_options_route_tariff_key_unique").on(t.routeId, t.tariffClass, t.optionKey),
]);

export type RouteOption = typeof routeOptionsTable.$inferSelect;
