import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const chatParticipantsTable = pgTable("chat_participants", {
  id: serial("id").primaryKey(),
  rideId: integer("ride_id").notNull(),
  userId: integer("user_id").notNull(),
  role: text("role").notNull(),
  name: text("name").notNull().default(""),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
}, (t) => [
  index("chat_participants_ride_user_idx").on(t.rideId, t.userId),
  index("chat_participants_user_id_idx").on(t.userId),
]);

export type ChatParticipant = typeof chatParticipantsTable.$inferSelect;
