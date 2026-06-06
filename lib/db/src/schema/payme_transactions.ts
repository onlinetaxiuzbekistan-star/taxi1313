import { pgTable, serial, integer, text, timestamp, bigint, index } from "drizzle-orm/pg-core";

export const paymeTransactionsTable = pgTable("payme_transactions", {
  id: serial("id").primaryKey(),
  paymeId: text("payme_id").notNull().unique(),
  driverId: integer("driver_id").notNull(),
  amount: integer("amount").notNull(),
  state: integer("state").notNull().default(1),
  reason: integer("reason"),
  createTime: bigint("create_time", { mode: "number" }).notNull(),
  performTime: bigint("perform_time", { mode: "number" }),
  cancelTime: bigint("cancel_time", { mode: "number" }),
  account: text("account").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("payme_tx_payme_id_idx").on(t.paymeId),
  index("payme_tx_driver_id_idx").on(t.driverId),
  index("payme_tx_state_idx").on(t.state),
  index("payme_tx_create_time_idx").on(t.createTime),
]);
