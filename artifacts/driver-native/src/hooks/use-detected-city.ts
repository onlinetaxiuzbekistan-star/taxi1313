import { useEffect, useState } from "react";

import { addLocationListener } from "@/native/background";
import { nearestCityId } from "@/lib/geo-cities";
import type { City } from "@/features/orders/types";

// Resolves the driver's CURRENT origin city from the live GPS fix emitted by the
// native foreground service (Android). Offline — matches the fix to the nearest
// known city in `cities`. Returns the city id, or null until a fix arrives.
//
// This overrides any stale profile `city` field, fixing "I'm in Fergana but it
// shows Tashkent": the origin follows where the phone actually is.
export function useDetectedCity(cities: City[]): string | null {
  const [detected, setDetected] = useState<string | null>(null);

  useEffect(() => {
    if (cities.length === 0) return;
    const sub = addLocationListener((e) => {
      const lat = (e as any)?.latitude ?? (e as any)?.lat;
      const lng = (e as any)?.longitude ?? (e as any)?.lng;
      if (typeof lat !== "number" || typeof lng !== "number") return;
      const id = nearestCityId(lat, lng, cities as any);
      if (id) setDetected((prev) => prev ?? id); // first solid fix wins
    });
    return () => sub.remove();
  }, [cities]);

  return detected;
}
