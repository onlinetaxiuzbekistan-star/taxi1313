import { pgTable, serial, integer, text, timestamp, pgEnum, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const deviceRoleEnum = pgEnum("device_role", ["driver", "client", "dispatcher"]);

export const deviceTokensTable = pgTable("device_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  role: deviceRoleEnum("role").notNull(),
  token: text("token").notNull(),
  endpoint: text("endpoint"),
  p256dh: text("p256dh"),
  auth: text("auth"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("device_tokens_user_token_unique").on(t.userId, t.token),
  index("device_tokens_user_id_idx").on(t.userId),
  index("device_tokens_role_idx").on(t.role),
]);

export const insertDeviceTokenSchema = createInsertSchema(deviceTokensTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDeviceToken = z.infer<typeof insertDeviceTokenSchema>;
export type DeviceToken = typeof deviceTokensTable.$inferSelect;
