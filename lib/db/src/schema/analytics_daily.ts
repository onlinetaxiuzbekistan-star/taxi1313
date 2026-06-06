import { pgTable, date, integer, numeric, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * analytics_daily — pre-aggregated daily metrics.
 * Populated by a cron job (or on-demand calculation).
 * One row per date — upserted nightly.
 */
export const analyticsDailyTable = pgTable("analytics_daily", {
  date: date("date").notNull(),
  totalOrders: integer("total_orders").notNull().default(0),
  completedOrders: integer("completed_orders").notNull().default(0),
  cancelledOrders: integer("cancelled_orders").notNull().default(0),
  revenue: numeric("revenue", { precision: 14, scale: 2 }).notNull().default("0"),
  commission: numeric("commission", { precision: 14, scale: 2 }).notNull().default("0"),
  avgOrderPrice: numeric("avg_order_price", { precision: 19, scale: 2, mode: "number" }),
  activeDrivers: integer("active_drivers").notNull().default(0),
  newClients: integer("new_clients").notNull().default(0),
}, (t) => [
  unique("analytics_daily_date_unique").on(t.date),
  index("analytics_daily_date_idx").on(t.date),
]);

export const insertAnalyticsDailySchema = createInsertSchema(analyticsDailyTable);
export type InsertAnalyticsDaily = z.infer<typeof insertAnalyticsDailySchema>;
export type AnalyticsDaily = typeof analyticsDailyTable.$inferSelect;
