import { useEffect, useRef } from "react";

import { useAuth } from "@/hooks/use-auth";
import { sendWsMessage } from "@/hooks/use-ride-websocket";
import { API_BASE_URL } from "@/config";
import * as Bg from "@/native/background";
import { registerPushToken } from "@/native/push";

// Ties the native background capabilities to driver state:
//   - Online  -> request perms, start the foreground GPS + offer-poll service,
//                prompt for battery-optimization exemption (once).
//   - Offline -> stop the service.
//   - "busy" (on a ride) -> high-accuracy GPS.
//   - native location events -> forwarded over the WS as driver_location.
//   - login -> register FCM device token (inert until backend FCM lands).
export function useOnlineService() {
  const { user, token } = useAuth();
  const isOnline = user?.status === "online" || user?.status === "busy";
  const isBusy = user?.status === "busy";
  const batteryPrompted = useRef(false);

  // Forward native GPS fixes to the backend over the existing driver socket.
  useEffect(() => {
    if (!Bg.backgroundAvailable) return;
    const sub = Bg.addLocationListener((loc) => {
      sendWsMessage({
        type: "driver_location",
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
        heading: loc.bearing,
        speed: loc.speed,
        ts: Date.now(),
      });
    });
    return () => sub.remove();
  }, []);

  // Start/stop the foreground service on Online/Offline.
  useEffect(() => {
    if (!Bg.backgroundAvailable || !token) return;
    let cancelled = false;

    if (isOnline) {
      console.log("[BG] driver Online -> requesting permissions + starting service");
      (async () => {
        const ok = await Bg.ensureForegroundPermissions();
        if (!ok) {
          console.log("[BG] foreground permissions NOT granted -> service not started");
          return;
        }
        if (cancelled) return;
        Bg.startBackgroundService(token, API_BASE_URL, !!isBusy);
        if (!batteryPrompted.current && !Bg.isIgnoringBatteryOptimizations()) {
          batteryPrompted.current = true;
          setTimeout(() => Bg.requestBatteryOptimizationExemption(), 2500);
        }
      })();
    } else {
      Bg.stopBackgroundService();
    }

    return () => {
      cancelled = true;
    };
  }, [isOnline, isBusy, token]);

  // Keep the token the native offer-poller uses in sync.
  useEffect(() => {
    if (Bg.backgroundAvailable) Bg.setBackgroundAuthToken(token);
  }, [token]);

  // Register the FCM device token once per login (inert without Firebase config).
  useEffect(() => {
    if (token && user?.role === "driver") registerPushToken(token);
  }, [token, user?.role]);
}
