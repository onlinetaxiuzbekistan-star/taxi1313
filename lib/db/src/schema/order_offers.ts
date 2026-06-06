import { pgTable, serial, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const offerStatusEnum = pgEnum("offer_status", [
  "pending",
  "accepted",
  "rejected",
  "expired",
]);

export const orderOffersTable = pgTable("order_offers", {
  id: serial("id").primaryKey(),
  rideId: integer("ride_id").notNull(),
  driverId: integer("driver_id").notNull(),
  status: offerStatusEnum("status").notNull().default("pending"),
  offeredAt: timestamp("offered_at").defaultNow().notNull(),
  respondedAt: timestamp("responded_at"),
  expiresAt: timestamp("expires_at"),
}, (t) => [
  index("order_offers_ride_id_idx").on(t.rideId),
  index("order_offers_driver_id_idx").on(t.driverId),
  index("order_offers_status_idx").on(t.status),
  index("order_offers_ride_driver_idx").on(t.rideId, t.driverId),
]);

export const insertOrderOfferSchema = createInsertSchema(orderOffersTable)
  .omit({ id: true, offeredAt: true });
export type InsertOrderOffer = z.infer<typeof insertOrderOfferSchema>;
export type OrderOffer = typeof orderOffersTable.$inferSelect;
