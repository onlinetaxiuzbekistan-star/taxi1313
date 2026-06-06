import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const chatParticipantsTable = pgTable("chat_participants", {
  id: serial("id").primaryKey(),
  rideId: integer("ride_id").notNull(),
  userId: integer("user_id").notNull(),
  role: text("role").notNull(),
  name: text("name").notNull().default(""),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

export type ChatParticipant = typeof chatParticipantsTable.$inferSelect;
