import { useState, useEffect, useRef } from "react";

import { addLocationListener, backgroundAvailable } from "@/native/background";

// GPS health for the header indicator: GREEN when the native foreground service
// is producing location fixes (a fix within the last ~25s), RED otherwise.
// On platforms without the native module (web preview), falls back to `online`.
export function useGpsActive(online: boolean): boolean {
  const lastFix = useRef(0);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sub = addLocationListener(() => {
      lastFix.current = Date.now();
    });
    const iv = setInterval(() => {
      setActive(Date.now() - lastFix.current < 25000);
    }, 2000);
    return () => {
      sub.remove();
      clearInterval(iv);
    };
  }, []);

  if (!backgroundAvailable) return online; // web/iOS preview fallback
  return active;
}
