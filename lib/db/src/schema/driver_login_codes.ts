import { pgTable, serial, integer, varchar, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const driverLoginCodesTable = pgTable("driver_login_codes", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id").notNull(),
  codeHash: varchar("code_hash", { length: 128 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at").notNull(),
  isUsed: boolean("is_used").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("driver_login_codes_driver_idx").on(t.driverId),
]);

export type DriverLoginCode = typeof driverLoginCodesTable.$inferSelect;
