import { pgTable, serial, integer, numeric, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const paymentStatusEnum   = pgEnum("payment_status",   ["pending", "success", "failed", "cancelled"]);
export const paymentProviderEnum = pgEnum("payment_provider", ["uzcard", "humo", "click", "payme", "paynet", "cash"]);

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id").notNull(),   // → users.id
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  status: paymentStatusEnum("status").notNull().default("pending"),
  provider: paymentProviderEnum("provider").notNull(),
  externalId: text("external_id"),           // payment gateway transaction ID
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("payments_driver_id_idx").on(t.driverId),
  index("payments_status_idx").on(t.status),
  index("payments_created_at_idx").on(t.createdAt),
]);

export const insertPaymentSchema = createInsertSchema(paymentsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
