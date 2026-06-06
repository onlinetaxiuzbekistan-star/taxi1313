import { pgTable, serial, text, integer, boolean, timestamp, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const newsAudienceEnum = pgEnum("news_audience", ["driver", "client", "all"]);

export const newsTable = pgTable("news", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  photos: jsonb("photos").$type<string[]>().default([]),
  videoUrl: text("video_url"),
  audience: newsAudienceEnum("audience").notNull().default("all"),
  cityId: integer("city_id"),
  branchId: integer("branch_id"),
  driverGroupId: integer("driver_group_id"),
  isPublished: boolean("is_published").notNull().default(true),
  authorId: integer("author_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("news_audience_idx").on(t.audience),
  index("news_created_at_idx").on(t.createdAt),
  index("news_published_idx").on(t.isPublished),
]);

export const newsReadsTable = pgTable("news_reads", {
  id: serial("id").primaryKey(),
  newsId: integer("news_id").notNull(),
  userId: integer("user_id").notNull(),
  readAt: timestamp("read_at").defaultNow().notNull(),
}, (t) => [
  index("news_reads_news_idx").on(t.newsId),
  index("news_reads_user_idx").on(t.userId),
  index("news_reads_unique_idx").on(t.newsId, t.userId),
]);

export const pushNotificationsTable = pgTable("push_notifications", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  photos: jsonb("photos").$type<string[]>().default([]),
  videoUrl: text("video_url"),
  audience: newsAudienceEnum("audience").notNull().default("all"),
  cityId: integer("city_id"),
  branchId: integer("branch_id"),
  driverGroupId: integer("driver_group_id"),
  authorId: integer("author_id").notNull(),
  sentCount: integer("sent_count").default(0),
  deliveredCount: integer("delivered_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("push_notif_audience_idx").on(t.audience),
  index("push_notif_created_at_idx").on(t.createdAt),
]);

export const insertNewsSchema = createInsertSchema(newsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNews = z.infer<typeof insertNewsSchema>;
export type News = typeof newsTable.$inferSelect;
export type NewsRead = typeof newsReadsTable.$inferSelect;
export type PushNotification = typeof pushNotificationsTable.$inferSelect;
