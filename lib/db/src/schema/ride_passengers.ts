import {
  pgTable, serial, integer, text, real, numeric, timestamp, index
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ridePassengersTable = pgTable("ride_passengers", {
  id: serial("id").primaryKey(),
  rideId: integer("ride_id").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  pickupAddress: text("pickup_address"),
  dropoffAddress: text("dropoff_address"),
  pickupLat: real("pickup_lat"),
  pickupLng: real("pickup_lng"),
  dropoffLat: real("dropoff_lat"),
  dropoffLng: real("dropoff_lng"),
  seatNumber: integer("seat_number").notNull(),
  price: numeric("price", { precision: 19, scale: 2, mode: "number" }).notNull().default(0),
  baggageType: text("baggage_type").default("none"),
  gender: text("gender").default("male"),
  source: text("source").notNull().default("system"),
  status: text("status").notNull().default("waiting"),
  externalKey: text("external_key"),
  seatPreference: text("seat_preference"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("ride_passengers_ride_id_idx").on(t.rideId),
]);

export const insertRidePassengerSchema = createInsertSchema(ridePassengersTable)
  .omit({ id: true, createdAt: true });
export type InsertRidePassenger = z.infer<typeof insertRidePassengerSchema>;
export type RidePassenger = typeof ridePassengersTable.$inferSelect;
