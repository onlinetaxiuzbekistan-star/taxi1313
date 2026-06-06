import { db, usersTable, ridesTable } from "@workspace/db";
import { clog } from "./logger.js";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { getSettingBool, getSettingNum } from "./settingsCache.js";

type RevenueStrategyMode = "aggressive" | "conservative" | "surge_heavy";

interface DriverProdRanking {
  driverId: number;
  acceptance_rate: number;
  avg_response_ms: number;
  completion_rate: number;
  idle_time_pct: number;
  priority_score: number;
  is_idle: boolean;
}

interface RevenueAIProdState {
  enabled: boolean;
  mode: RevenueStrategyMode;
  surge_multiplier: number;
  demand_supply_ratio: number;
  revenue_per_minute: number;
  driver_utilization_pct: number;
  total_revenue: number;
  completed_rides: number;
}

const SURGE_MAX = 2.0;
const SURGE_MIN = 0.9;
const SURGE_STEP = 0.05;
const SURGE_THRESHOLD = 1.2;
const EVAL_INTERVAL_MS = 20_000;
const LOG_MAX = 100;
const MIN_DRIVER_FLOOR_PCT = 0.15;

const FAIRNESS_STARVATION_MS = 5 * 60_000;
const SURGE_MAX_INCREASE_PER_MIN = 0.15;
const KILL_SWITCH_ACCEPT_DROP_PCT = 20;
const KILL_SWITCH_REVENUE_DROP_PCT = 15;
const DIVERSITY_INJECTION_PCT = 0.25;
const SHADOW_LOG_MAX = 50;

let prodRevenueEnabled = false;
let prodCurrentMode: RevenueStrategyMode = "conservative";
let prodSurgeMultiplier = 1.0;
let prodLastEvalAt = 0;
let prodStartedAt = 0;
let prodTotalRevenue = 0;
let prodCompletedRides = 0;
let prodDemandSupplyRatio = 0;
let prodDriverUtilization = 0;
const prodLogs: string[] = [];

let shadowModeEnabled = false;
const shadowLogs: string[] = [];
let safetyBlockCount = 0;
let fairnessAppliedCount = 0;
let diversityInjectedCount = 0;
let killSwitchTriggered = false;
let killSwitchReason = "";
let surgeLastChangeAt = 0;
let surgeChangeAccum = 0;

interface SafetyGuardState {
  shadow_mode: boolean;
  kill_switch_triggered: boolean;
  kill_switch_reason: string;
  safety_blocks: number;
  fairness_applied: number;
  diversity_injected: number;
  starved_drivers: number;
  surge_rate_limited: boolean;
  shadow_logs: string[];
}

interface ProdStrategyResult {
  mode: RevenueStrategyMode;
  score: number;
  revenue_delta_pct: number;
  utilization_delta_pct: number;
  evaluated_at: string;
}
const prodStrategyHistory: ProdStrategyResult[] = [];
const STRATEGY_HISTORY_MAX = 50;
const prodSnapshots: { ts: number; revenue: number; rides: number; utilization: number; acceptance_rate: number }[] = [];
const SNAPSHOTS_MAX = 50;

interface DriverAcceptStats {
  totalOffers: number;
  accepts: number;
  rejects: number;
  totalResponseMs: number;
  responseCount: number;
  completedRides: number;
  lastActiveAt: number;
  lastOfferAt: number;
  busyTicks: number;
  totalTicks: number;
}
const driverProdStats = new Map<number, DriverAcceptStats>();
const DRIVER_STATS_MAX = 500;
const DRIVER_STATS_TTL_MS = 24 * 60 * 60 * 1000;

let statsCleanupTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  const now = Date.now();
  for (const [id, stats] of driverProdStats) {
    if (now - stats.lastActiveAt > DRIVER_STATS_TTL_MS) {
      driverProdStats.delete(id);
    }
  }
}, 5 * 60_000);

export function stopRevenueAiCleanup(): void {
  if (statsCleanupTimer) { clearInterval(statsCleanupTimer); statsCleanupTimer = null; }
}

import { registerCache } from "./memory-guardian.js";
registerCache(() => {
  const before = driverProdStats.size;
  const now = Date.now();
  for (const [id, stats] of driverProdStats) {
    if (now - stats.lastActiveAt > DRIVER_STATS_TTL_MS / 2) {
      driverProdStats.delete(id);
    }
  }
  while (driverProdStats.size > DRIVER_STATS_MAX / 2) {
    const oldest = [...driverProdStats.entries()].sort((a, b) => a[1].lastActiveAt - b[1].lastActiveAt)[0];
    if (oldest) driverProdStats.delete(oldest[0]);
    else break;
  }
  const cleared = before - driverProdStats.size;
  prodLogs.splice(0, Math.max(0, prodLogs.length - 20));
  shadowLogs.splice(0, Math.max(0, shadowLogs.length - 10));
  prodStrategyHistory.splice(0, Math.max(0, prodStrategyHistory.length - 10));
  prodSnapshots.splice(0, Math.max(0, prodSnapshots.length - 10));
  return { name: "revenue-ai", cleared };
});

function prodLog(msg: string) {
  const entry = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  prodLogs.push(entry);
  if (prodLogs.length > LOG_MAX) prodLogs.splice(0, prodLogs.length - LOG_MAX);
  clog.log(`[REVENUE AI PROD] ${msg}`);
}

function safetyLog(msg: string) {
  const entry = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  prodLogs.push(entry);
  if (prodLogs.length > LOG_MAX) prodLogs.splice(0, prodLogs.length - LOG_MAX);
  clog.log(`[SAFETY] ${msg}`);
}

function shadowLog(msg: string) {
  const entry = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  shadowLogs.push(entry);
  if (shadowLogs.length > SHADOW_LOG_MAX) shadowLogs.splice(0, shadowLogs.length - SHADOW_LOG_MAX);
  clog.log(`[SHADOW] ${msg}`);
}

export function isRevenueAIProdEnabled(): boolean {
  return getSettingBool("revenue_ai_enabled", true) && prodRevenueEnabled;
}

export function isShadowMode(): boolean {
  return shadowModeEnabled;
}

export function enableRevenueAIProd() {
  if (prodRevenueEnabled) return;
  prodRevenueEnabled = true;
  prodStartedAt = Date.now();
  killSwitchTriggered = false;
  killSwitchReason = "";
  prodLog("Revenue AI PROD activated");
}

export function disableRevenueAIProd() {
  if (!prodRevenueEnabled) return;
  prodRevenueEnabled = false;
  prodLog("Revenue AI PROD deactivated");
}

export function toggleShadowMode(enabled: boolean) {
  shadowModeEnabled = enabled;
  if (enabled) {
    safetyLog("shadow mode ENABLED — logging decisions without applying");
  } else {
    safetyLog("shadow mode DISABLED — applying decisions normally");
  }
}

export function getRevenueAIProdMode(): RevenueStrategyMode {
  return prodCurrentMode;
}

export function getRevenueAIProdSurge(): number {
  if (!isRevenueAIProdEnabled()) return 1.0;
  if (shadowModeEnabled) return 1.0;
  return prodSurgeMultiplier;
}

export function getRevenueAIProdState(): RevenueAIProdState {
  return {
    enabled: prodRevenueEnabled,
    mode: prodCurrentMode,
    surge_multiplier: prodSurgeMultiplier,
    demand_supply_ratio: prodDemandSupplyRatio,
    revenue_per_minute: prodStartedAt > 0
      ? Math.round(prodTotalRevenue / Math.max(1, (Date.now() - prodStartedAt) / 60000))
      : 0,
    driver_utilization_pct: prodDriverUtilization,
    total_revenue: prodTotalRevenue,
    completed_rides: prodCompletedRides,
  };
}

export function getSafetyGuardState(): SafetyGuardState {
  const now = Date.now();
  let starvedCount = 0;
  for (const stats of driverProdStats.values()) {
    if (now - stats.lastActiveAt > 10 * 60_000) continue;
    if (now - stats.lastOfferAt > FAIRNESS_STARVATION_MS) starvedCount++;
  }

  return {
    shadow_mode: shadowModeEnabled,
    kill_switch_triggered: killSwitchTriggered,
    kill_switch_reason: killSwitchReason,
    safety_blocks: safetyBlockCount,
    fairness_applied: fairnessAppliedCount,
    diversity_injected: diversityInjectedCount,
    starved_drivers: starvedCount,
    surge_rate_limited: isSurgeRateLimited(),
    shadow_logs: [...shadowLogs],
  };
}

export function getRevenueAIProdLogs(): string[] {
  return [...prodLogs];
}

export function recordDriverOffer(driverId: number) {
  const stats = getOrCreateStats(driverId);
  stats.totalOffers++;
  stats.lastActiveAt = Date.now();
  stats.lastOfferAt = Date.now();
}

export function recordDriverAccept(driverId: number, responseMs: number) {
  const stats = getOrCreateStats(driverId);
  stats.accepts++;
  if (responseMs > 0) {
    stats.totalResponseMs += responseMs;
    stats.responseCount++;
  }
  stats.lastActiveAt = Date.now();
}

export function recordDriverReject(driverId: number) {
  const stats = getOrCreateStats(driverId);
  stats.rejects++;
  stats.lastActiveAt = Date.now();
}

export function recordRideCompleted(driverId: number, price: number) {
  const stats = getOrCreateStats(driverId);
  stats.completedRides++;
  stats.lastActiveAt = Date.now();

  prodCompletedRides++;
  prodTotalRevenue += price;

  updateProdCycle();
}

export function recordDriverBusyTick(driverId: number, isBusy: boolean) {
  const stats = getOrCreateStats(driverId);
  stats.totalTicks++;
  if (isBusy) stats.busyTicks++;
}

function getOrCreateStats(driverId: number): DriverAcceptStats {
  let stats = driverProdStats.get(driverId);
  if (!stats) {
    if (driverProdStats.size >= DRIVER_STATS_MAX) {
      pruneDriverStats();
    }
    stats = {
      totalOffers: 0,
      accepts: 0,
      rejects: 0,
      totalResponseMs: 0,
      responseCount: 0,
      completedRides: 0,
      lastActiveAt: Date.now(),
      lastOfferAt: Date.now(),
      busyTicks: 0,
      totalTicks: 0,
    };
    driverProdStats.set(driverId, stats);
  }
  return stats;
}

function pruneDriverStats() {
  const now = Date.now();
  for (const [id, stats] of driverProdStats) {
    if (now - stats.lastActiveAt > DRIVER_STATS_TTL_MS) {
      driverProdStats.delete(id);
    }
  }
  if (driverProdStats.size >= DRIVER_STATS_MAX) {
    const sorted = [...driverProdStats.entries()].sort((a, b) => a[1].lastActiveAt - b[1].lastActiveAt);
    const toRemove = sorted.slice(0, Math.floor(DRIVER_STATS_MAX * 0.2));
    for (const [id] of toRemove) driverProdStats.delete(id);
  }
}

function getGlobalAcceptanceRate(): number {
  let totalOffers = 0;
  let totalAccepts = 0;
  const now = Date.now();
  for (const stats of driverProdStats.values()) {
    if (now - stats.lastActiveAt > 10 * 60_000) continue;
    totalOffers += stats.totalOffers;
    totalAccepts += stats.accepts;
  }
  return totalOffers > 0 ? totalAccepts / totalOffers : 0.5;
}

function getStarvedDrivers(candidateIds: Set<number>): number[] {
  const now = Date.now();
  const starved: number[] = [];
  for (const [driverId, stats] of driverProdStats.entries()) {
    if (now - stats.lastActiveAt > 10 * 60_000) continue;
    if (candidateIds.has(driverId)) continue;
    if (now - stats.lastOfferAt > FAIRNESS_STARVATION_MS) {
      starved.push(driverId);
    }
  }
  return starved;
}

function isSurgeRateLimited(): boolean {
  const now = Date.now();
  const elapsedMin = (now - surgeLastChangeAt) / 60_000;
  if (elapsedMin < 1) {
    return surgeChangeAccum >= SURGE_MAX_INCREASE_PER_MIN;
  }
  return false;
}

export function reorderDriversForRevenue(
  driverIds: number[],
  driverStatusMap: Map<number, { isOnline: boolean; isBusy: boolean }>
): number[] {
  if (!isRevenueAIProdEnabled()) return driverIds;
  if (driverIds.length <= 1) return driverIds;

  const rankings: { driverId: number; score: number; isIdle: boolean }[] = [];

  for (const driverId of driverIds) {
    const stats = driverProdStats.get(driverId);
    const status = driverStatusMap.get(driverId);
    const isIdle = status ? status.isOnline && !status.isBusy : true;

    const totalDecisions = stats ? stats.accepts + stats.rejects : 0;
    const acceptanceRate = totalDecisions > 0 ? stats!.accepts / totalDecisions : 0.5;
    const avgResponseMs = stats && stats.responseCount > 0
      ? stats.totalResponseMs / stats.responseCount
      : 2000;
    const completionRate = stats && stats.accepts > 0
      ? stats.completedRides / stats.accepts
      : 0.5;
    const idleTimePct = stats && stats.totalTicks > 0
      ? ((stats.totalTicks - stats.busyTicks) / stats.totalTicks)
      : 0.5;

    let score = 0;
    switch (prodCurrentMode) {
      case "aggressive":
        score = acceptanceRate * 0.30
          + Math.max(0, 1 - avgResponseMs / 5000) * 0.30
          + completionRate * 0.25
          + (isIdle ? 0.15 : 0);
        break;
      case "conservative":
        score = acceptanceRate * 0.25
          + Math.max(0, 1 - avgResponseMs / 5000) * 0.20
          + completionRate * 0.30
          + (isIdle ? 0.25 : 0);
        break;
      case "surge_heavy":
        score = acceptanceRate * 0.40
          + Math.max(0, 1 - avgResponseMs / 5000) * 0.35
          + completionRate * 0.15
          + (isIdle ? 0.10 : 0);
        break;
    }

    rankings.push({ driverId, score: Math.round(score * 1000) / 1000, isIdle });
  }

  rankings.sort((a, b) => {
    if (a.isIdle !== b.isIdle) return a.isIdle ? -1 : 1;
    return b.score - a.score;
  });

  const minFloorCount = Math.max(1, Math.ceil(driverIds.length * MIN_DRIVER_FLOOR_PCT));
  const bottomDrivers = rankings.slice(-minFloorCount);
  const hasLowRanked = bottomDrivers.some(d => d.score < 0.3);

  if (hasLowRanked && rankings.length > 3) {
    const bottomOne = rankings.pop()!;
    const insertAt = Math.min(2, rankings.length);
    rankings.splice(insertAt, 0, bottomOne);
  }

  const candidateSet = new Set(driverIds);
  const starvedDrivers = getStarvedDrivers(candidateSet);
  let fairnessInserted = 0;
  for (const starvedId of starvedDrivers) {
    if (!rankings.some(r => r.driverId === starvedId)) {
      const insertPos = Math.min(1, rankings.length);
      rankings.splice(insertPos, 0, { driverId: starvedId, score: 0.5, isIdle: true });
      fairnessInserted++;
    }
  }
  if (fairnessInserted > 0) {
    fairnessAppliedCount += fairnessInserted;
    safetyLog(`fairness applied: ${fairnessInserted} starved drivers force-included`);
  }

  const totalCount = rankings.length;
  const diversityCount = Math.max(1, Math.ceil(totalCount * DIVERSITY_INJECTION_PCT));
  const aiSelected = rankings.slice(0, totalCount - diversityCount);
  const remainingPool = rankings.slice(totalCount - diversityCount);

  if (remainingPool.length > 1) {
    for (let i = remainingPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remainingPool[i], remainingPool[j]] = [remainingPool[j], remainingPool[i]];
    }
    diversityInjectedCount++;
  }

  const finalRankings = [...aiSelected, ...remainingPool];

  if (shadowModeEnabled) {
    const aiOrder = finalRankings.map(r => r.driverId);
    const originalOrder = driverIds;
    shadowLog(`reorder compare: AI=[${aiOrder.slice(0, 5).join(",")}...] vs original=[${originalOrder.slice(0, 5).join(",")}...]`);
    shadowLog(`mode=${prodCurrentMode}, fairness=${fairnessInserted}, diversity=${diversityCount}/${totalCount}`);
    prodLog(`[SHADOW] reordered ${totalCount} drivers (not applied)`);
    return driverIds;
  }

  const result = finalRankings.map(r => r.driverId);
  prodLog(`reordered ${result.length} drivers (mode=${prodCurrentMode}, idle_first=${finalRankings.filter(r => r.isIdle).length}, fair=${fairnessInserted}, div=${diversityCount})`);
  return result;
}

export function getDispatchMaxOffers(): number | null {
  if (!isRevenueAIProdEnabled()) return null;
  if (shadowModeEnabled) return null;

  switch (prodCurrentMode) {
    case "aggressive":
      return null;
    case "conservative":
      return 3;
    case "surge_heavy":
      return null;
  }
}

export function getDispatchTimeoutOverride(): number | null {
  if (!isRevenueAIProdEnabled()) return null;
  if (shadowModeEnabled) return null;

  switch (prodCurrentMode) {
    case "aggressive":
      return 10;
    case "conservative":
      return 20;
    case "surge_heavy":
      return 8;
  }
}

export function applySurgeToPrice(basePrice: number): { finalPrice: number; surgeMultiplier: number; surgeApplied: boolean } {
  if (!isRevenueAIProdEnabled()) {
    return { finalPrice: basePrice, surgeMultiplier: 1.0, surgeApplied: false };
  }

  if (shadowModeEnabled) {
    const mult = Math.min(SURGE_MAX, Math.max(SURGE_MIN, prodSurgeMultiplier));
    if (Math.abs(mult - 1.0) > 0.01) {
      shadowLog(`surge would apply ${mult.toFixed(2)} to price ${basePrice} → ${Math.round(basePrice * mult)} (not applied)`);
    }
    return { finalPrice: basePrice, surgeMultiplier: 1.0, surgeApplied: false };
  }

  const mult = Math.min(SURGE_MAX, Math.max(SURGE_MIN, prodSurgeMultiplier));
  const finalPrice = Math.round(basePrice * mult);

  if (Math.abs(mult - 1.0) > 0.01) {
    prodLog(`surge applied ${mult.toFixed(2)} to price ${basePrice} → ${finalPrice}`);
  }

  return { finalPrice, surgeMultiplier: mult, surgeApplied: Math.abs(mult - 1.0) > 0.01 };
}

function updateProdCycle() {
  if (!prodRevenueEnabled) return;

  const now = Date.now();

  let totalDrivers = 0;
  let busyDrivers = 0;
  for (const stats of driverProdStats.values()) {
    if (now - stats.lastActiveAt > 10 * 60_000) continue;
    totalDrivers++;
    if (stats.totalTicks > 0 && (stats.busyTicks / stats.totalTicks) > 0.5) {
      busyDrivers++;
    }
  }

  const idleDrivers = Math.max(0, totalDrivers - busyDrivers);
  const pendingEstimate = Math.max(0, prodCompletedRides > 0
    ? Math.round(totalDrivers * 0.1)
    : 0);
  const availableDrivers = Math.max(1, idleDrivers);
  prodDemandSupplyRatio = Math.round((pendingEstimate / availableDrivers) * 100) / 100;
  prodDriverUtilization = totalDrivers > 0
    ? Math.round((busyDrivers / totalDrivers) * 1000) / 10
    : 0;

  updateProdSurge();

  const globalAccRate = getGlobalAcceptanceRate();
  prodSnapshots.push({
    ts: now,
    revenue: prodTotalRevenue,
    rides: prodCompletedRides,
    utilization: prodDriverUtilization,
    acceptance_rate: globalAccRate,
  });
  if (prodSnapshots.length > 30) prodSnapshots.splice(0, prodSnapshots.length - 30);

  checkKillSwitch();
  evaluateProdStrategy();
}

function updateProdSurge() {
  const prev = prodSurgeMultiplier;
  let target = prodSurgeMultiplier;

  if (prodDemandSupplyRatio > SURGE_THRESHOLD) {
    const pressure = Math.min(1, (prodDemandSupplyRatio - SURGE_THRESHOLD) / 2);
    const desiredTarget = 1.0 + pressure * (SURGE_MAX - 1.0);
    target = Math.min(SURGE_MAX, prodSurgeMultiplier + SURGE_STEP);
    target = Math.min(target, desiredTarget);
  } else if (prodDemandSupplyRatio < 0.5) {
    target = Math.max(SURGE_MIN, prodSurgeMultiplier - SURGE_STEP * 0.5);
  } else {
    if (prodSurgeMultiplier > 1.0) {
      target = Math.max(1.0, prodSurgeMultiplier - SURGE_STEP * 0.3);
    } else if (prodSurgeMultiplier < 1.0) {
      target = Math.min(1.0, prodSurgeMultiplier + SURGE_STEP * 0.3);
    }
  }

  const now = Date.now();
  const elapsedMin = (now - surgeLastChangeAt) / 60_000;

  if (elapsedMin >= 1) {
    surgeChangeAccum = 0;
    surgeLastChangeAt = now;
  }

  const increase = target - prev;
  if (increase > 0) {
    const allowedIncrease = Math.max(0, SURGE_MAX_INCREASE_PER_MIN - surgeChangeAccum);
    if (allowedIncrease <= 0) {
      safetyLog(`surge rate limited: blocked +${increase.toFixed(3)} (accum=${surgeChangeAccum.toFixed(3)}/${SURGE_MAX_INCREASE_PER_MIN})`);
      return;
    }
    const clampedIncrease = Math.min(increase, allowedIncrease);
    target = prev + clampedIncrease;
    surgeChangeAccum += clampedIncrease;
  }

  prodSurgeMultiplier = Math.round(target * 100) / 100;
  prodSurgeMultiplier = Math.min(SURGE_MAX, Math.max(SURGE_MIN, prodSurgeMultiplier));

  if (Math.abs(prodSurgeMultiplier - prev) > 0.01) {
    prodLog(`surge changed ${prev.toFixed(2)} → ${prodSurgeMultiplier.toFixed(2)} (ratio=${prodDemandSupplyRatio})`);
  }
}

function checkKillSwitch() {
  if (killSwitchTriggered) return;
  if (prodSnapshots.length < 5) return;

  const recent = prodSnapshots.slice(-5);
  const older = prodSnapshots.slice(-10, -5);
  if (older.length < 3) return;

  const recentAccRate = recent.reduce((s, v) => s + v.acceptance_rate, 0) / recent.length;
  const olderAccRate = older.reduce((s, v) => s + v.acceptance_rate, 0) / older.length;
  const accDrop = olderAccRate > 0 ? ((olderAccRate - recentAccRate) / olderAccRate) * 100 : 0;

  const recentRevRate = recent.length > 1
    ? (recent[recent.length - 1].revenue - recent[0].revenue) / Math.max(1, (recent[recent.length - 1].ts - recent[0].ts) / 60_000)
    : 0;
  const olderRevRate = older.length > 1
    ? (older[older.length - 1].revenue - older[0].revenue) / Math.max(1, (older[older.length - 1].ts - older[0].ts) / 60_000)
    : 0;
  const revDrop = olderRevRate > 0 ? ((olderRevRate - recentRevRate) / olderRevRate) * 100 : 0;

  if (accDrop > KILL_SWITCH_ACCEPT_DROP_PCT) {
    killSwitchTriggered = true;
    killSwitchReason = `acceptance_rate dropped ${accDrop.toFixed(1)}% (>${KILL_SWITCH_ACCEPT_DROP_PCT}%)`;
    safetyLog(`KILL SWITCH: ${killSwitchReason}`);
    disableRevenueAIProd();
    safetyLog("fallback to default dispatch");
    return;
  }

  if (revDrop > KILL_SWITCH_REVENUE_DROP_PCT) {
    killSwitchTriggered = true;
    killSwitchReason = `revenue_rate dropped ${revDrop.toFixed(1)}% (>${KILL_SWITCH_REVENUE_DROP_PCT}%)`;
    safetyLog(`KILL SWITCH: ${killSwitchReason}`);
    disableRevenueAIProd();
    safetyLog("fallback to default dispatch");
    return;
  }
}

function simulateStrategyImpact(candidateMode: RevenueStrategyMode): { predicted_acc_rate: number; predicted_utilization: number; safe: boolean } {
  if (prodSnapshots.length < 3) return { predicted_acc_rate: 0.5, predicted_utilization: 50, safe: true };

  const recent = prodSnapshots.slice(-5);
  const currentAccRate = recent.reduce((s, v) => s + v.acceptance_rate, 0) / recent.length;
  const currentUtil = recent.reduce((s, v) => s + v.utilization, 0) / recent.length;

  let accImpact = 0;
  let utilImpact = 0;

  switch (candidateMode) {
    case "aggressive":
      accImpact = -0.05;
      utilImpact = 5;
      break;
    case "conservative":
      accImpact = 0.02;
      utilImpact = -2;
      break;
    case "surge_heavy":
      accImpact = -0.08;
      utilImpact = 3;
      break;
  }

  const predicted_acc_rate = Math.max(0, Math.min(1, currentAccRate + accImpact));
  const predicted_utilization = Math.max(0, Math.min(100, currentUtil + utilImpact));

  const safe = predicted_acc_rate >= 0.3 && predicted_utilization <= 95;

  return { predicted_acc_rate, predicted_utilization, safe };
}

function evaluateProdStrategy() {
  const now = Date.now();
  if (now - prodLastEvalAt < EVAL_INTERVAL_MS) return;
  prodLastEvalAt = now;

  if (prodSnapshots.length < 3) return;

  const windowSnaps = prodSnapshots.slice(-5);
  const first = windowSnaps[0];
  const last = windowSnaps[windowSnaps.length - 1];

  const revenueDelta = last.revenue > 0 && first.revenue > 0
    ? Math.round(((last.revenue - first.revenue) / Math.max(1, first.revenue)) * 1000) / 10
    : 0;
  const utilizationDelta = Math.round((last.utilization - first.utilization) * 10) / 10;

  const score =
    (revenueDelta > 0 ? 0.4 : -0.2) +
    (utilizationDelta > 0 ? 0.3 : -0.1) +
    ((last.rides - first.rides) > 0 ? 0.3 : -0.1);

  const result: ProdStrategyResult = {
    mode: prodCurrentMode,
    score: Math.round(score * 1000) / 1000,
    revenue_delta_pct: revenueDelta,
    utilization_delta_pct: utilizationDelta,
    evaluated_at: new Date().toISOString(),
  };

  prodStrategyHistory.push(result);
  if (prodStrategyHistory.length > 30) prodStrategyHistory.splice(0, prodStrategyHistory.length - 30);

  const modeScores: Record<RevenueStrategyMode, { total: number; count: number }> = {
    aggressive: { total: 0, count: 0 },
    conservative: { total: 0, count: 0 },
    surge_heavy: { total: 0, count: 0 },
  };
  for (const r of prodStrategyHistory) {
    modeScores[r.mode].total += r.score;
    modeScores[r.mode].count++;
  }

  let bestMode: RevenueStrategyMode = prodCurrentMode;
  let bestAvg = -Infinity;
  for (const mode of ["aggressive", "conservative", "surge_heavy"] as RevenueStrategyMode[]) {
    const ms = modeScores[mode];
    const avg = ms.count > 0 ? ms.total / ms.count : 0;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestMode = mode;
    }
  }

  if (prodStrategyHistory.length >= 3 && bestMode !== prodCurrentMode) {
    const impact = simulateStrategyImpact(bestMode);

    if (!impact.safe) {
      safetyBlockCount++;
      safetyLog(`strategy blocked: ${bestMode} predicted acc_rate=${(impact.predicted_acc_rate * 100).toFixed(1)}% util=${impact.predicted_utilization.toFixed(1)}%`);
      return;
    }

    if (shadowModeEnabled) {
      shadowLog(`strategy would switch: ${prodCurrentMode} → ${bestMode} (avg_score=${bestAvg.toFixed(3)}, predicted_acc=${(impact.predicted_acc_rate * 100).toFixed(1)}%)`);
      return;
    }

    const prev = prodCurrentMode;
    prodCurrentMode = bestMode;
    prodLog(`strategy=${bestMode} improved revenue (was=${prev}, avg_score=${bestAvg.toFixed(3)})`);
  }
}

export function resetRevenueAIProdState() {
  prodRevenueEnabled = false;
  prodCurrentMode = "conservative";
  prodSurgeMultiplier = 1.0;
  prodLastEvalAt = 0;
  prodStartedAt = 0;
  prodTotalRevenue = 0;
  prodCompletedRides = 0;
  prodDemandSupplyRatio = 0;
  prodDriverUtilization = 0;
  prodLogs.length = 0;
  prodStrategyHistory.length = 0;
  prodSnapshots.length = 0;
  driverProdStats.clear();

  shadowModeEnabled = false;
  shadowLogs.length = 0;
  safetyBlockCount = 0;
  fairnessAppliedCount = 0;
  diversityInjectedCount = 0;
  killSwitchTriggered = false;
  killSwitchReason = "";
  surgeLastChangeAt = 0;
  surgeChangeAccum = 0;
}
