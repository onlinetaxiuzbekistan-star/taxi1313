import {
  pgTable, serial, integer, numeric, text, timestamp, pgEnum, index
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const marketplaceStatusEnum = pgEnum("marketplace_status", [
  "active",
  "sold",
  "in_progress",
  "completed",
  "cancelled",
]);

export const marketplaceListingsTable = pgTable("marketplace_listings", {
  id: serial("id").primaryKey(),
  rideId: integer("ride_id"),
  sellerId: integer("seller_id").notNull(),
  buyerId: integer("buyer_id"),
  price: numeric("price", { precision: 19, scale: 2, mode: "number" }).notNull(),
  comment: text("comment"),
  status: marketplaceStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),

  cancelledAt: timestamp("cancelled_at"),
  fromCity: text("from_city"),
  toCity: text("to_city"),
  scheduledAt: timestamp("scheduled_at"),
  clientName: text("client_name"),
  clientPhone: text("client_phone"),
  seatsCount: integer("seats_count"),
  baggageType: text("baggage_type"),
  fromDistrictId: integer("from_district_id"),
  toDistrictId: integer("to_district_id"),
  routeId: integer("route_id"),
  basePrice: numeric("base_price", { precision: 19, scale: 2, mode: "number" }),
}, (t) => [
  index("mp_ride_id_idx").on(t.rideId),
  index("mp_seller_id_idx").on(t.sellerId),
  index("mp_buyer_id_idx").on(t.buyerId),
  index("mp_status_idx").on(t.status),
  index("mp_created_at_idx").on(t.createdAt),
]);

export const insertMarketplaceListingSchema = createInsertSchema(marketplaceListingsTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMarketplaceListing = z.infer<typeof insertMarketplaceListingSchema>;
export type MarketplaceListing = typeof marketplaceListingsTable.$inferSelect;
