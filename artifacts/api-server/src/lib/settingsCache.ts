import { db, settingsTable } from "@workspace/db";
import { clog } from "./logger.js";
import { logger } from "./logger.js";

let SETTINGS_CACHE: Record<string, string> = {};
let cacheLoaded = false;

export async function loadSettingsCache(): Promise<void> {
  try {
    const rows = await db.select().from(settingsTable);
    SETTINGS_CACHE = {};
    for (const row of rows) {
      SETTINGS_CACHE[row.key] = row.value;
    }
    cacheLoaded = true;
    logger.info({ count: rows.length }, "[SETTINGS] Cache loaded");
    clog.log(`[SETTINGS] Loaded ${rows.length} settings into cache`);
  } catch (err) {
    logger.error({ err }, "[SETTINGS] Failed to load cache");
    clog.error("[SETTINGS] Failed to load cache:", err);
  }
}

export function refreshCache(updates: { key: string; value: string }[]): void {
  const newCache = { ...SETTINGS_CACHE };
  for (const { key, value } of updates) {
    const oldVal = newCache[key];
    newCache[key] = value;
    if (oldVal !== value) {
      clog.log(`[SETTINGS] Updated ${key}: ${oldVal} → ${value}`);
    }
  }
  SETTINGS_CACHE = newCache;
}

export function getSetting(key: string, defaultValue: string): string {
  return SETTINGS_CACHE[key] ?? defaultValue;
}

export function getSettingNum(key: string, defaultValue: number): number {
  const raw = SETTINGS_CACHE[key];
  if (raw === undefined) return defaultValue;
  const num = parseFloat(raw);
  return Number.isFinite(num) ? num : defaultValue;
}

export function getSettingBool(key: string, defaultValue: boolean): boolean {
  const raw = SETTINGS_CACHE[key];
  if (raw === undefined) return defaultValue;
  return raw === "true" || raw === "1";
}

export function isCacheLoaded(): boolean {
  return cacheLoaded;
}

export function getAllCached(): Record<string, string> {
  return { ...SETTINGS_CACHE };
}
