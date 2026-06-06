import { pgTable, serial, text, integer, boolean, timestamp, index, jsonb } from "drizzle-orm/pg-core";

export const photoTasksTable = pgTable("photo_tasks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  groupId: integer("group_id"),
  scheduleType: text("schedule_type").notNull().default("manual"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const photoRequestsTable = pgTable("photo_requests", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id").notNull(),
  taskId: integer("task_id"),
  status: text("status").notNull().default("pending"),
  selfieUrl: text("selfie_url"),
  carFrontUrl: text("car_front_url"),
  carBackUrl: text("car_back_url"),
  interiorUrl: text("interior_url"),
  comment: text("comment"),
  rejectReason: text("reject_reason"),
  previousRequestId: integer("previous_request_id"),
  retryCount: integer("retry_count").notNull().default(0),
  aiResults: jsonb("ai_results"),
  aiStatus: text("ai_status"),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("photo_requests_driver_status_idx").on(t.driverId, t.status),
]);

export const photoHistoryTable = pgTable("photo_control_history", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id").notNull(),
  requestId: integer("request_id").notNull(),
  photoType: text("photo_type").notNull(),
  url: text("url").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("photo_history_driver_idx").on(t.driverId),
  index("photo_history_request_idx").on(t.requestId),
]);

export type PhotoTask = typeof photoTasksTable.$inferSelect;
export type PhotoRequest = typeof photoRequestsTable.$inferSelect;
export type PhotoHistory = typeof photoHistoryTable.$inferSelect;
