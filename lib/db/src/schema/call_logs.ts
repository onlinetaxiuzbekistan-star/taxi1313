import { pgTable, serial, integer, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * call_logs — incoming calls from clients.
 * When a call arrives: log it, find/create client, fire WS incoming_call event.
 */
export const callLogsTable = pgTable("call_logs", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),           // caller ID
  clientId: integer("client_id"),           // → clients.id (null if not matched yet)
  handledBy: integer("handled_by"),         // → users.id (dispatcher who took the call)
  rideCreated: boolean("ride_created").notNull().default(false),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("call_logs_phone_idx").on(t.phone),
  index("call_logs_created_at_idx").on(t.createdAt),
]);

export const insertCallLogSchema = createInsertSchema(callLogsTable)
  .omit({ id: true, createdAt: true });
export type InsertCallLog = z.infer<typeof insertCallLogSchema>;
export type CallLog = typeof callLogsTable.$inferSelect;
