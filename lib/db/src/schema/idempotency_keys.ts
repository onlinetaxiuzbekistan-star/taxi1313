import { pgTable, text, serial, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const idempotencyKeysTable = pgTable("idempotency_keys", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  driverId: integer("driver_id").notNull(),
  action: text("action").notNull(),
  status: integer("status").notNull(),
  response: jsonb("response").notNull(),
  rideVersion: integer("ride_version"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_idempotency_key").on(table.key),
  index("idx_idempotency_created").on(table.createdAt),
]);
