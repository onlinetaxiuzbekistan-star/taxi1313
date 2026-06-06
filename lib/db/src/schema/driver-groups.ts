import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const driverGroupsTable = pgTable("driver_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  label: text("label").notNull(),
  level: integer("level").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDriverGroupSchema = createInsertSchema(driverGroupsTable)
  .omit({ id: true, createdAt: true });
export type InsertDriverGroup = z.infer<typeof insertDriverGroupSchema>;
export type DriverGroup = typeof driverGroupsTable.$inferSelect;
