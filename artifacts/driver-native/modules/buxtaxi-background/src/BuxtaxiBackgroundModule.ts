import { NativeModule, requireNativeModule } from "expo";

import type { BuxtaxiBackgroundEvents } from "./BuxtaxiBackground.types";

declare class BuxtaxiBackgroundModule extends NativeModule<BuxtaxiBackgroundEvents> {
  isIgnoringBatteryOptimizations(): boolean;
  requestBatteryOptimizationExemption(): void;
  setAuthToken(token: string | null): void;
  startService(token: string, apiBase: string, highAccuracy: boolean): void;
  setHighAccuracy(high: boolean): void;
  stopService(): void;
}

// Android-only native module. On iOS/web requireNativeModule throws — return
// null so importing this file never crashes; the app wrapper guards on null.
let nativeModule: BuxtaxiBackgroundModule | null = null;
try {
  nativeModule = requireNativeModule<BuxtaxiBackgroundModule>("BuxtaxiBackground");
} catch {
  nativeModule = null;
}

export default nativeModule;
export type { BuxtaxiBackgroundModule };
