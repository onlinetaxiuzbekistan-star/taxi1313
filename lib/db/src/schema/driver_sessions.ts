import { pgTable, serial, integer, varchar, timestamp, text, index } from "drizzle-orm/pg-core";

export const driverSessionsTable = pgTable("driver_sessions", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id").notNull(),
  sessionToken: varchar("session_token", { length: 128 }).notNull().unique(),
  deviceId: varchar("device_id", { length: 128 }),
  deviceName: varchar("device_name", { length: 255 }),
  ipAddress: varchar("ip_address", { length: 45 }),
  lastActiveAt: timestamp("last_active_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("driver_sessions_driver_idx").on(t.driverId),
  index("driver_sessions_token_idx").on(t.sessionToken),
]);

export type DriverSession = typeof driverSessionsTable.$inferSelect;

export const loginAuditLogsTable = pgTable("login_audit_logs", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id").notNull(),
  loginType: varchar("login_type", { length: 20 }).notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  deviceId: varchar("device_id", { length: 128 }),
  success: integer("success").notNull().default(1),
  failReason: varchar("fail_reason", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("login_audit_driver_idx").on(t.driverId),
]);

export type LoginAuditLog = typeof loginAuditLogsTable.$inferSelect;
