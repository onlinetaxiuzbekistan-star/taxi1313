import { pgTable, text, serial, integer, real, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

export const addressGroupsTable = pgTable("address_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  cityId: integer("city_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const addressesTable = pgTable("addresses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  groupId: integer("group_id"),
  cityId: integer("city_id"),
  lat: real("lat"),
  lng: real("lng"),
  extraPrice: numeric("extra_price", { precision: 19, scale: 2, mode: "number" }).notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
