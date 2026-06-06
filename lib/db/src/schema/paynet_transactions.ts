import { pgTable, serial, integer, text, timestamp, bigint, numeric, index } from "drizzle-orm/pg-core";

export const paynetTransactionsTable = pgTable("paynet_transactions", {
  id: serial("id").primaryKey(),
  paynetTransactionId: text("paynet_transaction_id").notNull().unique(),
  providerTrnId: bigint("provider_trn_id", { mode: "number" }).notNull(),
  driverId: integer("driver_id").notNull(),
  phone: text("phone").notNull(),
  amountTiyin: bigint("amount_tiyin", { mode: "number" }).notNull(),
  amountSum: numeric("amount_sum", { precision: 12, scale: 2 }).notNull(),
  status: text("status").notNull().default("created"),
  paynetTimestamp: timestamp("paynet_timestamp"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  cancelledAt: timestamp("cancelled_at"),
}, (t) => [
  index("paynet_tx_paynet_id_idx").on(t.paynetTransactionId),
  index("paynet_tx_driver_id_idx").on(t.driverId),
  index("paynet_tx_phone_idx").on(t.phone),
  index("paynet_tx_created_at_idx").on(t.createdAt),
  index("paynet_tx_status_idx").on(t.status),
]);

export type PaynetTransaction = typeof paynetTransactionsTable.$inferSelect;
