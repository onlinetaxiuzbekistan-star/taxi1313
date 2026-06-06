import { pgTable, serial, integer, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const driverCardsTable = pgTable("driver_cards", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id").notNull(),
  cardToken: text("card_token").notNull(),
  cardId: text("card_id"),
  pan: text("pan").notNull(),
  expiry: text("expiry"),
  cardHolder: text("card_holder"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("driver_cards_driver_id_idx").on(t.driverId),
  index("driver_cards_card_token_idx").on(t.cardToken),
]);

export type DriverCard = typeof driverCardsTable.$inferSelect;
