import { Platform, PermissionsAndroid } from "react-native";

import BuxtaxiBackground from "../../modules/buxtaxi-background";
import type { LocationEvent } from "../../modules/buxtaxi-background";

// Thin, platform-safe wrapper around the native buxtaxi-background module.
// Android-only; on iOS/web every call is a no-op so shared code stays simple.
const isAndroid = Platform.OS === "android";
const mod = isAndroid ? BuxtaxiBackground : null;

export const backgroundAvailable = !!mod;

/** Foreground location + notifications permission (call before going Online). */
export async function ensureForegroundPermissions(): Promise<boolean> {
  if (!isAndroid) return false;
  try {
    const fine = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    if (fine !== PermissionsAndroid.RESULTS.GRANTED) return false;
    if (Number(Platform.Version) >= 33) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }
    return true;
  } catch {
    return false;
  }
}

/** "Allow all the time" location — needed for screen-off / minimized tracking. */
export async function ensureBackgroundLocation(): Promise<boolean> {
  if (!isAndroid) return false;
  try {
    if (Number(Platform.Version) >= 29) {
      const bg = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
      );
      return bg === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  } catch {
    return false;
  }
}

export function startBackgroundService(token: string, apiBase: string, highAccuracy = false): void {
  mod?.startService(token, apiBase, highAccuracy);
}

export function stopBackgroundService(): void {
  mod?.stopService();
}

export function setHighAccuracy(high: boolean): void {
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
  mod?.requestBatteryOptimizationExemption();
}

export function addLocationListener(cb: (e: LocationEvent) => void): { remove: () => void } {
  if (!mod) return { remove: () => {} };
  return mod.addListener("onLocation", cb);
}
