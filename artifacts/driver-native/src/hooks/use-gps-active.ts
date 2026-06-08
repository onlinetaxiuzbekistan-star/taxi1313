import { useState, useEffect, useRef } from "react";

import { addLocationListener, backgroundAvailable } from "@/native/background";

export type GpsStatus = "active" | "acquiring" | "lost";

// GPS health for the header indicator, with hysteresis so it does NOT flicker.
// The foreground service emits a fix roughly every 20–30s, so:
//   active    (green)  — a fix arrived within the last 75s
//   acquiring (yellow) — online but waiting for the first fix, or a 75–150s gap
//   lost      (red)    — offline, or no fix for >150s
export function useGpsActive(online: boolean): GpsStatus {
  const lastFix = useRef(0);
  const [, tick] = useState(0);

  useEffect(() => {
    const sub = addLocationListener(() => {
      lastFix.current = Date.now();
    });
    const iv = setInterval(() => tick((n) => n + 1), 3000);
    return () => {
      sub.remove();
      clearInterval(iv);
    };
  }, []);

  // Web/iOS preview (no native module): mirror the online flag.
  if (!backgroundAvailable) return online ? "active" : "lost";

  if (!online) return "lost";
  const since = lastFix.current === 0 ? Infinity : Date.now() - lastFix.current;
  if (since < 75_000) return "active";
  if (since < 150_000) return "acquiring";
  return "lost";
}
