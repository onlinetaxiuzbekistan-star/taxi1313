import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  rideId: integer("ride_id").notNull().default(0),
  senderId: integer("sender_id").notNull(),
  senderRole: text("sender_role").notNull(),
  senderName: text("sender_name").notNull().default(""),
  recipientId: integer("recipient_id"),
  message: text("message").notNull(),
  type: text("type").notNull().default("text"),
  status: text("status").notNull().default("sent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
