import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";

export const groupChatsTable = pgTable("group_chats", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  chatType: text("chat_type").notNull().default("custom"),
  cityId: integer("city_id"),
  branchId: integer("branch_id"),
  driverGroupId: integer("driver_group_id"),
  createdBy: integer("created_by").notNull(),
  avatarUrl: text("avatar_url"),
  description: text("description").default(""),
  photosEnabled: boolean("photos_enabled").notNull().default(true),
  voiceEnabled: boolean("voice_enabled").notNull().default(true),
  callsEnabled: boolean("calls_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const groupChatMembersTable = pgTable("group_chat_members", {
  id: serial("id").primaryKey(),
  chatId: integer("chat_id").notNull(),
  userId: integer("user_id").notNull(),
  role: text("role").notNull().default("member"),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

export const groupChatMessagesTable = pgTable("group_chat_messages", {
  id: serial("id").primaryKey(),
  chatId: integer("chat_id").notNull(),
  senderId: integer("sender_id").notNull(),
  senderRole: text("sender_role").notNull(),
  senderName: text("sender_name").notNull().default(""),
  message: text("message").notNull(),
  type: text("type").notNull().default("text"),
  status: text("status").notNull().default("sent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const groupJoinRequestsTable = pgTable("group_join_requests", {
  id: serial("id").primaryKey(),
  chatId: integer("chat_id").notNull(),
  userId: integer("user_id").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  processedBy: integer("processed_by"),
  processedAt: timestamp("processed_at"),
});

export type GroupChat = typeof groupChatsTable.$inferSelect;
export type GroupChatMember = typeof groupChatMembersTable.$inferSelect;
export type GroupChatMessage = typeof groupChatMessagesTable.$inferSelect;
export type GroupJoinRequest = typeof groupJoinRequestsTable.$inferSelect;
