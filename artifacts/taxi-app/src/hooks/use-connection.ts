import { useState, useEffect, useCallback, useRef } from "react";
import { syncQueue, getQueueCount, type OfflineAction } from "../lib/offline-queue";

export function useConnection() {
  const [online, setOnline] = useState(navigator.onLine);
  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const refreshCount = useCallback(async () => {
    try {
      const c = await getQueueCount();
      if (mountedRef.current) setQueueCount(c);
    } catch {}
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const onOnline = () => { if (mountedRef.current) setOnline(true); };
    const onOffline = () => { if (mountedRef.current) setOnline(false); };
    const onQueueChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (mountedRef.current) setQueueCount(detail?.count ?? 0);
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("offline-queue-change", onQueueChange);

    refreshCount();

    return () => {
      mountedRef.current = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("offline-queue-change", onQueueChange);
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [refreshCount]);

  const doSync = useCallback(async (
    onSuccess?: (a: OfflineAction) => void,
    onError?: (a: OfflineAction, err: string) => void
  ) => {
    if (!navigator.onLine || syncing) return 0;
    setSyncing(true);
    try {
      const count = await syncQueue(onSuccess, onError);
      await refreshCount();
      return count;
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
  }, [syncing, refreshCount]);

  useEffect(() => {
    if (online && queueCount > 0) {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => { doSync(); }, 1500);
    }
  }, [online, queueCount]);

  return { online, queueCount, syncing, doSync };
}
