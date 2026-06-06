import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const blockedAppsTable = pgTable("blocked_apps", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  packageName: text("package_name").notNull(),
  urlScheme: text("url_scheme"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
