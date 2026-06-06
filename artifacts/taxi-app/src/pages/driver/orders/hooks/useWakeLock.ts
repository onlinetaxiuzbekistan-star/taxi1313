import { useEffect, useRef } from "react";

export function useWakeLock(active: boolean) {
  const lockRef = useRef<any>(null);
  useEffect(() => {
    if (!active) {
      if (lockRef.current) {
        lockRef.current.release().catch(() => {});
        lockRef.current = null;
      }
      return;
    }
    let cancelled = false;
    const requestLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          lockRef.current = await (navigator as any).wakeLock.request("screen");
          lockRef.current.addEventListener("release", () => {
            lockRef.current = null;
          });
          console.log("[WAKE LOCK] acquired");
        }
      } catch (e: any) {
        console.warn("[WAKE LOCK] failed:", e?.message);
      }
    };
    requestLock();
    const handleVisibility = () => {
      if (!cancelled && document.visibilityState === "visible" && !lockRef.current) {
        requestLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (lockRef.current) {
        lockRef.current.release().catch(() => {});
        lockRef.current = null;
        console.log("[WAKE LOCK] released");
      }
    };
  }, [active]);
}

