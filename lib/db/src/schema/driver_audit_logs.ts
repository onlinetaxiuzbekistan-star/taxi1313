import { pgTable, serial, integer, varchar, timestamp, text, index } from "drizzle-orm/pg-core";

export const driverAuditLogsTable = pgTable("driver_audit_logs", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id").notNull(),
  actorId: integer("actor_id").notNull(),
  action: varchar("action", { length: 50 }).notNull(),
  field: varchar("field", { length: 50 }),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("driver_audit_driver_idx").on(t.driverId),
  index("driver_audit_actor_idx").on(t.actorId),
  index("driver_audit_action_idx").on(t.action),
]);

export type DriverAuditLog = typeof driverAuditLogsTable.$inferSelect;
