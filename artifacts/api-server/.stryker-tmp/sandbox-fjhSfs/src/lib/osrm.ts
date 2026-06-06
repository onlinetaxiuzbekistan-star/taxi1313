// @ts-nocheck
import { makeBreaker } from "./circuit.js";

const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";

const osrmBreaker = makeBreaker("osrm");

export interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { type: string; coordinates: [number, number][] };
}

export async function getOsrmRoute(
  points: { lat: number; lng: number }[]
): Promise<OsrmRoute | null> {
  if (points.length < 2) return null;

  const coords = points.map(p => `${p.lng},${p.lat}`).join(";");
  const url = `${OSRM_BASE}/${coords}?overview=full&geometries=geojson`;

  try {
    const resp = await osrmBreaker.execute(async () => {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`OSRM HTTP ${r.status}`);
      return r;
    });

    const data: any = await resp.json();
    if (data.code !== "Ok" || !data.routes?.length) return null;

    const route = data.routes[0];
    return {
      distance: Math.round(route.distance / 1000),
      duration: Math.round(route.duration / 60),
      geometry: route.geometry,
    };
  } catch {
    return null;
  }
}

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
