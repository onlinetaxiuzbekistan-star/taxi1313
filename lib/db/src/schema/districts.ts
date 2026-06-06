import { pgTable, text, serial, integer, real, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

export const districtsTable = pgTable("districts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  cityId: text("city_id").notNull(),
  extraCharge: numeric("extra_charge", { precision: 19, scale: 2, mode: "number" }).notNull().default(0),
  lat: real("lat"),
  lng: real("lng"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
