import { useEffect, useRef, useState } from "react";

const CHECK_INTERVAL = 60000;
const BASE_URL = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

interface VersionData {
  version: string;
  buildTime: number;
  major?: number;
}

export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [forceUpdate, setForceUpdate] = useState(false);
  const currentVersion = useRef<string | null>(null);
  const currentMajor = useRef<number>(0);
  const dismissCount = useRef(0);
  const dismissedVersion = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    async function fetchVersion() {
      try {
        const res = await fetch(`${BASE_URL}/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data: VersionData = await res.json();
        if (!currentVersion.current) {
          currentVersion.current = data.version;
          currentMajor.current = data.major || 0;
          return;
        }
        if (data.version === currentVersion.current) return;

        if (data.major && data.major > currentMajor.current) {
          if (active) {
            setForceUpdate(true);
            setUpdateAvailable(true);
          }
          setTimeout(() => window.location.reload(), 10000);
          return;
        }

        if (data.version !== dismissedVersion.current) {
          if (active) setUpdateAvailable(true);
        }

        if (dismissCount.current >= 3) {
          window.location.reload();
        }
      } catch {}
    }

    fetchVersion();
    const id = setInterval(fetchVersion, CHECK_INTERVAL);
    return () => { active = false; clearInterval(id); };
  }, []);

  const applyUpdate = () => {
    window.location.reload();
  };

  const dismissUpdate = () => {
    dismissCount.current += 1;
    dismissedVersion.current = currentVersion.current;
    setUpdateAvailable(false);
  };

  return { updateAvailable, forceUpdate, applyUpdate, dismissUpdate };
}
