import { useState, useEffect, useRef } from "react";

import { addLocationListener, backgroundAvailable } from "@/native/background";

// Only TWO states — no flickering yellow middle band:
//   active (green) — GPS is working (a fix arrived recently)
//   lost   (red)   — GPS not working (offline, or no fix for a while)
export type GpsStatus = "active" | "lost";

// The foreground service emits a fix roughly every 20–30s. We treat GPS as
// "working" as long as a fix arrived within 90s — that bridges 2–3 missed fixes
// so a working driver stays solid GREEN and never blinks to red/yellow. It only
// turns RED when GPS is genuinely not delivering (or the driver is offline).
// `serverLastFix` is the driver's last_location_update as the SERVER sees it
// (from /me). The native foreground service POSTs GPS to the server directly, and
// after the app has been backgrounded the JS-side location listener can stop
// firing even while the native service keeps sending — so the local-only signal
// went RED while the operator map still showed the driver online (server had a
// fresh fix). Treating GPS as working when EITHER the local listener OR the server
// has a recent fix keeps the header indicator consistent with the map.
export function useGpsActive(online: boolean, serverLastFix?: number | string | null): GpsStatus {
  const lastFix = useRef(0);
  const [, tick] = useState(0);

  useEffect(() => {
    const sub = addLocationListener(() => {
      lastFix.current = Date.now();
    });
    const iv = setInterval(() => tick((n) => n + 1), 10_000);
    return () => {
      sub.remove();
      clearInterval(iv);
    };
  }, []);

  if (!online) return "lost";

  const now = Date.now();
  const serverMs = serverLastFix ? new Date(serverLastFix).getTime() : 0;
  const serverSince = serverMs ? now - serverMs : Infinity;

  // Web/iOS preview (no native module): rely on the server fix (or just online).
  if (!backgroundAvailable) return serverSince < 90_000 || !serverLastFix ? "active" : "lost";

  const localSince = lastFix.current === 0 ? Infinity : now - lastFix.current;
  // GREEN if either the local listener OR the server has a recent fix.
  return Math.min(localSince, serverSince) < 90_000 ? "active" : "lost";
}
