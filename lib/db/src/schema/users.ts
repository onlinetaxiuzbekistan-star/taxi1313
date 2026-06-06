import {
  pgTable, text, serial, integer, real, numeric, timestamp, pgEnum, index, boolean, jsonb
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { branchesTable } from "./branches";

export const userRoleEnum     = pgEnum("user_role",     ["rider", "driver", "dispatcher", "admin"]);
export const driverStatusEnum = pgEnum("driver_status", ["offline", "online", "busy"]);
export const carClassEnum     = pgEnum("car_class",     ["economy", "comfort", "business"]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  login: text("login"),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("rider"),

  firstName: text("first_name"),
  lastName: text("last_name"),
  city: text("city"),

  // Branch attachment (added 2026-05-02): scopes which staff/dispatcher sees which
  // drivers/rides. NULL → global scope (admins, legacy staff).
  branchId: integer("branch_id").references(() => branchesTable.id),

  // Driver — status & vehicle
  status: driverStatusEnum("status").default("offline"),
  carBrand: text("car_brand"),
  carModel: text("car_model"),
  carYear: integer("car_year"),
  carNumber: text("car_number"),
  carColor: text("car_color"),
  carBodyType: text("car_body_type"),
  carClass: carClassEnum("car_class"),
  groupId: integer("group_id"),
  seats: integer("seats").default(4),

  // Driver — photos
  driverPhoto: text("driver_photo"),
  carPhoto: text("car_photo"),
  lastSelfieUrl: text("last_selfie_url"),
  lastCarFrontUrl: text("last_car_front_url"),
  lastCarBackUrl: text("last_car_back_url"),
  lastInteriorUrl: text("last_interior_url"),

  // Driver — options
  hasAC: boolean("has_ac").default(false),
  hasLuggage: boolean("has_luggage").default(false),
  isComfort: boolean("is_comfort").default(false),
  customOptions: jsonb("custom_options"),

  // Driver — financials
  balance: numeric("balance", { precision: 12, scale: 2 }).default("0.00"),
  bonusBalance: numeric("bonus_balance", { precision: 12, scale: 2 }).default("0.00"),
  commissionRate: real("commission_rate").default(10),

  // Driver — referral
  referralCode: text("referral_code").unique(),
  invitedBy: integer("invited_by"),

  // Driver — activity scoring
  activityScore: real("activity_score").default(0),
  acceptedOrders: integer("accepted_orders").default(0),
  cancelledOrders: integer("cancelled_orders").default(0),

  // GPS
  lat: real("lat"),
  lng: real("lng"),
  lastLocationUpdate: timestamp("last_location_update"),

  // Stats
  rating: real("rating").default(5.0),
  totalRides: integer("total_rides").default(0),

  // Behavioral enforcement
  consecutiveIgnores: integer("consecutive_ignores").default(0),
  bannedUntil: timestamp("banned_until"),
  statusToggleCount: integer("status_toggle_count").default(0),
  lastStatusToggle: timestamp("last_status_toggle"),

  acceptsCalls: boolean("accepts_calls").default(true),
  cashCarrier: boolean("cash_carrier").notNull().default(false),
  roleId: integer("role_id"),

  sipServer: text("sip_server"),
  sipDomain: text("sip_domain"),
  sipLogin: text("sip_login"),
  sipPassword: text("sip_password"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("users_role_idx").on(t.role),
  index("users_status_idx").on(t.status),
  index("users_role_status_idx").on(t.role, t.status),
  index("users_referral_code_idx").on(t.referralCode),
  index("users_activity_score_idx").on(t.activityScore),
  index("users_branch_id_idx").on(t.branchId),
]);

export const insertUserSchema = createInsertSchema(usersTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
