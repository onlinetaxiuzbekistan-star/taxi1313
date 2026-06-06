import { pgTable, text, serial, integer, real, boolean, timestamp } from "drizzle-orm/pg-core";

export const citiesTable = pgTable("cities", {
  id: serial("id").primaryKey(),
  nameRu: text("name_ru").notNull(),
  nameUz: text("name_uz"),
  slug: text("slug"),
  branchId: integer("branch_id"),
  lat: real("lat"),
  lng: real("lng"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
