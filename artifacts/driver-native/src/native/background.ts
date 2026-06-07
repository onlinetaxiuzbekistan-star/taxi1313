import { Platform, PermissionsAndroid } from "react-native";

import BuxtaxiBackground from "../../modules/buxtaxi-background";
import type { LocationEvent } from "../../modules/buxtaxi-background";

// Thin, platform-safe wrapper around the native buxtaxi-background module.
// Android-only; on iOS/web every call is a no-op so shared code stays simple.
const isAndroid = Platform.OS === "android";
const mod = isAndroid ? BuxtaxiBackground : null;

const log = (...args: unknown[]) => console.log("[BG]", ...args);

export const backgroundAvailable = !!mod;
log("native module loaded:", backgroundAvailable, "platform:", Platform.OS);

/**
 * Request the permissions needed to run the foreground GPS service.
 * Order matters on Android 13+: POST_NOTIFICATIONS must be granted first, or the
 * foreground-service / order notifications are silently suppressed. Fine location
 * must be granted before a type=location foreground service starts (Android 14+).
 * Returns true if fine location is granted (the minimum to start the service).
 */
export async function ensureForegroundPermissions(): Promise<boolean> {
  if (!isAndroid) return false;
  try {
    // 1) Notifications first (Android 13+).
    if (Number(Platform.Version) >= 33) {
      const n = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      log("POST_NOTIFICATIONS ->", n);
    }
    // 2) Fine location (required before startForeground type=location on Android 14+).
    const fine = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    log("ACCESS_FINE_LOCATION ->", fine);
    if (fine !== PermissionsAndroid.RESULTS.GRANTED) return false;
    // 3) Background location ("Allow all the time") for screen-off tracking
    //    (Android 10+). Best-effort: opens Settings on 11+; service still starts
    //    with foreground-only location, but screen-off updates need this granted.
    if (Number(Platform.Version) >= 29) {
      const bg = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION);
      log("ACCESS_BACKGROUND_LOCATION ->", bg);
    }
    return true;
  } catch (e) {
    log("permission request error:", (e as Error)?.message);
    return false;
  }
}

export function startBackgroundService(token: string, apiBase: string, highAccuracy = false): void {
  log("startBackgroundService(highAccuracy=" + highAccuracy + ", apiBase=" + apiBase + ")", "available:", backgroundAvailable);
  mod?.startService(token, apiBase, highAccuracy);
}

export function stopBackgroundService(): void {
  log("stopBackgroundService()");
  mod?.stopService();
}

export function setHighAccuracy(high: boolean): void {
  log("setHighAccuracy(" + high + ")");
  mod?.setHighAccuracy(high);
}

export function setBackgroundAuthToken(token: string | null): void {
  mod?.setAuthToken(token ?? null);
}

export function isIgnoringBatteryOptimizations(): boolean {
  // Default true on non-Android so we never show the prompt there.
  return mod?.isIgnoringBatteryOptimizations() ?? true;
}

export function requestBatteryOptimizationExemption(): void {
  log("requestBatteryOptimizationExemption()");
  mod?.requestBatteryOptimizationExemption();
}

export function addLocationListener(cb: (e: LocationEvent) => void): { remove: () => void } {
  if (!mod) return { remove: () => {} };
  return mod.addListener("onLocation", cb);
}
