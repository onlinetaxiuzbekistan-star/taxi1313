import { pgTable, text, serial, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tariffsTable = pgTable("tariffs", {
  id: serial("id").primaryKey(),
  carClass: text("car_class").notNull().unique(),
  baseRate: numeric("base_rate", { precision: 19, scale: 2, mode: "number" }).notNull(),
  perKmRate: numeric("per_km_rate", { precision: 19, scale: 2, mode: "number" }).notNull(),
  intercityFee: numeric("intercity_fee", { precision: 19, scale: 2, mode: "number" }).notNull(),
  minPrice: integer("min_price").notNull(),
});

export const insertTariffSchema = createInsertSchema(tariffsTable).omit({ id: true });
export type InsertTariff = z.infer<typeof insertTariffSchema>;
export type Tariff = typeof tariffsTable.$inferSelect;
