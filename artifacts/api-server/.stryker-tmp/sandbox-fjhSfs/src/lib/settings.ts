// @ts-nocheck
import { db, settingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { getSetting } from "./settingsCache.js";

const MARKETPLACE_KEYS = [
  "max_active_orders",
  "max_orders_per_day",
  "commission_percent",
  "commission_fixed",
  "max_transfers",
  "transfer_time_limit_minutes",
  "min_order_price",
  "max_order_price",
];

const MARKETPLACE_DEFAULTS: Record<string, string> = {
  max_active_orders: "20",
  max_orders_per_day: "30",
  commission_percent: "10",
  commission_fixed: "0",
  max_transfers: "1",
  transfer_time_limit_minutes: "10",
  min_order_price: "10000",
  max_order_price: "5000000",
};

export function getMarketplaceSettings(): Record<string, string> {
  const cfg: Record<string, string> = {};
  for (const key of MARKETPLACE_KEYS) {
    cfg[key] = getSetting(key, MARKETPLACE_DEFAULTS[key] || "");
  }
  return cfg;
}

export async function getSettingValue(key: string, fallback: string): Promise<string> {
  return getSetting(key, fallback);
}
