import {
  pgTable, serial, integer, numeric, text, timestamp, pgEnum, index
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transactionTypeEnum = pgEnum("transaction_type", [
  "income",
  "commission",
  "withdraw",
  "refund",
  "bonus",
  "penalty",
  "adjust",
]);

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id"),
  rideId: integer("ride_id"),
  type: transactionTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  balanceBefore: numeric("balance_before", { precision: 12, scale: 2 }),
  balanceAfter: numeric("balance_after", { precision: 12, scale: 2 }),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at"),
}, (t) => [
  index("transactions_driver_id_idx").on(t.driverId),
  index("transactions_ride_id_idx").on(t.rideId),
  index("transactions_type_idx").on(t.type),
  index("transactions_created_at_idx").on(t.createdAt),
  index("transactions_driver_created_idx").on(t.driverId, t.createdAt),
]);

export const insertTransactionSchema = createInsertSchema(transactionsTable)
  .omit({ id: true, createdAt: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
