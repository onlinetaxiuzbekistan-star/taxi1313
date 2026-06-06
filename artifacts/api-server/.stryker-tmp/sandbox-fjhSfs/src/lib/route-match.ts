// @ts-nocheck
const CITIES: Record<string, { lat: number; lng: number }> = {
  bukhara: { lat: 39.7747, lng: 64.4286 },
  samarkand: { lat: 39.6542, lng: 66.9597 },
  tashkent: { lat: 41.2995, lng: 69.2401 },
  namangan: { lat: 41.0011, lng: 71.6726 },
  andijan: { lat: 40.7821, lng: 72.3442 },
  fergana: { lat: 40.3834, lng: 71.7864 },
  nukus: { lat: 42.4539, lng: 59.6104 },
  urgench: { lat: 41.5467, lng: 60.6339 },
  qarshi: { lat: 38.8604, lng: 65.7908 },
  termez: { lat: 37.2242, lng: 67.2783 },
  jizzakh: { lat: 40.1158, lng: 67.8422 },
  navoiy: { lat: 40.0840, lng: 65.3791 },
};

const CITY_NAME_MAP: Record<string, string> = {
  "ташкент": "tashkent", "toshkent": "tashkent",
  "фергана": "fergana", "farg'ona": "fergana",
  "андижан": "andijan", "andijon": "andijan",
  "самарканд": "samarkand", "samarqand": "samarkand",
  "бухара": "bukhara", "buxoro": "bukhara",
  "наманган": "namangan", "namangan": "namangan",
  "навои": "navoiy", "navoiy": "navoiy",
  "термез": "termez", "termiz": "termez",
  "нукус": "nukus", "nukus": "nukus",
  "ургенч": "urgench", "urganch": "urgench",
  "джизак": "jizzakh", "jizzax": "jizzakh",
  "карши": "qarshi", "qarshi": "qarshi",
};

export function resolveCitySlug(name: string): string {
  const lower = name.toLowerCase().trim();
  return CITY_NAME_MAP[lower] || lower;
}

export function getCityCoord(cityName: string): { lat: number; lng: number } | null {
  const slug = resolveCitySlug(cityName);
  return CITIES[slug] || null;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const AVG_SPEED_KMH = 60;

export type MatchPriority = "exact" | "partial" | "detour";

export interface RouteMatchResult {
  priority: MatchPriority;
  extraDistanceKm: number;
  extraTimeMin: number;
  score: number;
}

function pointProgressAlongLine(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  point: { lat: number; lng: number },
): number {
  const dx = end.lng - start.lng;
  const dy = end.lat - start.lat;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  const t = ((point.lng - start.lng) * dx + (point.lat - start.lat) * dy) / lenSq;
  return Math.max(0, Math.min(1, t));
}

function perpendicularDistKm(
  lineStart: { lat: number; lng: number },
  lineEnd: { lat: number; lng: number },
  point: { lat: number; lng: number },
): number {
  const t = pointProgressAlongLine(lineStart, lineEnd, point);
  const projLat = lineStart.lat + t * (lineEnd.lat - lineStart.lat);
  const projLng = lineStart.lng + t * (lineEnd.lng - lineStart.lng);
  return haversineKm(point.lat, point.lng, projLat, projLng);
}

export function matchRoute(
  driverFromCity: string,
  driverToCity: string,
  riderFromCity: string,
  riderToCity: string,
  maxDetourKm: number = 20,
  maxDetourMin: number = 25,
): RouteMatchResult | null {
  const driverFromSlug = resolveCitySlug(driverFromCity);
  const driverToSlug = resolveCitySlug(driverToCity);
  const riderFromSlug = resolveCitySlug(riderFromCity);
  const riderToSlug = resolveCitySlug(riderToCity);

  if (driverFromSlug === riderFromSlug && driverToSlug === riderToSlug) {
    return { priority: "exact", extraDistanceKm: 0, extraTimeMin: 0, score: 100 };
  }

  // STRICT: city of departure MUST match (no detour-pickup from other cities).
  // Prevents Ferghana driver from receiving Namangan→Tashkent orders.
  if (driverFromSlug !== riderFromSlug) {
    return null;
  }

  const driverFrom = getCityCoord(driverFromSlug);
  const driverTo = getCityCoord(driverToSlug);
  const riderFrom = getCityCoord(riderFromSlug);
  const riderTo = getCityCoord(riderToSlug);

  if (!driverFrom || !driverTo || !riderFrom || !riderTo) return null;

  const directKm = haversineKm(driverFrom.lat, driverFrom.lng, driverTo.lat, driverTo.lng);
  const detourKm =
    haversineKm(driverFrom.lat, driverFrom.lng, riderFrom.lat, riderFrom.lng) +
    haversineKm(riderFrom.lat, riderFrom.lng, riderTo.lat, riderTo.lng) +
    haversineKm(riderTo.lat, riderTo.lng, driverTo.lat, driverTo.lng) -
    directKm;

  const extraKm = Math.max(0, detourKm);
  const extraMin = (extraKm / AVG_SPEED_KMH) * 60;

  if (extraKm > maxDetourKm || extraMin > maxDetourMin) return null;

  const pickupProgress = pointProgressAlongLine(driverFrom, driverTo, riderFrom);
  const dropoffProgress = pointProgressAlongLine(driverFrom, driverTo, riderTo);
  if (dropoffProgress < pickupProgress) return null;

  const fromExact = driverFromSlug === riderFromSlug;
  const toExact = driverToSlug === riderToSlug;

  let priority: MatchPriority;
  if (fromExact || toExact) {
    priority = "partial";
  } else {
    priority = "detour";
  }

  const priorityScore = priority === "partial" ? 70 : 40;
  const detourPenalty = extraMin * 2;
  const score = Math.max(1, priorityScore - detourPenalty);

  return { priority, extraDistanceKm: extraKm, extraTimeMin: extraMin, score };
}
