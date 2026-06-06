import { Router, type IRouter } from "express";
import { clog } from "../../lib/logger.js";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { db, usersTable, ridesTable, orderOffersTable, transactionsTable, ridePassengersTable, marketplaceListingsTable, photoRequestsTable, driverAuditLogsTable } from "@workspace/db";
import { eq, and, ne, desc, sql, gte, lte, inArray, notInArray } from "drizzle-orm";
import { CITIES } from "../rides.js";
import { getOsrmRoute, haversineDistance } from "../../lib/osrm.js";
import { authMiddleware, requireRole, AuthRequest } from "../../middlewares/auth.js";
import { broadcastToAll, broadcastToUser } from "../../lib/websocket.js";
import { notifyOrderAccepted, notifyOrderTaken } from "../../lib/notifications.js";
import { applyCancelPenalty, resetConsecutiveIgnores, isDriverBanned, getBanRemainingMs, handleStatusToggle } from "../../lib/bonuses.js";
import { completeRide } from "../../lib/completion.js";
import { stopDispatchLoop, citiesMatch, enrichRideForOffer } from "../../lib/autodispatch.js";
import { getDriver, updateDriver, getDriverBalance } from "../../lib/services/drivers.service.js";
import { validateBody } from "../../middlewares/validate.js";
import { driverStatusBodySchema, driverLocationBodySchema } from "../../middlewares/request-schemas.js";
import { notifyRideStatusChange } from "../../lib/sms-notifications.js";
import { idempotencyKey, getIdempotentResult, storeIdempotentResult } from "../../lib/idempotency.js";
import { recordDriverAccept, recordDriverReject, recordRideCompleted } from "../../lib/revenue-ai-prod.js";
import { hashPassword } from "../auth.js";
import { generateReferralCode } from "../../lib/bonuses.js";
import { getSettingNum } from "../../lib/settingsCache.js";

export function parseBranchIdFromBody(body: any): number | null {
  const v = body?.branchId;
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export function checkMinBalance(balance: number, context: "online" | "accept"): string | null {
  const minBalance = getSettingNum("min_driver_balance", 0);
  if (balance >= minBalance) return null;
  const balStr = Math.floor(balance).toLocaleString("ru-RU");
  const minStr = minBalance.toLocaleString("ru-RU");
  return context === "online"
    ? `Баланс (${balStr} сум) ниже минимального (${minStr} сум). Пополните для выхода на линию.`
    : `Недостаточно средств (${balStr} сум). Минимум для работы: ${minStr} сум.`;
}

const __dirname_drivers = path.dirname(fileURLToPath(import.meta.url));
export const PHOTOS_DIR = path.resolve(process.cwd(), "artifacts", "uploads", "photos");
fs.mkdirSync(PHOTOS_DIR, { recursive: true });

export const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PHOTOS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
export const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"));
  },
});


export function enrichPassengersWithRouteInfo(passengers: any[], ride: any) {
  if (!ride) return passengers;
  const fromDisplay = ride.fromDistrictName
    ? `${ride.fromDistrictName} (${ride.fromCity})`
    : ride.fromCity;
  const toDisplay = ride.toDistrictName
    ? `${ride.toDistrictName} (${ride.toCity})`
    : ride.toCity;
  return passengers.map((p: any) => {
    const hasOwnPickup = p.pickupAddress && p.pickupAddress.trim() && p.pickupAddress !== ride.fromCity;
    const hasOwnDrop = p.dropoffAddress && p.dropoffAddress.trim() && p.dropoffAddress !== ride.toCity;
    return {
      ...p,
      pickupAddress: hasOwnPickup ? p.pickupAddress : fromDisplay,
      dropoffAddress: hasOwnDrop ? p.dropoffAddress : toDisplay,
      rideFromDistrictName: ride.fromDistrictName ?? null,
      rideToDistrictName: ride.toDistrictName ?? null,
      rideFromAddress: ride.fromAddress ?? null,
      rideToAddress: ride.toAddress ?? null,
    };
  });
}

export function nearestNeighborPickup<T extends { pickupLat: number | null; pickupLng: number | null }>(
  passengers: T[],
  startLat: number,
  startLng: number,
  endLat?: number | null,
  endLng?: number | null,
): T[] {
  const remaining = [...passengers];
  const sorted: T[] = [];
  let current = { lat: startLat, lng: startLng };

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      let d = haversineDistance(current.lat, current.lng, remaining[i].pickupLat!, remaining[i].pickupLng!);
      if (remaining.length <= 3 && endLat != null && endLng != null) {
        d += haversineDistance(remaining[i].pickupLat!, remaining[i].pickupLng!, endLat, endLng) * 0.3;
      }
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    sorted.push(next);
    current = { lat: next.pickupLat!, lng: next.pickupLng! };
  }

  if (sorted.length >= 3 && endLat != null && endLng != null) {
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < sorted.length - 1; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const before = totalRouteDistance(sorted, startLat, startLng, endLat, endLng);
          [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
          const after = totalRouteDistance(sorted, startLat, startLng, endLat, endLng);
          if (after < before) {
            improved = true;
          } else {
            [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
          }
        }
      }
    }
  }

  return sorted;
}

export function totalRouteDistance<T extends { pickupLat: number | null; pickupLng: number | null }>(
  order: T[],
  startLat: number,
  startLng: number,
  endLat: number | null,
  endLng: number | null,
): number {
  let dist = 0;
  let prev = { lat: startLat, lng: startLng };
  for (const p of order) {
    dist += haversineDistance(prev.lat, prev.lng, p.pickupLat!, p.pickupLng!);
    prev = { lat: p.pickupLat!, lng: p.pickupLng! };
  }
  if (endLat != null && endLng != null) {
    dist += haversineDistance(prev.lat, prev.lng, endLat, endLng);
  }
  return dist;
}

export function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([arr[i], ...perm]);
    }
  }
  return result;
}

export function optimizePickupOrder<T extends { pickupLat: number | null; pickupLng: number | null }>(
  passengers: T[],
  startLat: number,
  startLng: number,
  endLat: number | null,
  endLng: number | null,
): T[] {
  const perms = permutations(passengers);
  let bestOrder = passengers;
  let bestDist = Infinity;
  for (const perm of perms) {
    const d = totalRouteDistance(perm, startLat, startLng, endLat, endLng);
    if (d < bestDist) {
      bestDist = d;
      bestOrder = perm;
    }
  }
  return bestOrder;
}
