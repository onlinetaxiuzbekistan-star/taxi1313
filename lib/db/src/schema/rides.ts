import {
  pgTable, text, serial, integer, real, numeric, timestamp, pgEnum, index, boolean, jsonb
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { branchesTable } from "./branches";

export const rideStatusEnum = pgEnum("ride_status", [
  "pending",
  "offered",
  "accepted",
  "in_progress",
  "completed",
  "cancelled",
  // A child ride merged into a trip ride (autodispatch). Present in production;
  // declared here so the schema/types match reality.
  "merged",
]);

export const paymentTypeEnum = pgEnum("payment_type", ["cash", "card", "transfer"]);

export const ridesTable = pgTable("rides", {
  id: serial("id").primaryKey(),
  riderId: integer("rider_id"),
  clientId: integer("client_id"),
  driverId: integer("driver_id"),

  // Branch scope (added 2026-05-02): copied from creator (dispatcher) at create time;
  // NULL = global / legacy.
  branchId: integer("branch_id").references(() => branchesTable.id),

  // Operator (dispatcher/admin) who created the ride; NULL for self-service rides.
  createdByUserId: integer("created_by_user_id"),
  createdByUserName: text("created_by_user_name"),

  fromCity: text("from_city").notNull(),
  toCity: text("to_city").notNull(),
  fromAddress: text("from_address"),
  toAddress: text("to_address"),

  scheduledAt: timestamp("scheduled_at").notNull(),
  passengers: integer("passengers").notNull().default(1),
  carClass: text("car_class").notNull().default("economy"),

  status: rideStatusEnum("status").notNull().default("pending"),
  paymentType: paymentTypeEnum("payment_type").notNull().default("cash"),

  price: numeric("price", { precision: 19, scale: 2, mode: "number" }).notNull().default(0),
  commission: numeric("commission", { precision: 19, scale: 2, mode: "number" }),
  driverPayout: numeric("driver_payout", { precision: 19, scale: 2, mode: "number" }),
  optionsTotal: numeric("options_total", { precision: 19, scale: 2, mode: "number" }).notNull().default(0),
  optionsCommission: numeric("options_commission", { precision: 19, scale: 2, mode: "number" }).notNull().default(0),
  distance: real("distance"),
  duration: integer("duration"),
  comment: text("comment"),

  riderName: text("rider_name"),
  riderPhone: text("rider_phone"),

  driverName: text("driver_name"),
  driverPhone: text("driver_phone"),
  driverCar: text("driver_car"),
  driverCarNumber: text("driver_car_number"),
  driverRating: real("driver_rating"),

  fromLat: real("from_lat"),
  fromLng: real("from_lng"),
  toLat: real("to_lat"),
  toLng: real("to_lng"),

  fromDistrictId: integer("from_district_id"),
  toDistrictId: integer("to_district_id"),
  fromDistrictName: text("from_district_name"),
  toDistrictName: text("to_district_name"),
  fromDistrictCharge: numeric("from_district_charge", { precision: 19, scale: 2, mode: "number" }).default(0),
  toDistrictCharge: numeric("to_district_charge", { precision: 19, scale: 2, mode: "number" }).default(0),
  basePrice: numeric("base_price", { precision: 19, scale: 2, mode: "number" }),

  tripId: integer("trip_id"),
  seatsTotal: integer("seats_total").default(0),
  seatsTaken: integer("seats_taken").default(0),

  waypoints: jsonb("waypoints"),
  routePolyline: jsonb("route_polyline"),
  routeDuration: integer("route_duration"),
  routeDistance: real("route_distance"),
  detourMinutes: integer("detour_minutes"),

  version: integer("version").notNull().default(1),
  timeSlot: text("time_slot"),
  requiredGroupLevel: integer("required_group_level"),
  isUrgent: boolean("is_urgent").default(false),
  roundTrip: boolean("round_trip").default(false),
  source: text("source").default("dispatch"),
  mode: text("mode").default("dispatch"),
  cancelReason: text("cancel_reason"),
  isMail: boolean("is_mail").notNull().default(false),
  isMoney: boolean("is_money").notNull().default(false),
  requiredCarModel: text("required_car_model"),
  selectedOptions: jsonb("selected_options").$type<string[]>().notNull().default([]),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("rides_status_idx").on(t.status),
  index("rides_driver_id_idx").on(t.driverId),
  index("rides_client_id_idx").on(t.clientId),
  index("rides_created_at_idx").on(t.createdAt),
  index("rides_from_to_idx").on(t.fromCity, t.toCity),
  index("rides_trip_id_idx").on(t.tripId),
  index("rides_branch_id_idx").on(t.branchId),
]);

export const insertRideSchema = createInsertSchema(ridesTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRide = z.infer<typeof insertRideSchema>;
export type Ride = typeof ridesTable.$inferSelect;
