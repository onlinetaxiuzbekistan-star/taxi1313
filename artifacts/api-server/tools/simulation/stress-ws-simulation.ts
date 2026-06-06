import { db, usersTable, ridesTable, orderOffersTable, ridePassengersTable, settingsTable } from "@workspace/db";
import { eq, and, inArray, sql, like, gte } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../../src/lib/jwt-secret.js";
import { WebSocket } from "ws";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

export interface LiveStressMetrics {
  running: boolean;
  current_phase: string;
  phase_elapsed_s: number;
  rides_created: number;
  offers_received: number;
  accepted: number;
  failed: number;
  success_rate: number;
  avg_response_time: number;
  ws_errors: number;
  ws_connections: number;
  critical_bugs: number;
  chaos_offline_toggles: number;
  chaos_cancels: number;
  rides_per_minute: number;
  updated_at: string;
}

type AlertLevel = "info" | "warning" | "critical" | "emergency";
type AlertType = "success_rate" | "latency" | "ws_drop" | "critical_bug" | "ws_errors" | "recovery";
type AlertReason = "drivers_offline" | "low_accept_rate" | "high_latency" | "websocket_drop" | "critical_bug" | "ws_errors" | "unknown";
type AlertRouting = "dashboard" | "dashboard+telegram" | "dashboard+telegram+sms";

export interface StressAlert {
  id: string;
  type: AlertType;
  severity: AlertLevel;
  level: AlertLevel;
  message: string;
  value: number;
  threshold: number;
  phase: string;
  timestamp: string;
  acknowledged: boolean;
  duration: number;
  avg_value: number;
  count: number;
  reason: AlertReason;
  routing: AlertRouting;
  incident_id: string;
}

type RootCause = "driver_availability_issue" | "backend_overload" | "connection_issue" | "critical_failure" | "unknown";

export interface Incident {
  id: string;
  type: AlertType;
  start_time: string;
  last_update: string;
  max_severity: AlertLevel;
  active: boolean;
  reason: AlertReason;
  root_cause: RootCause;
  alert_count: number;
  avg_value: number;
  duration_s: number;
  recovery_actions: string[];
  recovered_by: string;
  playbook_step: number;
}

export const liveIncidents: Incident[] = [];

export const liveMetrics: LiveStressMetrics = {
  running: false,
  current_phase: "idle",
  phase_elapsed_s: 0,
  rides_created: 0,
  offers_received: 0,
  accepted: 0,
  failed: 0,
  success_rate: 0,
  avg_response_time: 0,
  ws_errors: 0,
  ws_connections: 0,
  critical_bugs: 0,
  chaos_offline_toggles: 0,
  chaos_cancels: 0,
  rides_per_minute: 0,
  updated_at: new Date().toISOString(),
};

export interface RecoveryAction {
  id: string;
  type: RecoveryType;
  trigger: string;
  message: string;
  detail: string;
  timestamp: string;
  result: "pending" | "success" | "failed";
  duration_ms: number;
  metrics_before?: MetricsSnapshot;
  metrics_after?: MetricsSnapshot;
  effectiveness?: number;
}

type RecoveryType = "ws_reconnect" | "dispatch_restart" | "load_reduce";

interface MetricsSnapshot {
  success_rate: number;
  avg_latency: number;
  ws_connections: number;
  rides_created: number;
  accepted: number;
}

type ContextBucket = "low_load" | "mid_load" | "high_load";
type TimeBucket = "morning" | "day" | "evening" | "night";

interface ContextScore {
  bucket: ContextBucket;
  uses: number;
  avg_effectiveness: number;
  avg_sr_delta: number;
  avg_latency_delta: number;
  entries: EffectivenessEntry[];
}

interface ObjectiveScores {
  health: number;
  completion: number;
  earnings: number;
  combined: number;
}

interface ActionScore {
  type: RecoveryType;
  total_uses: number;
  successful: number;
  failed: number;
  skipped: number;
  explored: number;
  avg_effectiveness: number;
  avg_sr_delta: number;
  avg_latency_delta: number;
  best_effectiveness: number;
  worst_effectiveness: number;
  current_cooldown_ms: number;
  base_cooldown_ms: number;
  enabled: boolean;
  history: EffectivenessEntry[];
  context_scores: ContextScore[];
  objective_impact: ObjectiveScores;
}

interface EffectivenessEntry {
  timestamp: string;
  effectiveness: number;
  sr_delta: number;
  latency_delta: number;
  result: string;
  context?: ContextBucket;
  time_bucket?: TimeBucket;
  objectives?: ObjectiveScores;
}

export interface HealthScore {
  value: number;
  sr_component: number;
  latency_component: number;
  ws_component: number;
  trend: "improving" | "stable" | "degrading";
}

type DriverTier = "top" | "good" | "average" | "poor";

interface DriverBehaviorProfile {
  driverId: number;
  city: string;
  tier: DriverTier;
  acceptRate: number;
  avgResponseMs: number;
  totalOffers: number;
  totalAccepts: number;
  totalRejects: number;
  idleTimeRatio: number;
  revenueProxy: number;
  ridesCompleted: number;
  onlineRatio: number;
  score: number;
}

interface ProfitMetrics {
  ridesPerHour: number;
  revenueProxy: number;
  driverUtilization: number;
  idleDriversPct: number;
  avgRevenuePerRide: number;
  totalRevenue: number;
  activeDrivers: number;
  busyDrivers: number;
  idleDrivers: number;
  trend: "growing" | "stable" | "declining";
}

interface DemandPrediction {
  corridor: string;
  fromCity: string;
  toCity: string;
  currentDemand: number;
  predictedDemand: number;
  confidence: number;
  timeFactor: number;
  historyFactor: number;
  trend: "rising" | "stable" | "falling";
  hotspot: boolean;
}

interface GenerationSnapshot {
  generation: number;
  timestamp: string;
  health: number;
  objectives: ObjectiveScores;
  profitMetrics: ProfitMetrics;
  totalActions: number;
  totalEffective: number;
  avgEffectiveness: number;
  driverTierDistribution: Record<DriverTier, number>;
  topCorridors: string[];
  score: number;
}

export interface OptimizationState {
  scores: ActionScore[];
  decisions: OptDecision[];
  generation: number;
  total_actions: number;
  total_effective: number;
  total_ineffective: number;
  total_explored: number;
  learning_rate: number;
  exploration_rate: number;
  health: HealthScore;
  context_bucket: ContextBucket;
  time_bucket: TimeBucket;
  objectives: ObjectiveScores;
  recent_actions: RecentAction[];
  multi_action_count: number;
  profit: ProfitMetrics;
  driver_model: DriverBehaviorProfile[];
  demand_predictions: DemandPrediction[];
  generation_snapshots: GenerationSnapshot[];
  best_generation: number;
}

interface RecentAction {
  type: RecoveryType;
  timestamp: string;
  effectiveness: number;
}

interface OptDecision {
  id: string;
  timestamp: string;
  type: RecoveryType | "multi";
  decision: "execute" | "skip" | "cooldown_adjusted" | "explore" | "best_pick" | "multi_action" | "repetition_penalty";
  reason: string;
  score_at_time: number;
  context?: ContextBucket;
  time_context?: TimeBucket;
  health_at_time?: number;
  candidates?: { type: RecoveryType; score: number }[];
  objectives?: ObjectiveScores;
  executed_actions?: RecoveryType[];
}

const OPTIMIZER_FILE = "stress-optimizer.json";

function takeSnapshot(): MetricsSnapshot {
  return {
    success_rate: liveMetrics.success_rate,
    avg_latency: liveMetrics.avg_response_time,
    ws_connections: liveMetrics.ws_connections,
    rides_created: liveMetrics.rides_created,
    accepted: liveMetrics.accepted,
  };
}

const BASE_COOLDOWNS: Record<RecoveryType, number> = {
  ws_reconnect: 30_000,
  dispatch_restart: 30_000,
  load_reduce: 20_000,
};

const EXPLORATION_RATE = 0.10;
const ALL_RECOVERY_TYPES: RecoveryType[] = ["ws_reconnect", "dispatch_restart", "load_reduce"];
const actionScores: Map<RecoveryType, ActionScore> = new Map();
const optimizationDecisions: OptDecision[] = [];
let optimizationGeneration = 0;
let decisionIdCounter = 0;
const healthHistory: number[] = [];
let lastDecisionEngineAt = 0;
const recentActionMemory: RecentAction[] = [];
let multiActionCount = 0;

const generationSnapshots: GenerationSnapshot[] = [];
let bestGenerationIdx = -1;
const driverBehaviorStats: Map<number, { offers: number; accepts: number; rejects: number; responseTimes: number[]; busyTicks: number; totalTicks: number; ridesCompleted: number }> = new Map();
const corridorDemandHistory: Map<string, { counts: number[]; timestamps: number[] }> = new Map();
let profitHistory: number[] = [];
let lastProfitSampleAt = 0;

const OBJECTIVE_WEIGHTS = { health: 0.40, completion: 0.35, earnings: 0.25 };

function getTimeBucket(): TimeBucket {
  const h = new Date().getHours();
  if (h >= 6 && h < 11) return "morning";
  if (h >= 11 && h < 17) return "day";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

function computeObjectives(): ObjectiveScores {
  const sr = liveMetrics.success_rate;
  const lat = liveMetrics.avg_response_time;
  const totalWs = liveDrivers.length;
  const connWs = liveMetrics.ws_connections;
  const wsPct = totalWs > 0 ? connWs / totalWs : 1;

  const healthObj = Math.max(0, Math.min(1, (sr / 100) * 0.4 + (1 - Math.min(lat, 2000) / 2000) * 0.3 + wsPct * 0.3));

  const completionRate = liveMetrics.rides_created > 0
    ? liveMetrics.accepted / liveMetrics.rides_created
    : 1;
  const completionObj = Math.max(0, Math.min(1, completionRate));

  const busyDrivers = liveDrivers.filter(d => d.isBusy).length;
  const earningsProxy = totalWs > 0
    ? (busyDrivers / totalWs) * 0.6 + completionRate * 0.4
    : 0;
  const earningsObj = Math.max(0, Math.min(1, earningsProxy));

  const combined = healthObj * OBJECTIVE_WEIGHTS.health +
    completionObj * OBJECTIVE_WEIGHTS.completion +
    earningsObj * OBJECTIVE_WEIGHTS.earnings;

  return {
    health: Math.round(healthObj * 1000) / 1000,
    completion: Math.round(completionObj * 1000) / 1000,
    earnings: Math.round(earningsObj * 1000) / 1000,
    combined: Math.round(combined * 1000) / 1000,
  };
}

function getRepetitionPenalty(type: RecoveryType): number {
  const recent = recentActionMemory.slice(-10);
  if (recent.length === 0) return 0;
  const sameTypeCount = recent.filter(a => a.type === type).length;
  if (sameTypeCount === 0) return 0;

  const consecutiveFromEnd = (() => {
    let count = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i].type === type) count++;
      else break;
    }
    return count;
  })();

  const frequencyPenalty = (sameTypeCount / recent.length) * 0.15;
  const consecutivePenalty = consecutiveFromEnd * 0.1;

  const recentEffOfSameType = recent.filter(a => a.type === type);
  const avgEff = recentEffOfSameType.reduce((s, a) => s + a.effectiveness, 0) / recentEffOfSameType.length;
  const ineffectivePenalty = avgEff < 0 ? 0.1 : 0;

  return Math.min(0.4, frequencyPenalty + consecutivePenalty + ineffectivePenalty);
}

function pushRecentAction(type: RecoveryType, effectiveness: number) {
  recentActionMemory.push({ type, timestamp: new Date().toISOString(), effectiveness });
  if (recentActionMemory.length > 10) recentActionMemory.splice(0, recentActionMemory.length - 10);
}

function initScore(type: RecoveryType): ActionScore {
  return {
    type,
    total_uses: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    explored: 0,
    avg_effectiveness: 0,
    avg_sr_delta: 0,
    avg_latency_delta: 0,
    best_effectiveness: -Infinity,
    worst_effectiveness: Infinity,
    current_cooldown_ms: BASE_COOLDOWNS[type],
    base_cooldown_ms: BASE_COOLDOWNS[type],
    enabled: true,
    history: [],
    context_scores: [],
    objective_impact: { health: 0, completion: 0, earnings: 0, combined: 0 },
  };
}

function getScore(type: RecoveryType): ActionScore {
  if (!actionScores.has(type)) actionScores.set(type, initScore(type));
  return actionScores.get(type)!;
}

function getContextBucket(): ContextBucket {
  const totalDrivers = liveDrivers.length;
  const connectedDrivers = liveDrivers.filter(d => d.wsConnected).length;
  const rpm = liveMetrics.rides_per_minute;
  const loadSignal = rpm + (totalDrivers - connectedDrivers) * 2;
  if (loadSignal < 5 && totalDrivers < 10) return "low_load";
  if (loadSignal > 20 || totalDrivers > 30) return "high_load";
  return "mid_load";
}

let lastHealthCommitAt = 0;

function computeHealthScore(): HealthScore {
  const sr = liveMetrics.success_rate;
  const lat = liveMetrics.avg_response_time;
  const totalWs = liveDrivers.length;
  const connWs = liveMetrics.ws_connections;
  const wsPct = totalWs > 0 ? (connWs / totalWs) * 100 : 100;

  const srComp = Math.max(0, Math.min(1, sr / 100));
  const latComp = Math.max(0, Math.min(1, 1 - (Math.min(lat, 2000) / 2000)));
  const wsComp = Math.max(0, Math.min(1, wsPct / 100));

  const value = Math.round((srComp * 0.45 + latComp * 0.30 + wsComp * 0.25) * 1000) / 1000;

  const now = Date.now();
  if (now - lastHealthCommitAt >= 3000) {
    lastHealthCommitAt = now;
    healthHistory.push(value);
    if (healthHistory.length > 20) healthHistory.splice(0, healthHistory.length - 20);
  }

  let trend: "improving" | "stable" | "degrading" = "stable";
  if (healthHistory.length >= 4) {
    const recent = healthHistory.slice(-4);
    const slope = (recent[3] - recent[0]) / 3;
    if (slope > 0.02) trend = "improving";
    else if (slope < -0.02) trend = "degrading";
  }

  return { value, sr_component: srComp, latency_component: latComp, ws_component: wsComp, trend };
}

function pushDecision(
  type: RecoveryType | "multi",
  decision: OptDecision["decision"],
  reason: string,
  score: number,
  extra?: Partial<Pick<OptDecision, "context" | "time_context" | "health_at_time" | "candidates" | "objectives" | "executed_actions">>
) {
  decisionIdCounter++;
  const entry: OptDecision = {
    id: `opt-${decisionIdCounter}`,
    timestamp: new Date().toISOString(),
    type,
    decision,
    reason,
    score_at_time: Math.round(score * 100) / 100,
    ...extra,
  };
  optimizationDecisions.push(entry);
  if (optimizationDecisions.length > 150) optimizationDecisions.splice(0, optimizationDecisions.length - 150);
  console.log(`[ENGINE] ${decision.toUpperCase()} ${type}: ${reason} (score=${entry.score_at_time})`);
}

function getContextualScore(type: RecoveryType, ctx: ContextBucket): number {
  const score = getScore(type);
  const ctxEntry = score.context_scores.find(c => c.bucket === ctx);
  if (ctxEntry && ctxEntry.uses >= 2) {
    return ctxEntry.avg_effectiveness * 0.7 + score.avg_effectiveness * 0.3;
  }
  return score.avg_effectiveness;
}

function isCooldownReady(type: RecoveryType, lastExecAt: number): boolean {
  const score = getScore(type);
  return Date.now() - lastExecAt >= score.current_cooldown_ms;
}

function getLastExecTime(type: RecoveryType): number {
  switch (type) {
    case "ws_reconnect": return lastWsRecoveryAt;
    case "dispatch_restart": return lastDispatchRestartAt;
    case "load_reduce": return lastLoadReduceAt;
  }
}

function setLastExecTime(type: RecoveryType, t: number) {
  switch (type) {
    case "ws_reconnect": lastWsRecoveryAt = t; break;
    case "dispatch_restart": lastDispatchRestartAt = t; break;
    case "load_reduce": lastLoadReduceAt = t; break;
  }
}

interface RecoveryCandidate {
  type: RecoveryType;
  relevance: number;
  contextScore: number;
  objectiveScore: number;
  repetitionPenalty: number;
  timeBonus: number;
  finalScore: number;
}

function getTimeBonus(type: RecoveryType, timeBucket: TimeBucket): number {
  if (timeBucket === "morning" || timeBucket === "evening") {
    if (type === "dispatch_restart") return 0.08;
    if (type === "ws_reconnect") return 0.05;
  }
  if (timeBucket === "night") {
    if (type === "load_reduce") return 0.06;
  }
  if (timeBucket === "day") {
    if (type === "ws_reconnect") return 0.04;
    if (type === "dispatch_restart") return 0.06;
  }
  return 0;
}

function buildCandidates(triggeredTypes: RecoveryType[]): RecoveryCandidate[] {
  const ctx = getContextBucket();
  const health = computeHealthScore();
  const timeBucket = getTimeBucket();
  const objectives = computeObjectives();
  const candidates: RecoveryCandidate[] = [];

  for (const type of ALL_RECOVERY_TYPES) {
    const score = getScore(type);
    if (!score.enabled) continue;
    if (!isCooldownReady(type, getLastExecTime(type))) continue;

    const isTriggered = triggeredTypes.includes(type);
    const relevance = isTriggered ? 1.0 : 0.3;

    const ctxScore = getContextualScore(type, ctx);

    let urgencyBonus = 0;
    if (type === "ws_reconnect" && liveMetrics.ws_connections < liveDrivers.length * 0.5) urgencyBonus = 0.2;
    if (type === "dispatch_restart" && liveMetrics.success_rate < 50) urgencyBonus = 0.25;
    if (type === "load_reduce" && liveMetrics.avg_response_time > 1200) urgencyBonus = 0.15;

    const healthPenalty = health.trend === "improving" ? -0.1 : health.trend === "degrading" ? 0.1 : 0;

    let objectiveScore = 0;
    const impact = score.objective_impact;
    if (impact.combined !== 0 && score.total_uses >= 2) {
      if (objectives.health < 0.6) objectiveScore += impact.health * 0.15;
      if (objectives.completion < 0.7) objectiveScore += impact.completion * 0.12;
      if (objectives.earnings < 0.5) objectiveScore += impact.earnings * 0.08;
    }

    const repPenalty = getRepetitionPenalty(type);
    const timeBonus = getTimeBonus(type, timeBucket);

    const finalScore = relevance * 0.25 +
      Math.max(0, ctxScore + 0.5) * 0.25 +
      urgencyBonus +
      healthPenalty +
      objectiveScore +
      timeBonus -
      repPenalty;

    candidates.push({ type, relevance, contextScore: ctxScore, objectiveScore, repetitionPenalty: repPenalty, timeBonus, finalScore });
  }

  candidates.sort((a, b) => b.finalScore - a.finalScore);
  return candidates;
}

function isCriticalLoad(): boolean {
  const health = computeHealthScore();
  const objectives = computeObjectives();
  return health.value < 0.45 || (health.value < 0.6 && health.trend === "degrading") || objectives.combined < 0.35;
}

function decisionEngine(triggeredTypes: RecoveryType[]): RecoveryType | null {
  const now = Date.now();
  if (now - lastDecisionEngineAt < 5000) return null;
  lastDecisionEngineAt = now;

  const candidates = buildCandidates(triggeredTypes);
  if (candidates.length === 0) return null;

  const ctx = getContextBucket();
  const timeBucket = getTimeBucket();
  const health = computeHealthScore();
  const objectives = computeObjectives();
  const decisionExtra = {
    context: ctx, time_context: timeBucket, health_at_time: health.value, objectives,
    candidates: candidates.map(c => ({ type: c.type, score: Math.round(c.finalScore * 100) / 100 })),
  };

  if (health.value > 0.85 && health.trend !== "degrading" && objectives.combined > 0.75) {
    pushDecision(candidates[0].type, "skip",
      `Система стабильна: HP=${(health.value * 100).toFixed(0)}%, OBJ=${(objectives.combined * 100).toFixed(0)}%`,
      health.value, decisionExtra);
    return null;
  }

  if (isCriticalLoad() && candidates.length >= 2) {
    const toExecute = candidates.slice(0, Math.min(3, candidates.length)).filter(c => c.finalScore > 0.1);
    if (toExecute.length >= 2) {
      const executedTypes = toExecute.map(c => c.type);
      multiActionCount++;
      pushDecision("multi", "multi_action",
        `КРИТИЧЕСКАЯ НАГРУЗКА! HP=${(health.value * 100).toFixed(0)}%, OBJ=${(objectives.combined * 100).toFixed(0)}% — запуск ${executedTypes.length} действий: ${executedTypes.join(", ")}`,
        toExecute[0].finalScore,
        { ...decisionExtra, executed_actions: executedTypes });

      for (const c of toExecute) {
        setLastExecTime(c.type, now);
        switch (c.type) {
          case "ws_reconnect": autoRecoverWsConnections(liveDrivers); break;
          case "dispatch_restart": autoRestartDispatchCycle(); break;
          case "load_reduce": autoReduceLoad(); break;
        }
      }
      return null;
    }
  }

  if (candidates[0].repetitionPenalty > 0.15) {
    pushDecision(candidates[0].type, "repetition_penalty",
      `Штраф за повтор: ${candidates[0].type} penalty=${candidates[0].repetitionPenalty.toFixed(2)}, score после штрафа=${candidates[0].finalScore.toFixed(2)}`,
      candidates[0].finalScore, decisionExtra);
  }

  const isExploring = Math.random() < EXPLORATION_RATE && candidates.length > 1;

  if (isExploring) {
    const nonBest = candidates.slice(1);
    const pick = nonBest[Math.floor(Math.random() * nonBest.length)];
    const score = getScore(pick.type);
    score.explored++;
    pushDecision(pick.type, "explore",
      `Exploration! ${pick.type} вместо ${candidates[0].type} (best=${candidates[0].finalScore.toFixed(2)}) [${timeBucket}]`,
      pick.finalScore, decisionExtra);
    return pick.type;
  }

  const best = candidates[0];
  pushDecision(best.type, "best_pick",
    `Лучший: score=${best.finalScore.toFixed(2)}, obj_score=${best.objectiveScore.toFixed(3)}, rep_pen=${best.repetitionPenalty.toFixed(2)}, time=${timeBucket}, HP=${(health.value * 100).toFixed(0)}%, OBJ=${(objectives.combined * 100).toFixed(0)}%`,
    best.finalScore, decisionExtra);
  return best.type;
}

function recordEffectiveness(action: RecoveryAction) {
  if (!action.metrics_before || !action.metrics_after) return;

  const before = action.metrics_before;
  const after = action.metrics_after;

  const srDelta = after.success_rate - before.success_rate;
  const latDelta = before.avg_latency - after.avg_latency;
  const wsRecovery = before.ws_connections > 0
    ? (after.ws_connections - before.ws_connections) / Math.max(before.ws_connections, 1)
    : 0;

  let effectiveness = 0;
  switch (action.type) {
    case "ws_reconnect":
      effectiveness = wsRecovery * 0.5 + (srDelta / 100) * 0.3 + (latDelta / 1000) * 0.2;
      break;
    case "dispatch_restart":
      effectiveness = (srDelta / 100) * 0.6 + (latDelta / 1000) * 0.2 + wsRecovery * 0.2;
      break;
    case "load_reduce":
      effectiveness = (latDelta / 1000) * 0.6 + (srDelta / 100) * 0.3 + wsRecovery * 0.1;
      break;
  }

  if (action.result === "failed") effectiveness = Math.min(effectiveness, -0.1);

  action.effectiveness = Math.round(effectiveness * 1000) / 1000;

  const healthImpact = (srDelta / 100) * 0.4 + (latDelta / 1000) * 0.3 + wsRecovery * 0.3;
  const completionImpact = (srDelta / 100) * 0.7 + wsRecovery * 0.3;
  const earningsImpact = (srDelta / 100) * 0.5 + (latDelta / 1000) * 0.2 + wsRecovery * 0.3;
  const entryObjectives: ObjectiveScores = {
    health: Math.round(healthImpact * 1000) / 1000,
    completion: Math.round(completionImpact * 1000) / 1000,
    earnings: Math.round(earningsImpact * 1000) / 1000,
    combined: Math.round((healthImpact * OBJECTIVE_WEIGHTS.health + completionImpact * OBJECTIVE_WEIGHTS.completion + earningsImpact * OBJECTIVE_WEIGHTS.earnings) * 1000) / 1000,
  };

  const score = getScore(action.type);
  score.total_uses++;
  if (action.result === "success") score.successful++;
  else score.failed++;

  const ctx = getContextBucket();
  const timeBucket = getTimeBucket();
  const entry: EffectivenessEntry = {
    timestamp: action.timestamp,
    effectiveness: action.effectiveness,
    sr_delta: Math.round(srDelta * 10) / 10,
    latency_delta: Math.round(latDelta),
    result: action.result,
    context: ctx,
    time_bucket: timeBucket,
    objectives: entryObjectives,
  };
  score.history.push(entry);
  if (score.history.length > 30) score.history.splice(0, score.history.length - 30);

  const provisionalIdx = recentActionMemory.findIndex(a => a.type === action.type && a.effectiveness === 0);
  if (provisionalIdx >= 0) {
    recentActionMemory[provisionalIdx].effectiveness = action.effectiveness;
  } else {
    pushRecentAction(action.type, action.effectiveness);
  }

  let ctxEntry = score.context_scores.find(c => c.bucket === ctx);
  if (!ctxEntry) {
    ctxEntry = { bucket: ctx, uses: 0, avg_effectiveness: 0, avg_sr_delta: 0, avg_latency_delta: 0, entries: [] };
    score.context_scores.push(ctxEntry);
  }
  ctxEntry.entries.push(entry);
  ctxEntry.uses++;
  if (ctxEntry.entries.length > 15) ctxEntry.entries.splice(0, ctxEntry.entries.length - 15);

  const DECAY = 0.15;

  const recentWeights = score.history.map((_, i) => Math.pow(1 - DECAY, score.history.length - 1 - i));
  const totalWeight = recentWeights.reduce((s, w) => s + w, 0);
  score.avg_effectiveness = score.history.reduce((s, e, i) => s + e.effectiveness * recentWeights[i], 0) / totalWeight;
  score.avg_sr_delta = score.history.reduce((s, e, i) => s + e.sr_delta * recentWeights[i], 0) / totalWeight;
  score.avg_latency_delta = score.history.reduce((s, e, i) => s + e.latency_delta * recentWeights[i], 0) / totalWeight;

  const objEntries = score.history.filter(h => h.objectives);
  if (objEntries.length > 0) {
    const objWeights = objEntries.map((_, i) => Math.pow(1 - DECAY, objEntries.length - 1 - i));
    const objTotalW = objWeights.reduce((s, w) => s + w, 0);
    score.objective_impact = {
      health: Math.round(objEntries.reduce((s, e, i) => s + (e.objectives?.health || 0) * objWeights[i], 0) / objTotalW * 1000) / 1000,
      completion: Math.round(objEntries.reduce((s, e, i) => s + (e.objectives?.completion || 0) * objWeights[i], 0) / objTotalW * 1000) / 1000,
      earnings: Math.round(objEntries.reduce((s, e, i) => s + (e.objectives?.earnings || 0) * objWeights[i], 0) / objTotalW * 1000) / 1000,
      combined: Math.round(objEntries.reduce((s, e, i) => s + (e.objectives?.combined || 0) * objWeights[i], 0) / objTotalW * 1000) / 1000,
    };
  }

  const ctxWeights = ctxEntry.entries.map((_, i) => Math.pow(1 - DECAY, ctxEntry!.entries.length - 1 - i));
  const ctxTotalW = ctxWeights.reduce((s, w) => s + w, 0);
  ctxEntry.avg_effectiveness = ctxEntry.entries.reduce((s, e, i) => s + e.effectiveness * ctxWeights[i], 0) / ctxTotalW;
  ctxEntry.avg_sr_delta = ctxEntry.entries.reduce((s, e, i) => s + e.sr_delta * ctxWeights[i], 0) / ctxTotalW;

  recordContextEffectiveness(action.type, ctx, action.effectiveness, action.result === "success");
  ctxEntry.avg_latency_delta = ctxEntry.entries.reduce((s, e, i) => s + (e.latency_delta || 0) * ctxWeights[i], 0) / ctxTotalW;

  if (action.effectiveness > score.best_effectiveness) score.best_effectiveness = action.effectiveness;
  if (action.effectiveness < score.worst_effectiveness) score.worst_effectiveness = action.effectiveness;

  if (score.avg_effectiveness > 0.1) {
    score.current_cooldown_ms = Math.max(score.base_cooldown_ms * 0.5, score.current_cooldown_ms * 0.85);
    pushDecision(action.type, "cooldown_adjusted", `Эффективно → cooldown ${Math.round(score.current_cooldown_ms / 1000)}s`, score.avg_effectiveness, { context: ctx, time_context: timeBucket });
  } else if (score.avg_effectiveness < -0.05) {
    score.current_cooldown_ms = Math.min(score.base_cooldown_ms * 3, score.current_cooldown_ms * 1.3);
    pushDecision(action.type, "cooldown_adjusted", `Неэффективно → cooldown ${Math.round(score.current_cooldown_ms / 1000)}s`, score.avg_effectiveness, { context: ctx, time_context: timeBucket });
  }

  if (score.total_uses >= 5 && score.avg_effectiveness < -0.3) {
    score.enabled = false;
    pushDecision(action.type, "skip", `Авто-отключено: avg_eff=${score.avg_effectiveness.toFixed(2)} после ${score.total_uses} попыток`, score.avg_effectiveness, { context: ctx });
  }

  optimizationGeneration++;

  if (optimizationGeneration % 3 === 0) {
    takeGenerationSnapshot();
  }

  console.log(`[ENGINE] ${action.type}: eff=${action.effectiveness.toFixed(3)} sr=${srDelta.toFixed(1)} lat=${latDelta.toFixed(0)} obj=[H:${entryObjectives.health.toFixed(3)} C:${entryObjectives.completion.toFixed(3)} E:${entryObjectives.earnings.toFixed(3)}] ctx=${ctx} time=${timeBucket}`);
}

function scheduleEffectivenessCheck(action: RecoveryAction) {
  setTimeout(() => {
    action.metrics_after = takeSnapshot();
    recordEffectiveness(action);
  }, 8000);
}

function loadOptimizerState() {
  try {
    const filePath = join(process.cwd(), OPTIMIZER_FILE);
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, "utf-8"));
      if (raw.scores && Array.isArray(raw.scores)) {
        for (const s of raw.scores) {
          const score = initScore(s.type);
          Object.assign(score, s);
          if (score.history.length > 0) {
            score.enabled = score.avg_effectiveness >= -0.3 || score.total_uses < 5;
          }
          actionScores.set(s.type, score);
        }
        if (typeof raw.generation === "number") {
          optimizationGeneration = raw.generation;
        }
        console.log(`[OPTIMIZER] Loaded state: ${raw.scores.length} action profiles, generation=${optimizationGeneration} from previous runs`);
      }
    }
  } catch {
    console.log("[OPTIMIZER] No previous state found, starting fresh");
  }
}

function saveOptimizerState() {
  try {
    const filePath = join(process.cwd(), OPTIMIZER_FILE);
    const state = {
      saved_at: new Date().toISOString(),
      generation: optimizationGeneration,
      scores: Array.from(actionScores.values()),
    };
    writeFileSync(filePath, JSON.stringify(state, null, 2));
    console.log(`[OPTIMIZER] State saved: generation=${optimizationGeneration}`);
  } catch (e: any) {
    console.log(`[OPTIMIZER] Failed to save state: ${e.message}`);
  }
}

function computeProfitMetrics(): ProfitMetrics {
  const totalDrivers = liveDrivers.length;
  const activeDrivers = liveDrivers.filter(d => d.wsConnected && d.isOnline).length;
  const busyDrivers = liveDrivers.filter(d => d.isBusy).length;
  const idleDrivers = activeDrivers - busyDrivers;

  const elapsedHours = liveMetrics.phase_elapsed_s / 3600 || 1 / 3600;
  const ridesPerHour = Math.round((liveMetrics.accepted / elapsedHours) * 10) / 10;

  const avgFare = 50000;
  const revenueProxy = liveMetrics.accepted * avgFare;
  const avgRevenuePerRide = liveMetrics.accepted > 0 ? avgFare : 0;
  const driverUtilization = activeDrivers > 0 ? Math.round((busyDrivers / activeDrivers) * 1000) / 10 : 0;
  const idleDriversPct = activeDrivers > 0 ? Math.round((idleDrivers / activeDrivers) * 1000) / 10 : 0;

  const now = Date.now();
  if (now - lastProfitSampleAt >= 5000) {
    lastProfitSampleAt = now;
    profitHistory.push(revenueProxy);
    if (profitHistory.length > 20) profitHistory.splice(0, profitHistory.length - 20);
  }

  let trend: "growing" | "stable" | "declining" = "stable";
  if (profitHistory.length >= 4) {
    const recent = profitHistory.slice(-4);
    const slope = (recent[3] - recent[0]) / 3;
    if (slope > avgFare * 0.5) trend = "growing";
    else if (slope < -avgFare * 0.5) trend = "declining";
  }

  return {
    ridesPerHour,
    revenueProxy: Math.round(revenueProxy),
    driverUtilization,
    idleDriversPct,
    avgRevenuePerRide,
    totalRevenue: Math.round(revenueProxy),
    activeDrivers,
    busyDrivers,
    idleDrivers,
    trend,
  };
}

function updateDriverBehavior() {
  for (const driver of liveDrivers) {
    let stats = driverBehaviorStats.get(driver.id);
    if (!stats) {
      stats = { offers: 0, accepts: 0, rejects: 0, responseTimes: [], busyTicks: 0, totalTicks: 0, ridesCompleted: 0 };
      driverBehaviorStats.set(driver.id, stats);
    }
    stats.totalTicks++;
    if (driver.isBusy) stats.busyTicks++;
    stats.offers = driver.offersReceived.size;
  }
}

function trackDriverAccept(driverId: number, responseMs: number) {
  let stats = driverBehaviorStats.get(driverId);
  if (!stats) {
    stats = { offers: 0, accepts: 0, rejects: 0, responseTimes: [], busyTicks: 0, totalTicks: 0, ridesCompleted: 0 };
    driverBehaviorStats.set(driverId, stats);
  }
  stats.accepts++;
  stats.responseTimes.push(responseMs);
  if (stats.responseTimes.length > 50) stats.responseTimes.splice(0, stats.responseTimes.length - 50);
}

function trackDriverReject(driverId: number) {
  let stats = driverBehaviorStats.get(driverId);
  if (!stats) {
    stats = { offers: 0, accepts: 0, rejects: 0, responseTimes: [], busyTicks: 0, totalTicks: 0, ridesCompleted: 0 };
    driverBehaviorStats.set(driverId, stats);
  }
  stats.rejects++;
}

function trackDriverComplete(driverId: number) {
  const stats = driverBehaviorStats.get(driverId);
  if (stats) stats.ridesCompleted++;
}

function classifyDriverTier(score: number): DriverTier {
  if (score >= 0.8) return "top";
  if (score >= 0.6) return "good";
  if (score >= 0.35) return "average";
  return "poor";
}

function computeDriverModel(): DriverBehaviorProfile[] {
  const profiles: DriverBehaviorProfile[] = [];

  for (const driver of liveDrivers) {
    const stats = driverBehaviorStats.get(driver.id);
    if (!stats || stats.totalTicks < 3) continue;

    const totalDecisions = stats.accepts + stats.rejects;
    const acceptRate = totalDecisions > 0 ? stats.accepts / totalDecisions : 0;
    const avgResponseMs = stats.responseTimes.length > 0
      ? Math.round(stats.responseTimes.reduce((s, t) => s + t, 0) / stats.responseTimes.length)
      : 0;
    const idleTimeRatio = stats.totalTicks > 0 ? 1 - (stats.busyTicks / stats.totalTicks) : 1;
    const onlineRatio = driver.isOnline && driver.wsConnected ? 1 : 0;

    const acceptScore = acceptRate * 0.35;
    const responseScore = Math.max(0, 1 - avgResponseMs / 5000) * 0.20;
    const utilizationScore = (1 - idleTimeRatio) * 0.20;
    const completionScore = Math.min(1, stats.ridesCompleted / Math.max(1, stats.accepts)) * 0.15;
    const onlineScore = onlineRatio * 0.10;
    const score = Math.round((acceptScore + responseScore + utilizationScore + completionScore + onlineScore) * 1000) / 1000;

    const avgFare = 50000;
    const revenueProxy = stats.ridesCompleted * avgFare;

    profiles.push({
      driverId: driver.id,
      city: driver.city,
      tier: classifyDriverTier(score),
      acceptRate: Math.round(acceptRate * 1000) / 10,
      avgResponseMs,
      totalOffers: stats.offers,
      totalAccepts: stats.accepts,
      totalRejects: stats.rejects,
      idleTimeRatio: Math.round(idleTimeRatio * 1000) / 10,
      revenueProxy,
      ridesCompleted: stats.ridesCompleted,
      onlineRatio: Math.round(onlineRatio * 100),
      score,
    });
  }

  profiles.sort((a, b) => b.score - a.score);
  return profiles.slice(0, 50);
}

function trackCorridorDemand(fromCity: string, toCity: string) {
  const key = `${fromCity}→${toCity}`;
  let entry = corridorDemandHistory.get(key);
  if (!entry) {
    entry = { counts: [], timestamps: [] };
    corridorDemandHistory.set(key, entry);
  }
  const now = Date.now();
  entry.counts.push(1);
  entry.timestamps.push(now);
  if (entry.counts.length > 100) {
    entry.counts.splice(0, entry.counts.length - 100);
    entry.timestamps.splice(0, entry.timestamps.length - 100);
  }
}

function computeDemandPredictions(): DemandPrediction[] {
  const timeBucket = getTimeBucket();
  const timeFactors: Record<TimeBucket, Record<string, number>> = {
    morning: { tashkent: 1.4, samarkand: 1.2, fergana: 1.3, namangan: 1.2, bukhara: 1.0, andijan: 1.1, default: 1.0 },
    day: { tashkent: 1.2, samarkand: 1.3, fergana: 1.0, namangan: 1.0, bukhara: 1.1, andijan: 1.0, default: 1.0 },
    evening: { tashkent: 1.5, samarkand: 1.1, fergana: 1.4, namangan: 1.3, bukhara: 1.0, andijan: 1.2, default: 1.1 },
    night: { tashkent: 0.6, samarkand: 0.5, fergana: 0.4, namangan: 0.4, bukhara: 0.4, andijan: 0.3, default: 0.3 },
  };

  const predictions: DemandPrediction[] = [];
  const now = Date.now();
  const windowMs = 60_000;

  for (const [key, entry] of corridorDemandHistory.entries()) {
    const [fromCity, toCity] = key.split("→");
    const recentCount = entry.timestamps.filter(t => t > now - windowMs).length;
    const olderCount = entry.timestamps.filter(t => t > now - windowMs * 2 && t <= now - windowMs).length;

    const cityFactors = timeFactors[timeBucket];
    const fromFactor = cityFactors[fromCity] ?? cityFactors.default ?? 1;
    const toFactor = cityFactors[toCity] ?? cityFactors.default ?? 1;
    const timeFactor = Math.round(((fromFactor + toFactor) / 2) * 100) / 100;

    const historyFactor = olderCount > 0 ? Math.round((recentCount / olderCount) * 100) / 100 : 1;

    const predictedDemand = Math.round(recentCount * timeFactor * Math.max(0.5, historyFactor) * 10) / 10;

    let trend: "rising" | "stable" | "falling" = "stable";
    if (recentCount > olderCount * 1.3) trend = "rising";
    else if (recentCount < olderCount * 0.7 && olderCount > 0) trend = "falling";

    const confidence = Math.min(1, Math.round((Math.min(entry.counts.length, 30) / 30) * 100) / 100);

    predictions.push({
      corridor: key,
      fromCity,
      toCity,
      currentDemand: recentCount,
      predictedDemand,
      confidence,
      timeFactor,
      historyFactor: Math.min(3, historyFactor),
      trend,
      hotspot: predictedDemand >= 3 && timeFactor >= 1.2,
    });
  }

  predictions.sort((a, b) => b.predictedDemand - a.predictedDemand);
  return predictions.slice(0, 20);
}

function takeGenerationSnapshot() {
  const allScores = ALL_RECOVERY_TYPES.map(getScore);
  const health = computeHealthScore();
  const objectives = computeObjectives();
  const profit = computeProfitMetrics();
  const driverModel = computeDriverModel();

  const tierDist: Record<DriverTier, number> = { top: 0, good: 0, average: 0, poor: 0 };
  for (const d of driverModel) tierDist[d.tier]++;

  const totalActions = allScores.reduce((s, a) => s + a.total_uses, 0);
  const totalEffective = allScores.reduce((s, a) => s + a.history.filter(h => h.effectiveness > 0).length, 0);
  const avgEff = totalActions > 0
    ? allScores.reduce((s, a) => s + a.avg_effectiveness * a.total_uses, 0) / totalActions
    : 0;

  const demands = computeDemandPredictions();
  const topCorridors = demands.slice(0, 3).map(d => d.corridor);

  const genScore = health.value * 0.25 + objectives.combined * 0.25 + (profit.driverUtilization / 100) * 0.2 + Math.min(1, avgEff + 0.5) * 0.15 + (totalEffective / Math.max(1, totalActions)) * 0.15;

  const snapshot: GenerationSnapshot = {
    generation: optimizationGeneration,
    timestamp: new Date().toISOString(),
    health: health.value,
    objectives,
    profitMetrics: profit,
    totalActions,
    totalEffective,
    avgEffectiveness: Math.round(avgEff * 1000) / 1000,
    driverTierDistribution: tierDist,
    topCorridors,
    score: Math.round(genScore * 1000) / 1000,
  };

  generationSnapshots.push(snapshot);
  if (generationSnapshots.length > 30) generationSnapshots.splice(0, generationSnapshots.length - 30);

  if (bestGenerationIdx < 0 || genScore > (generationSnapshots[bestGenerationIdx]?.score ?? 0)) {
    bestGenerationIdx = generationSnapshots.length - 1;
  }

  console.log(`[ENGINE] Generation ${optimizationGeneration} snapshot: score=${genScore.toFixed(3)}, HP=${(health.value * 100).toFixed(0)}%, util=${profit.driverUtilization}%, best=Gen${generationSnapshots[bestGenerationIdx]?.generation ?? 0}`);
}

export function rollbackToGeneration(targetGen: number): { ok: boolean; message: string } {
  const snap = generationSnapshots.find(s => s.generation === targetGen);
  if (!snap) return { ok: false, message: `Generation ${targetGen} not found` };

  for (const type of ALL_RECOVERY_TYPES) {
    const score = getScore(type);
    score.enabled = true;
    score.current_cooldown_ms = score.base_cooldown_ms;
  }

  recentActionMemory.length = 0;
  multiActionCount = 0;

  pushDecision("ws_reconnect", "skip",
    `ROLLBACK → Gen ${targetGen} (score=${snap.score.toFixed(3)}, HP=${(snap.health * 100).toFixed(0)}%)`,
    snap.score,
    { objectives: snap.objectives });

  console.log(`[ENGINE] ROLLBACK to generation ${targetGen}: score=${snap.score.toFixed(3)}`);
  return { ok: true, message: `Rolled back to generation ${targetGen} (score=${snap.score.toFixed(3)})` };
}

export function getOptimizationState(): OptimizationState {
  const allScores = ALL_RECOVERY_TYPES.map(getScore);
  const health = computeHealthScore();
  return {
    scores: allScores,
    decisions: optimizationDecisions,
    generation: optimizationGeneration,
    total_actions: allScores.reduce((s, a) => s + a.total_uses, 0),
    total_effective: allScores.reduce((s, a) => s + a.history.filter(h => h.effectiveness > 0).length, 0),
    total_ineffective: allScores.reduce((s, a) => s + a.history.filter(h => h.effectiveness <= 0).length, 0),
    total_explored: allScores.reduce((s, a) => s + a.explored, 0),
    learning_rate: 1 - 0.15,
    exploration_rate: EXPLORATION_RATE,
    health,
    context_bucket: getContextBucket(),
    time_bucket: getTimeBucket(),
    objectives: computeObjectives(),
    recent_actions: [...recentActionMemory],
    multi_action_count: multiActionCount,
    profit: computeProfitMetrics(),
    driver_model: computeDriverModel(),
    demand_predictions: computeDemandPredictions(),
    generation_snapshots: generationSnapshots,
    best_generation: generationSnapshots[bestGenerationIdx]?.generation ?? 0,
  };
}

loadOptimizerState();

export const liveAlerts: StressAlert[] = [];
export const recoveryActions: RecoveryAction[] = [];
let alertIdCounter = 0;
let recoveryIdCounter = 0;
let successBelowSince = 0;
let prevWsConnections = 0;
let lastWsRecoveryAt = 0;
let lastDispatchRestartAt = 0;
let lastLoadReduceAt = 0;
let currentRideIntervalMultiplier = 1;

const SUSTAIN_THRESHOLDS: Record<AlertLevel, number> = {
  info: 0,
  warning: 8_000,
  critical: 12_000,
  emergency: 20_000,
};
const COOLDOWN_MS: Record<AlertLevel, number> = {
  info: 10_000,
  warning: 60_000,
  critical: 120_000,
  emergency: 300_000,
};

interface AlertTracker {
  firstSeen: number;
  count: number;
  sumValues: number;
  lastLevel: AlertLevel;
  lastAlertAtByLevel: Record<AlertLevel, number>;
  lastSentLevel: AlertLevel;
  resolved: boolean;
  incidentActive: boolean;
}
const alertTrackers = new Map<AlertType, AlertTracker>();
let incidentIdCounter = 0;
const globalAlertTimestamps: number[] = [];
const GLOBAL_RATE_LIMIT = 3;
const GLOBAL_RATE_WINDOW_MS = 60_000;

const REASON_MAP: Record<AlertType, AlertReason> = {
  success_rate: "low_accept_rate",
  latency: "high_latency",
  ws_drop: "websocket_drop",
  critical_bug: "critical_bug",
  ws_errors: "ws_errors",
  recovery: "unknown",
};

function getRouting(level: AlertLevel): AlertRouting {
  if (level === "emergency") return "dashboard+telegram+sms";
  if (level === "critical") return "dashboard+telegram";
  return "dashboard";
}

function checkGlobalRateLimit(level: AlertLevel): boolean {
  const now = Date.now();
  const cutoff = now - GLOBAL_RATE_WINDOW_MS;
  while (globalAlertTimestamps.length > 0 && globalAlertTimestamps[0] < cutoff) {
    globalAlertTimestamps.shift();
  }
  if (globalAlertTimestamps.length >= GLOBAL_RATE_LIMIT) {
    if (LEVEL_RANK[level] >= LEVEL_RANK["critical"]) {
      return true;
    }
    return false;
  }
  return true;
}

function recordGlobalAlert() {
  globalAlertTimestamps.push(Date.now());
}

const RECOVERY_PLAYBOOK: Record<string, RecoveryType[]> = {
  success_rate: ["dispatch_restart", "load_reduce", "ws_reconnect"],
  latency: ["load_reduce", "dispatch_restart", "ws_reconnect"],
  ws_drop: ["ws_reconnect", "dispatch_restart", "load_reduce"],
  ws_errors: ["ws_reconnect", "load_reduce", "dispatch_restart"],
  critical_bug: ["dispatch_restart", "load_reduce", "ws_reconnect"],
};

const actionConsecutiveCount = new Map<RecoveryType, number>();
const actionEffectivenessLog = new Map<RecoveryType, { before: MetricsSnapshot; after: MetricsSnapshot | null; delta: number }[]>();
let autonomousRecoveryActive = false;
let autonomousRecoveryTimer: ReturnType<typeof setTimeout> | null = null;

interface StrategyOutcomeRecord {
  success: boolean;
  recovery_time_ms: number;
  improvement: number;
  timestamp: string;
}

interface MetaStrategy {
  id: string;
  sequence: RecoveryType[];
  incident_type: string;
  context: ContextBucket;
  uses: number;
  successes: number;
  total_recovery_time_ms: number;
  total_improvement: number;
  avg_recovery_time_ms: number;
  avg_improvement: number;
  success_rate: number;
  score: number;
  long_term_score: number;
  stability: number;
  selection_weight: number;
  disabled: boolean;
  created_at: string;
  last_used_at: string;
  source: "playbook" | "mutation" | "crossover" | "discovered";
  history: StrategyOutcomeRecord[];
}

interface ActiveStrategyExecution {
  strategy_id: string;
  incident_id: string;
  start_time: number;
  snapshot_before: MetricsSnapshot;
  actions_executed: RecoveryType[];
}

const META_STRATEGY_FILE = "stress-meta-strategies.json";
const META_MAX_STRATEGIES = 150;
const META_HISTORY_WINDOW = 20;
const META_DISABLE_THRESHOLD_USES = 5;
const META_DISABLE_THRESHOLD_RATE = 0.30;
const META_PROMOTE_THRESHOLD = 0.65;
const META_DEMOTE_THRESHOLD = 0.35;
const META_WEIGHT_MIN = 0.1;
const META_WEIGHT_MAX = 3.0;
const META_WEIGHT_PROMOTE_FACTOR = 1.25;
const META_WEIGHT_DEMOTE_FACTOR = 0.75;

let metaExplorationRate = 0.20;
const metaStrategies: MetaStrategy[] = [];
let activeStrategyExecution: ActiveStrategyExecution | null = null;
let metaStrategyIdCounter = 0;
let lastEvolutionCycleAt = 0;
const META_EVOLUTION_INTERVAL_MS = 30_000;

function generateStrategyId(): string {
  metaStrategyIdCounter++;
  return `strat-${metaStrategyIdCounter}`;
}

function strategyKey(sequence: RecoveryType[], incidentType: string, ctx: ContextBucket): string {
  return `${sequence.join("→")}|${incidentType}|${ctx}`;
}

function findStrategy(sequence: RecoveryType[], incidentType: string, ctx: ContextBucket): MetaStrategy | undefined {
  return metaStrategies.find(s =>
    s.sequence.length === sequence.length &&
    s.sequence.every((a, i) => a === sequence[i]) &&
    s.incident_type === incidentType &&
    s.context === ctx
  );
}

function computeStability(history: StrategyOutcomeRecord[]): number {
  if (history.length < 2) return 0.5;
  const times = history.map(h => h.recovery_time_ms).filter(t => t > 0);
  if (times.length < 2) return 0.5;
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const variance = times.reduce((a, t) => a + Math.pow(t - mean, 2), 0) / times.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
  return Math.max(0, Math.min(1, 1 - cv));
}

function getOrCreateStrategy(sequence: RecoveryType[], incidentType: string, ctx: ContextBucket, source: MetaStrategy["source"]): MetaStrategy {
  let existing = findStrategy(sequence, incidentType, ctx);
  if (existing) return existing;

  const strat: MetaStrategy = {
    id: generateStrategyId(),
    sequence: [...sequence],
    incident_type: incidentType,
    context: ctx,
    uses: 0,
    successes: 0,
    total_recovery_time_ms: 0,
    total_improvement: 0,
    avg_recovery_time_ms: 0,
    avg_improvement: 0,
    success_rate: 0,
    score: 0.5,
    long_term_score: 0.5,
    stability: 0.5,
    selection_weight: 1.0,
    disabled: false,
    created_at: new Date().toISOString(),
    last_used_at: new Date().toISOString(),
    source,
    history: [],
  };
  metaStrategies.push(strat);
  if (metaStrategies.length > META_MAX_STRATEGIES) {
    const sorted = [...metaStrategies].sort((a, b) => a.long_term_score - b.long_term_score);
    const toRemove = sorted[0];
    if (toRemove.disabled || toRemove.uses >= 3) {
      const idx = metaStrategies.indexOf(toRemove);
      if (idx >= 0) {
        metaStrategies.splice(idx, 1);
        console.log(`[AI META] evicted weakest strategy ${toRemove.id} (score=${toRemove.long_term_score.toFixed(3)}) to make room`);
      }
    }
  }
  console.log(`[AI META] created strategy ${strat.id} [${sequence.join("→")}] for ${incidentType}/${ctx} (source=${source})`);
  return strat;
}

function computeStrategyScore(s: MetaStrategy): number {
  if (s.uses === 0) return 0.5;
  const successComponent = s.success_rate * 0.5;
  const speedComponent = s.avg_recovery_time_ms > 0 ? Math.min(1, 10000 / s.avg_recovery_time_ms) * 0.3 : 0.15;
  const stabilityComponent = (s.uses >= 3 ? 1 : s.uses / 3) * 0.2;
  return Math.round((successComponent + speedComponent + stabilityComponent) * 1000) / 1000;
}

function computeLongTermScore(s: MetaStrategy): number {
  if (s.uses === 0) return 0.5;
  const usageConfidence = Math.min(1, s.uses / 10);
  const speedNorm = s.avg_recovery_time_ms > 0 ? Math.min(1, 10000 / s.avg_recovery_time_ms) : 0.5;
  const lt = s.success_rate * 0.4 + speedNorm * 0.3 + s.stability * 0.2 + usageConfidence * 0.1;
  return Math.round(lt * 1000) / 1000;
}

function getAdaptiveExplorationRate(): number {
  const health = computeHealthScore();
  if (health.value >= 0.8) {
    return 0.10;
  } else if (health.value >= 0.5) {
    return 0.20;
  } else {
    return 0.30;
  }
}

function recordStrategyOutcome(strategyId: string, success: boolean, recoveryTimeMs: number, improvement: number) {
  const strat = metaStrategies.find(s => s.id === strategyId);
  if (!strat) return;

  strat.uses++;
  if (success) strat.successes++;
  strat.total_recovery_time_ms += recoveryTimeMs;
  strat.total_improvement += improvement;
  strat.avg_recovery_time_ms = Math.round(strat.total_recovery_time_ms / strat.uses);
  strat.avg_improvement = Math.round(strat.total_improvement / strat.uses * 1000) / 1000;
  strat.success_rate = Math.round(strat.successes / strat.uses * 1000) / 1000;

  strat.history.push({ success, recovery_time_ms: recoveryTimeMs, improvement, timestamp: new Date().toISOString() });
  if (strat.history.length > META_HISTORY_WINDOW) {
    strat.history = strat.history.slice(-META_HISTORY_WINDOW);
  }

  strat.stability = computeStability(strat.history);
  strat.score = computeStrategyScore(strat);
  strat.long_term_score = computeLongTermScore(strat);
  strat.last_used_at = new Date().toISOString();

  console.log(`[AI META] strategy ${strat.id} outcome: success=${success} time=${recoveryTimeMs}ms improvement=${improvement.toFixed(3)} → score=${strat.score} lt_score=${strat.long_term_score} stability=${strat.stability.toFixed(3)}`);

  if (strat.uses >= META_DISABLE_THRESHOLD_USES && strat.success_rate <= META_DISABLE_THRESHOLD_RATE && !strat.disabled) {
    strat.disabled = true;
    strat.selection_weight = 0;
    console.log(`[AI META] removed weak strategy ${strat.id} (success_rate=${(strat.success_rate*100).toFixed(0)}% after ${strat.uses} uses)`);
  }

  if (!strat.disabled) {
    if (strat.long_term_score >= META_PROMOTE_THRESHOLD) {
      strat.selection_weight = Math.min(META_WEIGHT_MAX, strat.selection_weight * META_WEIGHT_PROMOTE_FACTOR);
      console.log(`[AI META] promoted strategy ${strat.id} (weight=${strat.selection_weight.toFixed(2)}, lt_score=${strat.long_term_score})`);
    } else if (strat.long_term_score < META_DEMOTE_THRESHOLD && strat.uses >= 3) {
      strat.selection_weight = Math.max(META_WEIGHT_MIN, strat.selection_weight * META_WEIGHT_DEMOTE_FACTOR);
      console.log(`[AI META] demoted strategy ${strat.id} (weight=${strat.selection_weight.toFixed(2)}, lt_score=${strat.long_term_score})`);
    }
  }

  if (success && strat.uses >= 2 && strat.score > 0.5) {
    tryMutateStrategies(strat);
    tryCrossoverStrategies(strat);
  }

  runEvolutionCycle();
  saveMetaStrategies();
}

function selectStrategy(incidentType: string, ctx: ContextBucket, basePlaybook: RecoveryType[]): { strategy: MetaStrategy; exploration: boolean } {
  const candidates = metaStrategies.filter(s =>
    s.incident_type === incidentType && s.context === ctx && s.uses >= 1 && !s.disabled
  );

  metaExplorationRate = getAdaptiveExplorationRate();
  const useExploration = Math.random() < metaExplorationRate;

  if (candidates.length >= 2 && !useExploration) {
    const totalWeight = candidates.reduce((sum, s) => sum + s.selection_weight, 0);
    let pick = Math.random() * totalWeight;
    let selected = candidates[0];
    for (const c of candidates) {
      pick -= c.selection_weight;
      if (pick <= 0) { selected = c; break; }
    }
    console.log(`[AI META] selected strategy=${selected.id} [${selected.sequence.join("→")}] score=${selected.score} weight=${selected.selection_weight.toFixed(2)} (exploitation)`);
    return { strategy: selected, exploration: false };
  }

  if (candidates.length >= 2 && useExploration) {
    const enabledUnderused = candidates.filter(s => s.uses < 5);
    if (enabledUnderused.length > 0) {
      const sorted = [...enabledUnderused].sort((a, b) => a.uses - b.uses);
      const leastUsed = sorted[0];
      console.log(`[AI META] selected strategy=${leastUsed.id} [${leastUsed.sequence.join("→")}] uses=${leastUsed.uses} (exploration)`);
      return { strategy: leastUsed, exploration: true };
    }
    const random = candidates[Math.floor(Math.random() * candidates.length)];
    console.log(`[AI META] selected strategy=${random.id} [${random.sequence.join("→")}] (random exploration)`);
    return { strategy: random, exploration: true };
  }

  const defaultStrat = getOrCreateStrategy(basePlaybook, incidentType, ctx, "playbook");
  console.log(`[AI META] using default playbook strategy=${defaultStrat.id} [${basePlaybook.join("→")}]`);
  return { strategy: defaultStrat, exploration: false };
}

function tryMutateStrategies(successfulStrat: MetaStrategy) {
  if (successfulStrat.sequence.length < 2) return;

  const bestActions = successfulStrat.sequence
    .map(a => ({ type: a, score: computeSmartScore(a) }))
    .sort((a, b) => b.score - a.score);

  if (bestActions.length >= 2) {
    const subSequence = bestActions.slice(0, 2).map(a => a.type);
    const existing = findStrategy(subSequence, successfulStrat.incident_type, successfulStrat.context);
    if (!existing) {
      const newStrat = getOrCreateStrategy(subSequence, successfulStrat.incident_type, successfulStrat.context, "mutation");
      console.log(`[AI META] created new strategy ${newStrat.id} [${subSequence.join("→")}] mutated from ${successfulStrat.id}`);
    }
  }

  if (successfulStrat.sequence.length >= 3) {
    const singleBest = [bestActions[0].type];
    const existingSingle = findStrategy(singleBest, successfulStrat.incident_type, successfulStrat.context);
    if (!existingSingle) {
      const newStrat = getOrCreateStrategy(singleBest, successfulStrat.incident_type, successfulStrat.context, "mutation");
      console.log(`[AI META] created new strategy ${newStrat.id} [${singleBest[0]}] extracted from ${successfulStrat.id}`);
    }
  }

  if (bestActions.length >= 3) {
    const reversed = [bestActions[bestActions.length - 1].type, bestActions[0].type];
    const existingReversed = findStrategy(reversed, successfulStrat.incident_type, successfulStrat.context);
    if (!existingReversed) {
      const newStrat = getOrCreateStrategy(reversed, successfulStrat.incident_type, successfulStrat.context, "mutation");
      console.log(`[AI META] created new strategy ${newStrat.id} [${reversed.join("→")}] reversed-pair from ${successfulStrat.id}`);
    }
  }
}

function tryCrossoverStrategies(parentStrat: MetaStrategy) {
  const peers = metaStrategies.filter(s =>
    s.id !== parentStrat.id &&
    s.incident_type === parentStrat.incident_type &&
    s.context === parentStrat.context &&
    s.score > 0.5 &&
    s.uses >= 2 &&
    !s.disabled
  );
  if (peers.length === 0) return;

  const bestPeer = peers.reduce((a, b) => a.long_term_score > b.long_term_score ? a : b);

  const parentActions = new Set(parentStrat.sequence);
  const peerActions = new Set(bestPeer.sequence);
  const combined = new Set([...parentActions, ...peerActions]);

  if (combined.size > parentStrat.sequence.length && combined.size <= 4) {
    const crossoverSeq: RecoveryType[] = [];
    for (const a of parentStrat.sequence) {
      crossoverSeq.push(a);
    }
    for (const a of bestPeer.sequence) {
      if (!parentActions.has(a)) crossoverSeq.push(a);
    }
    if (crossoverSeq.length >= 2 && crossoverSeq.length <= 4) {
      const existing = findStrategy(crossoverSeq, parentStrat.incident_type, parentStrat.context);
      if (!existing) {
        const newStrat = getOrCreateStrategy(crossoverSeq, parentStrat.incident_type, parentStrat.context, "crossover");
        console.log(`[AI META] created new strategy ${newStrat.id} [${crossoverSeq.join("→")}] crossover from ${parentStrat.id} + ${bestPeer.id}`);
      }
    }
  }

  if (parentStrat.sequence.length >= 2 && bestPeer.sequence.length >= 2) {
    const half1 = parentStrat.sequence.slice(0, Math.ceil(parentStrat.sequence.length / 2));
    const half2 = bestPeer.sequence.slice(Math.floor(bestPeer.sequence.length / 2));
    const spliceSeq = [...new Set([...half1, ...half2])] as RecoveryType[];
    if (spliceSeq.length >= 2 && spliceSeq.length <= 4) {
      const existing = findStrategy(spliceSeq, parentStrat.incident_type, parentStrat.context);
      if (!existing) {
        const newStrat = getOrCreateStrategy(spliceSeq, parentStrat.incident_type, parentStrat.context, "crossover");
        console.log(`[AI META] created new strategy ${newStrat.id} [${spliceSeq.join("→")}] splice-crossover from ${parentStrat.id} + ${bestPeer.id}`);
      }
    }
  }
}

function runEvolutionCycle() {
  const now = Date.now();
  if (now - lastEvolutionCycleAt < META_EVOLUTION_INTERVAL_MS) return;
  lastEvolutionCycleAt = now;

  const contexts: ContextBucket[] = ["low_load", "mid_load", "high_load"];
  for (const ctx of contexts) {
    const contextStrats = metaStrategies.filter(s => s.context === ctx && !s.disabled && s.uses >= 2);
    if (contextStrats.length < 2) continue;

    const sorted = [...contextStrats].sort((a, b) => b.long_term_score - a.long_term_score);
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];

    if (top.long_term_score > 0.6 && bottom.long_term_score < 0.3 && bottom.uses >= META_DISABLE_THRESHOLD_USES) {
      bottom.disabled = true;
      bottom.selection_weight = 0;
      console.log(`[AI META] evolution: removed weak strategy ${bottom.id} in ${ctx} (lt_score=${bottom.long_term_score})`);
    }
  }

  const disabledCount = metaStrategies.filter(s => s.disabled).length;
  const activeCount = metaStrategies.filter(s => !s.disabled).length;
  if (disabledCount > 0) {
    console.log(`[AI META] evolution cycle: ${activeCount} active, ${disabledCount} disabled strategies`);
  }
}

function getClusterStats() {
  const contexts: ContextBucket[] = ["low_load", "mid_load", "high_load"];
  const clusters: Record<string, { total: number; active: number; disabled: number; best_score: number; best_id: string; avg_score: number }> = {};

  for (const ctx of contexts) {
    const ctxStrats = metaStrategies.filter(s => s.context === ctx);
    const active = ctxStrats.filter(s => !s.disabled);
    const disabled = ctxStrats.filter(s => s.disabled);
    const best = active.length > 0 ? active.reduce((a, b) => a.long_term_score > b.long_term_score ? a : b) : null;
    const avgScore = active.length > 0 ? Math.round(active.reduce((sum, s) => sum + s.long_term_score, 0) / active.length * 1000) / 1000 : 0;

    clusters[ctx] = {
      total: ctxStrats.length,
      active: active.length,
      disabled: disabled.length,
      best_score: best?.long_term_score ?? 0,
      best_id: best?.id ?? "",
      avg_score: Math.round(avgScore * 1000) / 1000,
    };
  }
  return clusters;
}

function beginStrategyExecution(strategyId: string, incidentId: string) {
  activeStrategyExecution = {
    strategy_id: strategyId,
    incident_id: incidentId,
    start_time: Date.now(),
    snapshot_before: takeSnapshot(),
    actions_executed: [],
  };
}

function completeStrategyExecution(success: boolean) {
  if (!activeStrategyExecution) return;

  const elapsed = Date.now() - activeStrategyExecution.start_time;
  const after = takeSnapshot();
  const improvement = (after.success_rate - activeStrategyExecution.snapshot_before.success_rate) / 100 +
    (activeStrategyExecution.snapshot_before.avg_latency - after.avg_latency) / 1000;

  recordStrategyOutcome(activeStrategyExecution.strategy_id, success, elapsed, improvement);

  if (success && elapsed > 0) {
    const strat = metaStrategies.find(s => s.id === activeStrategyExecution!.strategy_id);
    if (strat && strat.avg_recovery_time_ms > 0) {
      const prevBest = metaStrategies
        .filter(s => s.incident_type === strat.incident_type && s.context === strat.context && s.id !== strat.id && s.uses >= 2 && !s.disabled)
        .reduce((best, s) => (s.avg_recovery_time_ms < best.avg_recovery_time_ms ? s : best), { avg_recovery_time_ms: Infinity } as MetaStrategy);
      if (prevBest.avg_recovery_time_ms !== Infinity && strat.avg_recovery_time_ms < prevBest.avg_recovery_time_ms) {
        console.log(`[AI META] strategy improved recovery time: ${strat.id} (${strat.avg_recovery_time_ms}ms) vs previous best (${prevBest.avg_recovery_time_ms}ms)`);
      }
    }
  }

  activeStrategyExecution = null;
}

function saveMetaStrategies() {
  try {
    const filePath = join(process.cwd(), META_STRATEGY_FILE);
    const state = {
      saved_at: new Date().toISOString(),
      id_counter: metaStrategyIdCounter,
      exploration_rate: metaExplorationRate,
      strategies: metaStrategies,
    };
    writeFileSync(filePath, JSON.stringify(state, null, 2));
  } catch (e: any) {
    console.log(`[AI META] Failed to save: ${e.message}`);
  }
}

function loadMetaStrategies() {
  try {
    const filePath = join(process.cwd(), META_STRATEGY_FILE);
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, "utf-8"));
      if (raw.strategies && Array.isArray(raw.strategies)) {
        metaStrategies.length = 0;
        for (const s of raw.strategies) {
          s.history = s.history || [];
          s.stability = s.stability ?? computeStability(s.history);
          s.selection_weight = s.selection_weight ?? 1.0;
          s.disabled = s.disabled ?? false;
          s.long_term_score = computeLongTermScore(s);
          if (isNaN(s.long_term_score)) s.long_term_score = 0.5;
          metaStrategies.push(s);
        }
        metaStrategyIdCounter = raw.id_counter || metaStrategies.length;
        metaExplorationRate = raw.exploration_rate ?? 0.20;
        console.log(`[AI META] Loaded ${metaStrategies.length} strategies from previous runs (${metaStrategies.filter(s => !s.disabled).length} active)`);
      }
    }
  } catch {
    console.log("[AI META] No previous strategies found, starting fresh");
  }
}

export function getMetaOptimizerStatus() {
  const ctx = getContextBucket();
  const grouped: Record<string, MetaStrategy[]> = {};
  for (const s of metaStrategies) {
    const key = `${s.incident_type}|${s.context}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(s);
  }

  const bestPerGroup: Record<string, MetaStrategy> = {};
  for (const [key, strats] of Object.entries(grouped)) {
    const active = strats.filter(s => !s.disabled);
    if (active.length > 0) bestPerGroup[key] = active.reduce((a, b) => a.long_term_score > b.long_term_score ? a : b);
  }

  return {
    total_strategies: metaStrategies.length,
    active_strategies: metaStrategies.filter(s => !s.disabled).length,
    disabled_strategies: metaStrategies.filter(s => s.disabled).length,
    current_context: ctx,
    exploration_rate: metaExplorationRate,
    clusters: getClusterStats(),
    active_execution: activeStrategyExecution ? {
      strategy_id: activeStrategyExecution.strategy_id,
      incident_id: activeStrategyExecution.incident_id,
      elapsed_ms: Date.now() - activeStrategyExecution.start_time,
      actions_executed: activeStrategyExecution.actions_executed,
    } : null,
    strategies: metaStrategies.map(s => ({
      id: s.id,
      sequence: s.sequence,
      incident_type: s.incident_type,
      context: s.context,
      uses: s.uses,
      success_rate: s.success_rate,
      avg_recovery_time_ms: s.avg_recovery_time_ms,
      avg_improvement: s.avg_improvement,
      score: s.score,
      long_term_score: s.long_term_score,
      stability: Math.round(s.stability * 1000) / 1000,
      selection_weight: s.selection_weight,
      disabled: s.disabled,
      source: s.source,
      is_best: bestPerGroup[`${s.incident_type}|${s.context}`]?.id === s.id,
      history_length: s.history.length,
    })),
  };
}

loadMetaStrategies();

// ═══════════════════════════════════════════════════════════════════
// REVENUE OPTIMIZATION AI LAYER
// ═══════════════════════════════════════════════════════════════════

type RevenueStrategyMode = "aggressive" | "conservative" | "surge_heavy";

interface DemandSupplyState {
  active_drivers: number;
  busy_drivers: number;
  idle_drivers: number;
  pending_requests: number;
  demand_supply_ratio: number;
  timestamp: string;
}

interface SurgeState {
  multiplier: number;
  trend: "increasing" | "stable" | "decreasing";
  trigger_ratio: number;
  last_change_at: string;
}

interface DriverRanking {
  driverId: number;
  city: string;
  acceptance_rate: number;
  avg_response_ms: number;
  completion_rate: number;
  idle_time_pct: number;
  priority_score: number;
  tier: DriverTier;
  is_idle: boolean;
}

interface RevenueMetrics {
  revenue_per_minute: number;
  completed_rides: number;
  avg_ride_price: number;
  driver_utilization_pct: number;
  total_revenue: number;
  revenue_trend: "growing" | "stable" | "declining";
  idle_driver_assignments: number;
  top_driver_assignments: number;
}

interface RevenueStrategyResult {
  mode: RevenueStrategyMode;
  score: number;
  revenue_delta_pct: number;
  utilization_delta_pct: number;
  rides_delta: number;
  evaluation_window_s: number;
  evaluated_at: string;
}

interface RevenueAIState {
  enabled: boolean;
  current_mode: RevenueStrategyMode;
  demand_supply: DemandSupplyState;
  surge: SurgeState;
  driver_rankings: DriverRanking[];
  metrics: RevenueMetrics;
  strategy_results: RevenueStrategyResult[];
  best_strategy: RevenueStrategyMode;
  logs: string[];
}

const REVENUE_SURGE_THRESHOLD = 1.2;
const REVENUE_SURGE_MAX = 2.0;
const REVENUE_SURGE_MIN = 0.9;
const REVENUE_SURGE_STEP = 0.05;
const REVENUE_LOG_MAX = 50;
const REVENUE_EVAL_INTERVAL_MS = 20_000;
const REVENUE_STRATEGY_MODES: RevenueStrategyMode[] = ["aggressive", "conservative", "surge_heavy"];

let revenueAIEnabled = false;
let currentRevenueMode: RevenueStrategyMode = "conservative";
let surgePriceMultiplier = 1.0;
let lastSurgeChangeAt = "";
let revenueAILogs: string[] = [];
let revenueTotalFromStart = 0;
let revenueCompletedRides = 0;
let revenueIdleAssignments = 0;
let revenueTopDriverAssignments = 0;
let lastRevenueEvalAt = 0;
let revenueStartedAt = 0;
const revenueStrategyHistory: RevenueStrategyResult[] = [];
const revenueSnapshots: { ts: number; revenue: number; rides: number; utilization: number }[] = [];

function revenueLog(msg: string) {
  const entry = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  revenueAILogs.push(entry);
  if (revenueAILogs.length > REVENUE_LOG_MAX) revenueAILogs.splice(0, revenueAILogs.length - REVENUE_LOG_MAX);
  console.log(`[REVENUE AI] ${msg}`);
}

function computeDemandSupply(): DemandSupplyState {
  const activeDrivers = liveDrivers.filter(d => d.wsConnected && d.isOnline).length;
  const busyDrivers = liveDrivers.filter(d => d.wsConnected && d.isOnline && d.isBusy).length;
  const idleDrivers = Math.max(0, activeDrivers - busyDrivers);

  const pendingRequests = Math.max(0, liveMetrics.rides_created - liveMetrics.accepted - liveMetrics.failed);
  const availableDrivers = Math.max(1, idleDrivers);
  const ratio = Math.round((pendingRequests / availableDrivers) * 100) / 100;

  return {
    active_drivers: activeDrivers,
    busy_drivers: busyDrivers,
    idle_drivers: idleDrivers,
    pending_requests: pendingRequests,
    demand_supply_ratio: ratio,
    timestamp: new Date().toISOString(),
  };
}

function updateSurgePricing(ds: DemandSupplyState): SurgeState {
  const prevMultiplier = surgePriceMultiplier;

  if (ds.demand_supply_ratio > REVENUE_SURGE_THRESHOLD) {
    const pressure = Math.min(1, (ds.demand_supply_ratio - REVENUE_SURGE_THRESHOLD) / 2);
    const target = 1.0 + pressure * (REVENUE_SURGE_MAX - 1.0);
    surgePriceMultiplier = Math.min(REVENUE_SURGE_MAX, surgePriceMultiplier + REVENUE_SURGE_STEP);
    surgePriceMultiplier = Math.min(surgePriceMultiplier, target);
  } else if (ds.demand_supply_ratio < 0.5) {
    surgePriceMultiplier = Math.max(REVENUE_SURGE_MIN, surgePriceMultiplier - REVENUE_SURGE_STEP * 0.5);
  } else {
    if (surgePriceMultiplier > 1.0) {
      surgePriceMultiplier = Math.max(1.0, surgePriceMultiplier - REVENUE_SURGE_STEP * 0.3);
    } else if (surgePriceMultiplier < 1.0) {
      surgePriceMultiplier = Math.min(1.0, surgePriceMultiplier + REVENUE_SURGE_STEP * 0.3);
    }
  }

  surgePriceMultiplier = Math.round(surgePriceMultiplier * 100) / 100;

  let trend: SurgeState["trend"] = "stable";
  if (surgePriceMultiplier > prevMultiplier + 0.01) trend = "increasing";
  else if (surgePriceMultiplier < prevMultiplier - 0.01) trend = "decreasing";

  if (trend !== "stable") {
    lastSurgeChangeAt = new Date().toISOString();
    if (surgePriceMultiplier > 1.05) {
      revenueLog(`surge=${surgePriceMultiplier.toFixed(2)} ${ds.demand_supply_ratio > REVENUE_SURGE_THRESHOLD ? "high demand" : "normalizing"} (ratio=${ds.demand_supply_ratio})`);
    }
  }

  return {
    multiplier: surgePriceMultiplier,
    trend,
    trigger_ratio: ds.demand_supply_ratio,
    last_change_at: lastSurgeChangeAt || new Date().toISOString(),
  };
}

function rankDriversForDispatch(): DriverRanking[] {
  const rankings: DriverRanking[] = [];

  for (const driver of liveDrivers) {
    if (!driver.wsConnected || !driver.isOnline) continue;
    const stats = driverBehaviorStats.get(driver.id);

    const totalDecisions = stats ? stats.accepts + stats.rejects : 0;
    const acceptanceRate = totalDecisions > 0 ? stats!.accepts / totalDecisions : 0.5;
    const avgResponseMs = stats?.responseTimes.length
      ? stats.responseTimes.reduce((s, t) => s + t, 0) / stats.responseTimes.length
      : 2000;
    const completionRate = stats && stats.accepts > 0
      ? stats.ridesCompleted / stats.accepts
      : 0.5;
    const isIdle = !driver.isBusy;
    const idleTimePct = stats && stats.totalTicks > 0
      ? ((stats.totalTicks - stats.busyTicks) / stats.totalTicks) * 100
      : 100;

    let priorityScore = 0;
    switch (currentRevenueMode) {
      case "aggressive":
        priorityScore = acceptanceRate * 0.30 + Math.max(0, 1 - avgResponseMs / 5000) * 0.30 + completionRate * 0.25 + (isIdle ? 0.15 : 0);
        break;
      case "conservative":
        priorityScore = acceptanceRate * 0.25 + Math.max(0, 1 - avgResponseMs / 5000) * 0.20 + completionRate * 0.30 + (isIdle ? 0.25 : 0);
        break;
      case "surge_heavy":
        priorityScore = acceptanceRate * 0.40 + Math.max(0, 1 - avgResponseMs / 5000) * 0.35 + completionRate * 0.15 + (isIdle ? 0.10 : 0);
        break;
    }

    priorityScore = Math.round(priorityScore * 1000) / 1000;

    rankings.push({
      driverId: driver.id,
      city: driver.city,
      acceptance_rate: Math.round(acceptanceRate * 1000) / 10,
      avg_response_ms: Math.round(avgResponseMs),
      completion_rate: Math.round(completionRate * 1000) / 10,
      idle_time_pct: Math.round(idleTimePct * 10) / 10,
      priority_score: priorityScore,
      tier: classifyDriverTier(priorityScore),
      is_idle: isIdle,
    });
  }

  rankings.sort((a, b) => {
    if (a.is_idle !== b.is_idle) return a.is_idle ? -1 : 1;
    return b.priority_score - a.priority_score;
  });

  return rankings.slice(0, 50);
}

function computeRevenueMetrics(): RevenueMetrics {
  const elapsedMin = revenueStartedAt > 0
    ? Math.max(1, (Date.now() - revenueStartedAt) / 60000)
    : 1;
  const avgFare = 50000;
  const adjustedFare = Math.round(avgFare * surgePriceMultiplier);

  const totalRevenue = liveMetrics.accepted * adjustedFare;
  const revenuePerMinute = Math.round(totalRevenue / elapsedMin);
  const completedRides = liveMetrics.accepted;
  const activeDrivers = liveDrivers.filter(d => d.wsConnected && d.isOnline).length;
  const busyDrivers = liveDrivers.filter(d => d.isBusy).length;
  const utilization = activeDrivers > 0 ? Math.round((busyDrivers / activeDrivers) * 1000) / 10 : 0;

  const now = Date.now();
  revenueSnapshots.push({ ts: now, revenue: totalRevenue, rides: completedRides, utilization });
  if (revenueSnapshots.length > 30) revenueSnapshots.splice(0, revenueSnapshots.length - 30);

  let revenueTrend: "growing" | "stable" | "declining" = "stable";
  if (revenueSnapshots.length >= 4) {
    const recent = revenueSnapshots.slice(-4);
    const slope = (recent[3].revenue - recent[0].revenue) / 3;
    if (slope > adjustedFare * 0.5) revenueTrend = "growing";
    else if (slope < -adjustedFare * 0.5) revenueTrend = "declining";
  }

  return {
    revenue_per_minute: revenuePerMinute,
    completed_rides: completedRides,
    avg_ride_price: adjustedFare,
    driver_utilization_pct: utilization,
    total_revenue: totalRevenue,
    revenue_trend: revenueTrend,
    idle_driver_assignments: revenueIdleAssignments,
    top_driver_assignments: revenueTopDriverAssignments,
  };
}

function evaluateRevenueStrategy() {
  const now = Date.now();
  if (now - lastRevenueEvalAt < REVENUE_EVAL_INTERVAL_MS) return;
  lastRevenueEvalAt = now;

  if (revenueSnapshots.length < 3) return;

  const windowSnaps = revenueSnapshots.slice(-5);
  const first = windowSnaps[0];
  const last = windowSnaps[windowSnaps.length - 1];
  const windowS = Math.max(1, (last.ts - first.ts) / 1000);

  const revenueDelta = last.revenue > 0 && first.revenue > 0
    ? Math.round(((last.revenue - first.revenue) / Math.max(1, first.revenue)) * 1000) / 10
    : 0;
  const utilizationDelta = Math.round((last.utilization - first.utilization) * 10) / 10;
  const ridesDelta = last.rides - first.rides;

  const score =
    (revenueDelta > 0 ? 0.4 : -0.2) +
    (utilizationDelta > 0 ? 0.3 : -0.1) +
    (ridesDelta > 0 ? 0.3 : -0.1);

  const result: RevenueStrategyResult = {
    mode: currentRevenueMode,
    score: Math.round(score * 1000) / 1000,
    revenue_delta_pct: revenueDelta,
    utilization_delta_pct: utilizationDelta,
    rides_delta: ridesDelta,
    evaluation_window_s: Math.round(windowS),
    evaluated_at: new Date().toISOString(),
  };

  revenueStrategyHistory.push(result);
  if (revenueStrategyHistory.length > 30) revenueStrategyHistory.splice(0, revenueStrategyHistory.length - 30);

  const modeScores: Record<RevenueStrategyMode, { total: number; count: number }> = {
    aggressive: { total: 0, count: 0 },
    conservative: { total: 0, count: 0 },
    surge_heavy: { total: 0, count: 0 },
  };
  for (const r of revenueStrategyHistory) {
    modeScores[r.mode].total += r.score;
    modeScores[r.mode].count++;
  }

  let bestMode: RevenueStrategyMode = currentRevenueMode;
  let bestAvg = -Infinity;
  for (const mode of REVENUE_STRATEGY_MODES) {
    const ms = modeScores[mode];
    const avg = ms.count > 0 ? ms.total / ms.count : 0;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestMode = mode;
    }
  }

  if (revenueStrategyHistory.length >= 3 && bestMode !== currentRevenueMode) {
    const prev = currentRevenueMode;
    currentRevenueMode = bestMode;
    revenueLog(`strategy switch: ${prev} → ${bestMode} (avg_score=${bestAvg.toFixed(3)})`);
  }

  if (revenueDelta > 0) {
    revenueLog(`revenue increased +${revenueDelta.toFixed(1)}% (mode=${currentRevenueMode}, utilization_delta=${utilizationDelta > 0 ? "+" : ""}${utilizationDelta}%)`);
  }

  const rankings = rankDriversForDispatch();
  const topCount = rankings.filter(r => r.tier === "top" || r.tier === "good").length;
  const idleCount = rankings.filter(r => r.is_idle).length;
  if (topCount > 0) {
    revenueLog(`prioritized top drivers: ${topCount} top/good drivers available, ${idleCount} idle`);
  }
}

let cachedDemandSupply: DemandSupplyState = { active_drivers: 0, busy_drivers: 0, idle_drivers: 0, pending_requests: 0, demand_supply_ratio: 0, timestamp: new Date().toISOString() };
let cachedSurge: SurgeState = { multiplier: 1.0, trend: "stable", trigger_ratio: 0, last_change_at: new Date().toISOString() };

function runRevenueAICycle() {
  if (!liveMetrics.running) return;
  if (!revenueAIEnabled) {
    revenueAIEnabled = true;
    revenueStartedAt = Date.now();
    revenueLog("Revenue AI activated");
  }

  cachedDemandSupply = computeDemandSupply();
  cachedSurge = updateSurgePricing(cachedDemandSupply);
  computeRevenueMetrics();
  evaluateRevenueStrategy();
}

function getBestRevenueStrategy(): RevenueStrategyMode {
  if (revenueStrategyHistory.length === 0) return "conservative";

  const modeScores: Record<RevenueStrategyMode, { total: number; count: number }> = {
    aggressive: { total: 0, count: 0 },
    conservative: { total: 0, count: 0 },
    surge_heavy: { total: 0, count: 0 },
  };
  for (const r of revenueStrategyHistory) {
    modeScores[r.mode].total += r.score;
    modeScores[r.mode].count++;
  }

  let best: RevenueStrategyMode = "conservative";
  let bestAvg = -Infinity;
  for (const mode of REVENUE_STRATEGY_MODES) {
    const ms = modeScores[mode];
    const avg = ms.count > 0 ? ms.total / ms.count : 0;
    if (avg > bestAvg) {
      bestAvg = avg;
      best = mode;
    }
  }
  return best;
}

export function getRevenueAIStatus(): RevenueAIState {
  const rankings = rankDriversForDispatch();
  const latestSnap = revenueSnapshots.length > 0 ? revenueSnapshots[revenueSnapshots.length - 1] : null;
  const elapsedMin = revenueStartedAt > 0 ? Math.max(1, (Date.now() - revenueStartedAt) / 60000) : 1;
  const adjustedFare = Math.round(50000 * surgePriceMultiplier);

  const metrics: RevenueMetrics = {
    revenue_per_minute: latestSnap ? Math.round(latestSnap.revenue / elapsedMin) : 0,
    completed_rides: liveMetrics.accepted,
    avg_ride_price: adjustedFare,
    driver_utilization_pct: latestSnap ? latestSnap.utilization : 0,
    total_revenue: latestSnap ? latestSnap.revenue : 0,
    revenue_trend: revenueSnapshots.length >= 4
      ? (() => {
          const recent = revenueSnapshots.slice(-4);
          const slope = (recent[3].revenue - recent[0].revenue) / 3;
          if (slope > adjustedFare * 0.5) return "growing" as const;
          if (slope < -adjustedFare * 0.5) return "declining" as const;
          return "stable" as const;
        })()
      : "stable",
    idle_driver_assignments: revenueIdleAssignments,
    top_driver_assignments: revenueTopDriverAssignments,
  };

  return {
    enabled: revenueAIEnabled,
    current_mode: currentRevenueMode,
    demand_supply: cachedDemandSupply,
    surge: cachedSurge,
    driver_rankings: rankings,
    metrics,
    strategy_results: revenueStrategyHistory.slice(-10),
    best_strategy: getBestRevenueStrategy(),
    logs: revenueAILogs.slice(-30),
  };
}

function resetRevenueAIState() {
  revenueAIEnabled = false;
  currentRevenueMode = "conservative";
  surgePriceMultiplier = 1.0;
  lastSurgeChangeAt = "";
  revenueAILogs.length = 0;
  revenueTotalFromStart = 0;
  revenueCompletedRides = 0;
  revenueIdleAssignments = 0;
  revenueTopDriverAssignments = 0;
  lastRevenueEvalAt = 0;
  revenueStartedAt = 0;
  revenueStrategyHistory.length = 0;
  revenueSnapshots.length = 0;
}

// ═══════════════════════════════════════════════════════════════════
// END REVENUE OPTIMIZATION AI LAYER
// ═══════════════════════════════════════════════════════════════════

const actionBlacklist = new Map<RecoveryType, { until: number; consecutive_fails: number }>();
const actionRetryTracker = new Map<RecoveryType, { retried: boolean }>();
const BLACKLIST_DURATION_MS = 60_000;
const BLACKLIST_FAIL_THRESHOLD = 3;
const EARLY_STOP_IMPROVEMENT_THRESHOLD = 0.15;

interface TrendSample {
  ts: number;
  success_rate: number;
  avg_latency: number;
  ws_connections: number;
  health: number;
}

const trendHistory: TrendSample[] = [];
const TREND_WINDOW_MS = 15_000;
const TREND_SAMPLE_INTERVAL_MS = 2_000;
let lastTrendSampleAt = 0;
let preventiveActionCooldownUntil = 0;
const PREVENTIVE_COOLDOWN_MS = 20_000;

interface ContextEffectiveness {
  bucket: ContextBucket;
  uses: number;
  total_delta: number;
  avg_delta: number;
  successes: number;
}

const contextEffectivenessMap = new Map<string, ContextEffectiveness>();

function getContextKey(action: RecoveryType, bucket: ContextBucket): string {
  return `${action}:${bucket}`;
}

function recordContextEffectiveness(action: RecoveryType, bucket: ContextBucket, delta: number, success: boolean) {
  const key = getContextKey(action, bucket);
  const entry = contextEffectivenessMap.get(key) || { bucket, uses: 0, total_delta: 0, avg_delta: 0, successes: 0 };
  entry.uses++;
  entry.total_delta += delta;
  entry.avg_delta = entry.total_delta / entry.uses;
  if (success) entry.successes++;
  contextEffectivenessMap.set(key, entry);
}

function getContextEffectiveness(action: RecoveryType, bucket: ContextBucket): ContextEffectiveness | null {
  return contextEffectivenessMap.get(getContextKey(action, bucket)) || null;
}

function getLoadBucket(): ContextBucket {
  return getContextBucket();
}

function sampleTrend() {
  const now = Date.now();
  if (now - lastTrendSampleAt < TREND_SAMPLE_INTERVAL_MS) return;
  lastTrendSampleAt = now;

  const health = computeHealthScore();
  trendHistory.push({
    ts: now,
    success_rate: liveMetrics.success_rate,
    avg_latency: liveMetrics.avg_response_time,
    ws_connections: liveMetrics.ws_connections,
    health: health.value,
  });

  const cutoff = now - TREND_WINDOW_MS * 2;
  while (trendHistory.length > 0 && trendHistory[0].ts < cutoff) {
    trendHistory.shift();
  }
}

interface TrendAnalysis {
  sr_slope: number;
  latency_slope: number;
  health_slope: number;
  sr_dropping: boolean;
  latency_rising: boolean;
  health_degrading: boolean;
  predicted_issue: string | null;
}

function analyzeTrend(): TrendAnalysis {
  const result: TrendAnalysis = {
    sr_slope: 0, latency_slope: 0, health_slope: 0,
    sr_dropping: false, latency_rising: false, health_degrading: false,
    predicted_issue: null,
  };

  const now = Date.now();
  const windowSamples = trendHistory.filter(s => s.ts >= now - TREND_WINDOW_MS);
  if (windowSamples.length < 4) return result;

  const n = windowSamples.length;
  const first = windowSamples[0];
  const last = windowSamples[n - 1];
  const timeDeltaS = (last.ts - first.ts) / 1000;
  if (timeDeltaS < 5) return result;

  result.sr_slope = (last.success_rate - first.success_rate) / timeDeltaS;
  result.latency_slope = (last.avg_latency - first.avg_latency) / timeDeltaS;
  result.health_slope = (last.health - first.health) / timeDeltaS;

  result.sr_dropping = result.sr_slope < -1.5 && last.success_rate > 75;
  result.latency_rising = result.latency_slope > 20 && last.avg_latency > 200 && last.avg_latency < 500;
  result.health_degrading = result.health_slope < -0.01;

  if (result.sr_dropping) {
    result.predicted_issue = "success_rate_decline";
  } else if (result.latency_rising) {
    result.predicted_issue = "latency_increase";
  } else if (result.health_degrading && last.health < 0.75) {
    result.predicted_issue = "health_degradation";
  }

  return result;
}

function computeConfidence(type: RecoveryType): number {
  const score = getScore(type);
  const bucket = getLoadBucket();
  const ctxEff = getContextEffectiveness(type, bucket);

  const historyCount = score.history.length;
  const dataSufficiency = Math.min(1, historyCount / 10);

  const recentEntries = score.history.slice(-5);
  const successRate = recentEntries.length > 0
    ? recentEntries.filter(e => e.result === "success").length / recentEntries.length
    : 0.5;

  const contextMatch = ctxEff && ctxEff.uses >= 2 ? 1 : ctxEff && ctxEff.uses >= 1 ? 0.5 : 0;

  const lastExec = getLastExecTime(type);
  const recency = lastExec > 0 ? Math.min(1, (Date.now() - lastExec) / 120_000) : 0;

  const confidence = dataSufficiency * 0.3 + successRate * 0.3 + contextMatch * 0.25 + (1 - recency) * 0.15;
  return Math.round(confidence * 1000) / 1000;
}

function computeMultiObjectiveHealth(): { value: number; sr: number; latency: number; ws: number; trend: TrendAnalysis } {
  const health = computeHealthScore();
  const trend = analyzeTrend();
  return {
    value: health.value,
    sr: health.sr_component,
    latency: health.latency_component,
    ws: health.ws_component,
    trend,
  };
}

function executePreventiveAction(issue: string, phase: string) {
  const now = Date.now();
  if (now < preventiveActionCooldownUntil) return;
  preventiveActionCooldownUntil = now + PREVENTIVE_COOLDOWN_MS;

  const bucket = getLoadBucket();
  console.log(`[AI] predicted issue: ${issue} context=${bucket}`);

  const snap = takeSnapshot();

  if (issue === "latency_increase" || issue === "health_degradation") {
    console.log(`[AI] preventive action=soft_load_reduce (reducing interval multiplier slightly)`);
    if (currentRideIntervalMultiplier < 2) {
      currentRideIntervalMultiplier = Math.min(currentRideIntervalMultiplier * 1.15, 2);
      console.log(`[AI] ride interval multiplier adjusted to ${currentRideIntervalMultiplier.toFixed(2)} (soft reduction)`);
    }
    const action: RecoveryAction = {
      id: `rec-${++recoveryIdCounter}`,
      type: "load_reduce",
      trigger: `preventive: ${issue}`,
      message: `[AI] Превентивное снижение нагрузки (${issue})`,
      detail: `context=${bucket}, multiplier=${currentRideIntervalMultiplier.toFixed(2)}`,
      timestamp: new Date().toISOString(),
      result: "success",
      duration_ms: 0,
      metrics_before: snap,
    };
    recoveryActions.push(action);
    if (recoveryActions.length > 50) recoveryActions.splice(0, recoveryActions.length - 50);
  } else if (issue === "success_rate_decline") {
    console.log(`[AI] preventive action=soft_dispatch_restart (pre-emptive dispatch cycle reset)`);
    autoRestartDispatchCycle();
    const action: RecoveryAction = {
      id: `rec-${++recoveryIdCounter}`,
      type: "dispatch_restart",
      trigger: `preventive: ${issue}`,
      message: `[AI] Превентивный перезапуск диспетчера (${issue})`,
      detail: `context=${bucket}`,
      timestamp: new Date().toISOString(),
      result: "success",
      duration_ms: 0,
      metrics_before: snap,
    };
    recoveryActions.push(action);
    if (recoveryActions.length > 50) recoveryActions.splice(0, recoveryActions.length - 50);
  }
}

function detectRootCause(): RootCause {
  const offlineDrivers = liveDrivers.filter(d => !d.wsConnected || !d.wsAuthed).length;
  const totalDrivers = liveDrivers.length;
  const offlineRatio = totalDrivers > 0 ? offlineDrivers / totalDrivers : 0;

  const hasLowAccept = liveMetrics.success_rate < 70;
  const hasHighLatency = liveMetrics.avg_response_time > 800;
  const hasWsDrop = offlineRatio > 0.3;
  const hasBugs = liveMetrics.critical_bugs > 0;

  if (hasBugs) return "critical_failure";
  if (offlineRatio > 0.2 && hasLowAccept) return "driver_availability_issue";
  if (hasLowAccept) return "driver_availability_issue";
  if (hasWsDrop) return "connection_issue";
  if (hasHighLatency) return "backend_overload";
  return "unknown";
}

function isSystemRecovered(): boolean {
  return liveMetrics.success_rate > 85 && liveMetrics.avg_response_time < 300 &&
    (prevWsConnections === 0 || liveMetrics.ws_connections >= prevWsConnections * 0.85);
}

function isActionBlacklisted(type: RecoveryType): boolean {
  const entry = actionBlacklist.get(type);
  if (!entry) return false;
  if (Date.now() >= entry.until) {
    actionBlacklist.delete(type);
    console.log(`[SMART] blacklist expired for ${type}`);
    return false;
  }
  return true;
}

function recordActionFailure(type: RecoveryType) {
  const entry = actionBlacklist.get(type) || { until: 0, consecutive_fails: 0 };
  entry.consecutive_fails++;
  if (entry.consecutive_fails >= BLACKLIST_FAIL_THRESHOLD) {
    entry.until = Date.now() + BLACKLIST_DURATION_MS;
    actionBlacklist.set(type, entry);
    console.log(`[SMART] action ${type} BLACKLISTED for ${BLACKLIST_DURATION_MS / 1000}s (${entry.consecutive_fails} consecutive failures)`);
  } else {
    actionBlacklist.set(type, entry);
  }
}

function recordActionSuccess(type: RecoveryType) {
  const entry = actionBlacklist.get(type);
  if (entry) {
    entry.consecutive_fails = 0;
    actionBlacklist.set(type, entry);
  }
}

function computeSmartScore(type: RecoveryType): number {
  const score = getScore(type);
  const bucket = getLoadBucket();
  const ctxEff = getContextEffectiveness(type, bucket);

  const effectiveness = ctxEff && ctxEff.uses >= 2
    ? ctxEff.avg_delta * 0.7 + score.avg_effectiveness * 0.3
    : score.avg_effectiveness;

  const recentEntries = score.history.slice(-5);
  const recentSuccessRate = recentEntries.length > 0
    ? recentEntries.filter(e => e.result === "success").length / recentEntries.length
    : 0.5;

  const lastExec = getLastExecTime(type);
  const timeSinceLastMs = lastExec > 0 ? Date.now() - lastExec : 60_000;
  const latencyPenalty = timeSinceLastMs < 5000 ? 0.3 : timeSinceLastMs < 10000 ? 0.15 : 0;

  const confidence = computeConfidence(type);
  const contextBonus = ctxEff && ctxEff.uses >= 2 ? 0.05 : 0;
  const confidenceWeight = 0.5 + confidence * 0.5;

  const finalScore = (effectiveness * 0.6 + recentSuccessRate * 0.3 - latencyPenalty * 0.1 + contextBonus) * confidenceWeight;
  return Math.round(finalScore * 1000) / 1000;
}

function buildAdaptivePlaybook(basePlaybook: RecoveryType[]): RecoveryType[] {
  const scored = basePlaybook.map(type => ({
    type,
    score: computeSmartScore(type),
  }));

  scored.sort((a, b) => b.score - a.score);

  const sorted = scored.map(s => s.type);
  console.log(`[SMART] adaptive playbook: ${scored.map(s => `${s.type}(${s.score})`).join(" → ")}`);
  return sorted;
}

function canRunAction(type: RecoveryType): boolean {
  if (isActionBlacklisted(type)) {
    console.log(`[SMART] blocked ${type}: blacklisted`);
    return false;
  }
  const consecutive = actionConsecutiveCount.get(type) || 0;
  if (consecutive >= 2) {
    console.log(`[RECOVERY] blocked ${type}: ran ${consecutive} times consecutively (max 2)`);
    return false;
  }
  const lastExec = getLastExecTime(type);
  const score = actionScores.get(type);
  const cooldown = score ? score.current_cooldown_ms : BASE_COOLDOWNS[type];
  if (lastExec > 0 && Date.now() - lastExec < cooldown) {
    console.log(`[RECOVERY] blocked ${type}: cooldown active (${Math.round((cooldown - (Date.now() - lastExec)) / 1000)}s left)`);
    return false;
  }
  return true;
}

function trackActionConsecutive(type: RecoveryType) {
  for (const t of ALL_RECOVERY_TYPES) {
    if (t === type) {
      actionConsecutiveCount.set(t, (actionConsecutiveCount.get(t) || 0) + 1);
    } else {
      actionConsecutiveCount.set(t, 0);
    }
  }
}

function executePlaybookAction(type: RecoveryType): boolean {
  if (!canRunAction(type)) return false;

  trackActionConsecutive(type);
  const before = takeSnapshot();

  const effLog = actionEffectivenessLog.get(type) || [];
  effLog.push({ before, after: null, delta: 0 });
  if (effLog.length > 20) effLog.splice(0, effLog.length - 20);
  actionEffectivenessLog.set(type, effLog);

  const smartScore = computeSmartScore(type);
  console.log(`[SMART] selected action=${type} score=${smartScore}`);
  executeRecovery(type);
  return true;
}

function checkEarlyStopImprovement(lastAction: RecoveryType): boolean {
  const effLog = actionEffectivenessLog.get(lastAction);
  if (!effLog || effLog.length === 0) return false;

  const last = effLog[effLog.length - 1];
  if (last.after) return false;

  last.after = takeSnapshot();
  last.delta = (last.after.success_rate - last.before.success_rate) / 100 +
    (last.before.avg_latency - last.after.avg_latency) / 1000;

  if (last.delta >= EARLY_STOP_IMPROVEMENT_THRESHOLD && isSystemRecovered()) {
    console.log(`[SMART] early stop after improvement: delta=${last.delta.toFixed(3)} >= threshold=${EARLY_STOP_IMPROVEMENT_THRESHOLD} AND system recovered (action=${lastAction})`);
    recordActionSuccess(lastAction);
    return true;
  }

  if (last.delta < 0) {
    recordActionFailure(lastAction);
    console.log(`[SMART] action ${lastAction} had negative effect: delta=${last.delta.toFixed(3)}`);
  } else if (last.delta >= EARLY_STOP_IMPROVEMENT_THRESHOLD) {
    recordActionSuccess(lastAction);
    console.log(`[SMART] improvement detected (delta=${last.delta.toFixed(3)}) but system not yet recovered, continuing recovery`);
  } else {
    recordActionSuccess(lastAction);
  }

  return false;
}

function startAutonomousRecovery(incident: Incident) {
  if (autonomousRecoveryActive) return;
  autonomousRecoveryActive = true;

  const basePlaybook = RECOVERY_PLAYBOOK[incident.type] || RECOVERY_PLAYBOOK.success_rate;
  incident.playbook_step = 0;
  incident.root_cause = detectRootCause();
  actionRetryTracker.clear();

  const ctx = getContextBucket();
  const { strategy, exploration } = selectStrategy(incident.type, ctx, basePlaybook);
  const playbook = buildAdaptivePlaybook(strategy.sequence);

  beginStrategyExecution(strategy.id, incident.id);
  console.log(`[RECOVERY] === AUTONOMOUS RECOVERY STARTED for ${incident.id} (${incident.type}) root_cause=${incident.root_cause} strategy=${strategy.id} [${strategy.sequence.join("→")}] ${exploration ? "(exploration)" : "(exploitation)"} ===`);

  const isCriticalSeverity = LEVEL_RANK[incident.max_severity] >= LEVEL_RANK["critical"];

  if (isCriticalSeverity && playbook.length >= 2) {
    const parallel = playbook.filter(t => canRunAction(t)).slice(0, 3);
    if (parallel.length >= 2) {
      console.log(`[RECOVERY] CRITICAL/EMERGENCY: parallel execution of ${parallel.length} actions: ${parallel.join(", ")}`);
      for (const action of parallel) {
        if (executePlaybookAction(action)) {
          incident.recovery_actions.push(action);
          if (activeStrategyExecution) activeStrategyExecution.actions_executed.push(action);
        }
      }
      incident.playbook_step = parallel.length;
      scheduleRetryCheck(incident, playbook);
      return;
    }
  }

  const bestAction = playbook.find(t => canRunAction(t));
  if (bestAction) {
    const skipped = playbook.filter(t => t !== bestAction && !canRunAction(t));
    for (const s of skipped) {
      console.log(`[SMART] skipped action=${s} (${isActionBlacklisted(s) ? "blacklisted" : "low score/blocked"})`);
    }
    if (executePlaybookAction(bestAction)) {
      incident.recovery_actions.push(bestAction);
      incident.playbook_step = 1;
      if (activeStrategyExecution) activeStrategyExecution.actions_executed.push(bestAction);
    }
  }

  scheduleRetryCheck(incident, playbook);
}

function scheduleRetryCheck(incident: Incident, playbook: RecoveryType[]) {
  if (autonomousRecoveryTimer) clearTimeout(autonomousRecoveryTimer);

  autonomousRecoveryTimer = setTimeout(() => {
    if (!incident.active) {
      stopAutonomousRecovery(incident, "incident already resolved");
      return;
    }

    const lastActions = incident.recovery_actions;
    if (lastActions.length > 0) {
      const lastAction = lastActions[lastActions.length - 1] as RecoveryType;

      if (checkEarlyStopImprovement(lastAction)) {
        incident.recovered_by = lastAction;
        console.log(`[SMART] early stop — improvement detected by ${lastAction} (incident ${incident.id})`);
        stopAutonomousRecovery(incident, `early stop: improvement by ${lastAction}`);
        return;
      }
    }

    for (const actionType of lastActions.slice(-3)) {
      const effLog = actionEffectivenessLog.get(actionType as RecoveryType);
      if (effLog && effLog.length > 0) {
        const last = effLog[effLog.length - 1];
        if (!last.after) {
          last.after = takeSnapshot();
          last.delta = (last.after.success_rate - last.before.success_rate) / 100 +
            (last.before.avg_latency - last.after.avg_latency) / 1000;
          if (last.delta < 0) recordActionFailure(actionType as RecoveryType);
          else recordActionSuccess(actionType as RecoveryType);
        }
      }
    }

    if (isSystemRecovered()) {
      const lastAction = incident.recovery_actions[incident.recovery_actions.length - 1] || "unknown";
      incident.recovered_by = lastAction;
      console.log(`[RECOVERY] success — system recovered by ${lastAction} (incident ${incident.id})`);
      stopAutonomousRecovery(incident, `recovered by ${lastAction}`);
      return;
    }

    incident.root_cause = detectRootCause();

    const adaptivePlaybook = buildAdaptivePlaybook(
      RECOVERY_PLAYBOOK[incident.type] || RECOVERY_PLAYBOOK.success_rate
    );

    const tried = new Set(incident.recovery_actions);
    const nextAction = adaptivePlaybook.find(t => canRunAction(t) && !tried.has(t));

    if (!nextAction) {
      const triedActions = [...new Set(incident.recovery_actions)] as RecoveryType[];
      const rankedTried = triedActions
        .map(t => ({ type: t, score: computeSmartScore(t) }))
        .sort((a, b) => b.score - a.score);

      const retryCandidate = rankedTried.find(({ type: t }) => {
        if (!canRunAction(t)) return false;
        const tracker = actionRetryTracker.get(t);
        if (tracker && tracker.retried) return false;
        return true;
      });

      if (retryCandidate) {
        actionRetryTracker.set(retryCandidate.type, { retried: true });
        console.log(`[SMART] fast retry: retrying highest-ranked tried action=${retryCandidate.type} score=${retryCandidate.score} (1 allowed retry)`);
        if (executePlaybookAction(retryCandidate.type)) {
          incident.recovery_actions.push(retryCandidate.type);
          incident.playbook_step++;
          if (activeStrategyExecution) activeStrategyExecution.actions_executed.push(retryCandidate.type);
        }
        scheduleRetryCheck(incident, playbook);
        return;
      }

      console.log(`[RECOVERY] failed — all strategies exhausted for ${incident.id}`);
      stopAutonomousRecovery(incident, "all strategies exhausted");
      return;
    }

    const smartScore = computeSmartScore(nextAction);
    console.log(`[SMART] selected action=${nextAction} score=${smartScore} (step ${incident.playbook_step + 1}) for ${incident.id}`);

    const skipped = adaptivePlaybook.filter(t => t !== nextAction && (!canRunAction(t) || tried.has(t)));
    for (const s of skipped) {
      const reason = isActionBlacklisted(s) ? "blacklisted" : tried.has(s) ? "already tried" : "blocked";
      console.log(`[SMART] skipped action=${s} (${reason})`);
    }

    if (executePlaybookAction(nextAction)) {
      incident.recovery_actions.push(nextAction);
      incident.playbook_step++;
      if (activeStrategyExecution) activeStrategyExecution.actions_executed.push(nextAction);
      console.log(`[RECOVERY] executing ${nextAction}, will re-evaluate in 10s`);
    } else {
      incident.playbook_step++;
      console.log(`[RECOVERY] ${nextAction} blocked at execution, advancing`);
    }

    scheduleRetryCheck(incident, playbook);
  }, 10_000);
}

function stopAutonomousRecovery(incident: Incident, reason: string) {
  autonomousRecoveryActive = false;
  if (autonomousRecoveryTimer) {
    clearTimeout(autonomousRecoveryTimer);
    autonomousRecoveryTimer = null;
  }

  const success = reason.includes("recovered") || reason.includes("early stop") || reason.includes("improvement") || reason.includes("resolved");
  completeStrategyExecution(success);

  console.log(`[RECOVERY] === AUTONOMOUS RECOVERY STOPPED for ${incident.id}: ${reason} ===`);
}

export function getActionEffectiveness(): Record<string, {
  uses: number; avg_delta: number; last_delta: number; smart_score: number;
  blacklisted: boolean; consecutive_fails: number; confidence: number;
  context_bucket: ContextBucket; context_effectiveness: ContextEffectiveness | null;
}> {
  const bucket = getLoadBucket();
  const result: Record<string, any> = {};
  for (const type of ALL_RECOVERY_TYPES) {
    const log = actionEffectivenessLog.get(type);
    const completed = log ? log.filter(e => e.after !== null) : [];
    const avgDelta = completed.length > 0 ? completed.reduce((s, e) => s + e.delta, 0) / completed.length : 0;
    const lastDelta = completed.length > 0 ? completed[completed.length - 1].delta : 0;
    const blacklisted = isActionBlacklisted(type);
    const blEntry = actionBlacklist.get(type);
    result[type] = {
      uses: completed.length,
      avg_delta: Math.round(avgDelta * 1000) / 1000,
      last_delta: Math.round(lastDelta * 1000) / 1000,
      smart_score: computeSmartScore(type),
      blacklisted,
      consecutive_fails: blEntry ? blEntry.consecutive_fails : 0,
      confidence: computeConfidence(type),
      context_bucket: bucket,
      context_effectiveness: getContextEffectiveness(type, bucket),
    };
  }
  return result;
}

export function getTrendAnalysis() {
  return analyzeTrend();
}

export function getAIStatus() {
  const trend = analyzeTrend();
  const bucket = getLoadBucket();
  const health = computeMultiObjectiveHealth();
  const preventiveActions = recoveryActions.filter(a => a.trigger.startsWith("preventive:"));
  return {
    trend,
    context_bucket: bucket,
    health,
    preventive_actions_count: preventiveActions.length,
    preventive_cooldown_remaining: Math.max(0, preventiveActionCooldownUntil - Date.now()),
    trend_samples: trendHistory.length,
    actions: ALL_RECOVERY_TYPES.map(type => ({
      type,
      smart_score: computeSmartScore(type),
      confidence: computeConfidence(type),
      context_effectiveness: getContextEffectiveness(type, bucket),
    })),
  };
}

function getOrCreateIncident(type: AlertType, reason: AlertReason): Incident {
  let incident = liveIncidents.find(i => i.type === type && i.active);
  if (!incident) {
    incidentIdCounter++;
    incident = {
      id: `inc-${incidentIdCounter}`,
      type,
      start_time: new Date().toISOString(),
      last_update: new Date().toISOString(),
      max_severity: "info",
      active: true,
      reason,
      root_cause: detectRootCause(),
      alert_count: 0,
      avg_value: 0,
      duration_s: 0,
      recovery_actions: [],
      recovered_by: "",
      playbook_step: 0,
    };
    liveIncidents.push(incident);
    if (liveIncidents.length > 50) liveIncidents.splice(0, liveIncidents.length - 50);
    console.log(`[INCIDENT] Started: ${incident.id} type=${type} reason=${reason} root_cause=${incident.root_cause}`);
  }
  return incident;
}

function updateIncident(incident: Incident, level: AlertLevel, avgValue: number, count: number) {
  incident.last_update = new Date().toISOString();
  incident.alert_count = count;
  incident.avg_value = avgValue;
  incident.duration_s = Math.round((Date.now() - new Date(incident.start_time).getTime()) / 1000);
  if (LEVEL_RANK[level] > LEVEL_RANK[incident.max_severity]) {
    incident.max_severity = level;
    console.log(`[INCIDENT] Escalated: ${incident.id} → ${level}`);
  }
}

function resolveIncident(type: AlertType) {
  const incident = liveIncidents.find(i => i.type === type && i.active);
  if (incident) {
    incident.active = false;
    incident.last_update = new Date().toISOString();
    incident.duration_s = Math.round((Date.now() - new Date(incident.start_time).getTime()) / 1000);
    console.log(`[INCIDENT] Resolved: ${incident.id} after ${incident.duration_s}s, ${incident.alert_count} alerts, max=${incident.max_severity}, recovered_by=${incident.recovered_by || "natural"}, actions=${incident.recovery_actions.join(",") || "none"}`);
    if (autonomousRecoveryActive) {
      stopAutonomousRecovery(incident, "incident resolved");
    }
  }
}

function resetSmartAlertState() {
  alertTrackers.clear();
  globalAlertTimestamps.length = 0;
  incidentIdCounter = 0;
  liveIncidents.length = 0;
  actionConsecutiveCount.clear();
  actionEffectivenessLog.clear();
  actionBlacklist.clear();
  actionRetryTracker.clear();
  autonomousRecoveryActive = false;
  if (autonomousRecoveryTimer) {
    clearTimeout(autonomousRecoveryTimer);
    autonomousRecoveryTimer = null;
  }
}

function getTracker(type: AlertType): AlertTracker {
  let t = alertTrackers.get(type);
  if (!t) {
    t = { firstSeen: 0, count: 0, sumValues: 0, lastLevel: "info", lastAlertAtByLevel: { info: 0, warning: 0, critical: 0, emergency: 0 }, lastSentLevel: "info", resolved: true, incidentActive: false };
    alertTrackers.set(type, t);
  }
  return t;
}

const LEVEL_RANK: Record<AlertLevel, number> = { info: 0, warning: 1, critical: 2, emergency: 3 };

function shouldSendAlert(
  type: AlertType,
  level: AlertLevel,
  value: number,
  _metrics: LiveStressMetrics,
): { send: boolean; duration: number; avgValue: number; count: number; finalLevel: AlertLevel } {
  const now = Date.now();
  const tracker = getTracker(type);

  if (_metrics.rides_created < 20 && liveDrivers.length < 10 && type !== "critical_bug") {
    return { send: false, duration: 0, avgValue: 0, count: 0, finalLevel: level };
  }

  if (tracker.resolved || tracker.firstSeen === 0) {
    tracker.firstSeen = now;
    tracker.count = 0;
    tracker.sumValues = 0;
    tracker.resolved = false;
    tracker.incidentActive = true;
    tracker.lastSentLevel = "info";
  }

  tracker.count++;
  tracker.sumValues += value;
  tracker.lastLevel = level;

  const duration = now - tracker.firstSeen;
  const avgValue = tracker.count > 0 ? Math.round(tracker.sumValues / tracker.count * 10) / 10 : value;

  let finalLevel = level;
  if (level === "warning" && duration > 30_000) finalLevel = "critical";
  if (level === "critical" && duration > 60_000) finalLevel = "emergency";
  if (LEVEL_RANK[finalLevel] < LEVEL_RANK[level]) finalLevel = level;

  const activeEmergency = liveAlerts.some(a => !a.acknowledged && (a.level === "emergency" || a.level === "critical") && a.type !== type);
  if (finalLevel === "warning" && activeEmergency) {
    return { send: false, duration, avgValue, count: tracker.count, finalLevel };
  }

  const sustainReq = SUSTAIN_THRESHOLDS[finalLevel];
  if (duration < sustainReq) {
    return { send: false, duration, avgValue, count: tracker.count, finalLevel };
  }

  const isEscalation = LEVEL_RANK[finalLevel] > LEVEL_RANK[tracker.lastSentLevel];

  if (!isEscalation) {
    const cooldown = COOLDOWN_MS[finalLevel];
    if (now - tracker.lastAlertAtByLevel[finalLevel] < cooldown) {
      return { send: false, duration, avgValue, count: tracker.count, finalLevel };
    }
  }

  tracker.lastAlertAtByLevel[finalLevel] = now;
  tracker.lastSentLevel = finalLevel;
  return { send: true, duration, avgValue, count: tracker.count, finalLevel };
}

function resolveAlert(type: AlertType, phase: string) {
  const tracker = alertTrackers.get(type);
  if (!tracker || tracker.resolved) return;
  if (!tracker.incidentActive) return;

  tracker.resolved = true;
  tracker.incidentActive = false;

  const resolvedIncident = liveIncidents.find(i => i.type === type && i.active);
  const incidentId = resolvedIncident ? resolvedIncident.id : "";
  resolveIncident(type);

  alertIdCounter++;
  const entry: StressAlert = {
    id: `alert-${alertIdCounter}`,
    type: "recovery",
    severity: "info",
    level: "info",
    message: `Система восстановлена (${type})`,
    value: 0,
    threshold: 0,
    phase,
    timestamp: new Date().toISOString(),
    acknowledged: false,
    duration: 0,
    avg_value: 0,
    count: 0,
    reason: REASON_MAP[type] || "unknown",
    routing: "dashboard",
    incident_id: incidentId,
  };
  liveAlerts.push(entry);
  if (liveAlerts.length > 200) liveAlerts.splice(0, liveAlerts.length - 200);
  console.log(`[SMART ALERT] RECOVERY: ${entry.message} [incident=${incidentId} resolved]`);
}

function resetAlertState() {
  liveAlerts.length = 0;
  recoveryActions.length = 0;
  alertIdCounter = 0;
  recoveryIdCounter = 0;
  successBelowSince = 0;
  prevWsConnections = 0;
  lastWsRecoveryAt = 0;
  lastDispatchRestartAt = 0;
  lastLoadReduceAt = 0;
  currentRideIntervalMultiplier = 1;
  optimizationDecisions.length = 0;
  decisionIdCounter = 0;
  healthHistory.length = 0;
  trendHistory.length = 0;
  lastTrendSampleAt = 0;
  preventiveActionCooldownUntil = 0;
  contextEffectivenessMap.clear();
  activeStrategyExecution = null;
  lastEvolutionCycleAt = 0;
  metaExplorationRate = 0.20;
  lastDecisionEngineAt = 0;
  lastHealthCommitAt = 0;
  recentActionMemory.length = 0;
  multiActionCount = 0;
  generationSnapshots.length = 0;
  bestGenerationIdx = -1;
  driverBehaviorStats.clear();
  corridorDemandHistory.clear();
  profitHistory.length = 0;
  lastProfitSampleAt = 0;
  resetRevenueAIState();
  resetSmartAlertState();
}

function pushRecovery(action: Omit<RecoveryAction, "id" | "timestamp" | "result" | "duration_ms">): RecoveryAction {
  recoveryIdCounter++;
  const entry: RecoveryAction = {
    ...action,
    id: `recovery-${recoveryIdCounter}`,
    timestamp: new Date().toISOString(),
    result: "pending",
    duration_ms: 0,
  };
  recoveryActions.push(entry);
  if (recoveryActions.length > 100) recoveryActions.splice(0, recoveryActions.length - 100);
  console.log(`[AUTO-RECOVERY] ${action.type}: ${action.message}`);
  return entry;
}

async function autoRecoverWsConnections(drivers: VirtualDriver[]) {
  const disconnected = drivers.filter(d => !d.wsConnected || !d.wsAuthed);
  if (disconnected.length === 0) return;

  const action = pushRecovery({
    type: "ws_reconnect",
    trigger: "ws_drop > 30%",
    message: `Переподключение ${disconnected.length} драйверов`,
    detail: `Обнаружено ${disconnected.length} отключённых из ${drivers.length} (${Math.round(disconnected.length / drivers.length * 100)}%)`,
  });

  action.metrics_before = takeSnapshot();

  const start = Date.now();
  let reconnected = 0;
  const batch = disconnected.slice(0, 50);
  const CONCURRENCY = 15;

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map(async (driver) => {
      if (driver.ws) {
        try { driver.ws.close(); } catch {}
        driver.ws = null;
        driver.wsConnected = false;
        driver.wsAuthed = false;
      }
      await connectDriverWS(driver);
      if (driver.wsConnected && driver.wsAuthed) {
        if (!driver.isOnline) {
          driver.isOnline = true;
          api("PATCH", "/api/drivers/status", { status: "online" }, driver.token).catch(() => {});
        }
        return true;
      }
      return false;
    }));
    reconnected += results.filter(r => r.status === "fulfilled" && r.value).length;
  }

  action.duration_ms = Date.now() - start;
  action.result = reconnected > 0 ? "success" : "failed";
  action.detail += ` → Восстановлено: ${reconnected}/${batch.length}`;
  console.log(`[AUTO-RECOVERY] WS reconnect done: ${reconnected}/${batch.length} in ${action.duration_ms}ms`);

  scheduleEffectivenessCheck(action);
}

async function autoRestartDispatchCycle() {
  const action = pushRecovery({
    type: "dispatch_restart",
    trigger: "success_rate < 70%",
    message: `Перезапуск цикла диспетчеризации`,
    detail: `Success rate: ${liveMetrics.success_rate}%, принято: ${liveMetrics.accepted}/${liveMetrics.rides_created}`,
  });

  action.metrics_before = takeSnapshot();

  const start = Date.now();
  try {
    const onlineDrivers = liveDrivers.filter(d => d.wsConnected && d.wsAuthed && !d.isBusy);
    let resetCount = 0;
    for (const driver of onlineDrivers) {
      if (!driver.isOnline) {
        driver.isOnline = true;
        api("PATCH", "/api/drivers/status", { status: "online" }, driver.token).catch(() => {});
        resetCount++;
      }
    }
    action.duration_ms = Date.now() - start;
    action.result = "success";
    action.detail += ` → ${resetCount} драйверов возвращены online, ${onlineDrivers.length} готовы`;
    console.log(`[AUTO-RECOVERY] Dispatch restart: ${resetCount} drivers set online in ${action.duration_ms}ms`);
  } catch (e: any) {
    action.duration_ms = Date.now() - start;
    action.result = "failed";
    action.detail += ` → Ошибка: ${e.message}`;
  }

  scheduleEffectivenessCheck(action);
}

function autoReduceLoad() {
  const prevMultiplier = currentRideIntervalMultiplier;
  const newMultiplier = Math.min(prevMultiplier * 1.5, 4);
  currentRideIntervalMultiplier = newMultiplier;

  const action = pushRecovery({
    type: "load_reduce",
    trigger: "latency > 800ms",
    message: `Снижение нагрузки: интервал ×${newMultiplier.toFixed(1)}`,
    detail: `Латентность: ${liveMetrics.avg_response_time}ms, множитель: ${prevMultiplier.toFixed(1)} → ${newMultiplier.toFixed(1)}`,
  });
  action.metrics_before = takeSnapshot();
  action.result = "success";
  action.duration_ms = 0;

  scheduleEffectivenessCheck(action);
  console.log(`[AUTO-RECOVERY] Load reduced: interval multiplier ${prevMultiplier.toFixed(1)} → ${newMultiplier.toFixed(1)}`);
}

function autoRestoreLoad() {
  if (currentRideIntervalMultiplier <= 1) return;
  const prev = currentRideIntervalMultiplier;
  currentRideIntervalMultiplier = Math.max(1, currentRideIntervalMultiplier * 0.8);
  if (Math.abs(prev - currentRideIntervalMultiplier) > 0.05) {
    console.log(`[AUTO-RECOVERY] Load restoring: ${prev.toFixed(1)} → ${currentRideIntervalMultiplier.toFixed(1)}`);
  }
}

export function getRideIntervalMultiplier(): number {
  return currentRideIntervalMultiplier;
}

export function saveOptimizerOnTestEnd() {
  saveOptimizerState();
}

function smartAlert(type: AlertType, baseLevel: AlertLevel, value: number, threshold: number, msgBuilder: (d: number, avg: number, cnt: number, lvl: AlertLevel) => string, phase: string) {
  const reason = REASON_MAP[type] || "unknown";
  const incident = getOrCreateIncident(type, reason);

  const result = shouldSendAlert(type, baseLevel, value, liveMetrics);

  const durationS = Math.round(result.duration / 1000);
  updateIncident(incident, result.finalLevel, result.avgValue, result.count);

  if (!result.send) return;

  if (!checkGlobalRateLimit(result.finalLevel)) {
    console.log(`[SMART ALERT] RATE LIMITED: ${type} ${result.finalLevel} dropped (3/min exceeded, incident ${incident.id} still tracked)`);
    return;
  }

  const routing = getRouting(result.finalLevel);
  const message = msgBuilder(durationS, result.avgValue, result.count, result.finalLevel);

  recordGlobalAlert();
  alertIdCounter++;
  const entry: StressAlert = {
    id: `alert-${alertIdCounter}`,
    type,
    severity: result.finalLevel,
    level: result.finalLevel,
    message,
    value,
    threshold,
    phase,
    timestamp: new Date().toISOString(),
    acknowledged: false,
    duration: durationS,
    avg_value: result.avgValue,
    count: result.count,
    reason,
    routing,
    incident_id: incident.id,
  };
  liveAlerts.push(entry);
  if (liveAlerts.length > 200) liveAlerts.splice(0, liveAlerts.length - 200);

  tryAutoExec(type, result.finalLevel);

  if (routing.includes("telegram")) {
    console.log(`[ALERT ROUTE] → Telegram: ${result.finalLevel.toUpperCase()} ${message} (incident ${incident.id})`);
  }
  if (routing.includes("sms")) {
    console.log(`[ALERT ROUTE] → SMS: ${result.finalLevel.toUpperCase()} ${message} (incident ${incident.id})`);
  }
  console.log(`[SMART ALERT] ${result.finalLevel.toUpperCase()}: ${message} [incident=${incident.id}, reason=${reason}, routing=${routing}]`);
}

function executeRecovery(type: RecoveryType) {
  setLastExecTime(type, Date.now());
  pushRecentAction(type, 0);
  switch (type) {
    case "ws_reconnect": autoRecoverWsConnections(liveDrivers); break;
    case "dispatch_restart": autoRestartDispatchCycle(); break;
    case "load_reduce": autoReduceLoad(); break;
  }
}

function checkAlerts(phase: string, rate: number, avg: number, wsConns: number, bugs: number, wsErrors: number) {
  const now = Date.now();
  const triggeredTypes: RecoveryType[] = [];

  sampleTrend();

  if (rate < 80 && liveMetrics.rides_created > 5) {
    if (successBelowSince === 0) successBelowSince = now;

    const baseLevel: AlertLevel = rate < 50 ? "emergency" : rate < 60 ? "critical" : "warning";
    smartAlert(
      "success_rate", baseLevel, rate, 80,
      (dur, avgV, cnt, lvl) => `${lvl === "emergency" ? "🚨 " : ""}Success rate ${avgV}% (< 80%) — ${dur}с, ${cnt} событий`,
      phase,
    );
    if (rate < 70) triggeredTypes.push("dispatch_restart");
  } else {
    if (successBelowSince > 0) {
      resolveAlert("success_rate", phase);
    }
    successBelowSince = 0;
  }

  if (avg > 500 && liveMetrics.rides_created > 3) {
    const baseLevel: AlertLevel = avg > 2000 ? "emergency" : avg > 1000 ? "critical" : "warning";
    smartAlert(
      "latency", baseLevel, avg, 500,
      (dur, avgV, cnt, lvl) => `${lvl === "emergency" ? "🚨 " : ""}Латентность ${avgV}ms (> 500ms) — ${dur}с, ${cnt} событий`,
      phase,
    );
    if (avg > 800) triggeredTypes.push("load_reduce");
  } else if (avg <= 300 && rate >= 80) {
    resolveAlert("latency", phase);
    autoRestoreLoad();
  }

  if (prevWsConnections > 0 && wsConns < prevWsConnections * 0.7) {
    const drop = prevWsConnections - wsConns;
    const dropPct = Math.round((drop / prevWsConnections) * 100);
    const baseLevel: AlertLevel = dropPct > 70 ? "emergency" : dropPct > 50 ? "critical" : "warning";
    smartAlert(
      "ws_drop", baseLevel, wsConns, prevWsConnections,
      (dur, _avgV, cnt, lvl) => `${lvl === "emergency" ? "🚨 " : ""}WS обрыв: ${prevWsConnections} → ${wsConns} (-${drop}, ${dropPct}%) — ${dur}с, ${cnt} событий`,
      phase,
    );
    triggeredTypes.push("ws_reconnect");
  } else if (prevWsConnections > 0 && wsConns >= prevWsConnections * 0.9) {
    resolveAlert("ws_drop", phase);
  }
  prevWsConnections = wsConns;

  if (bugs > 0) {
    smartAlert(
      "critical_bug", "critical", bugs, 0,
      (dur, _avgV, cnt) => `Обнаружено ${bugs} критических багов — ${dur}с, ${cnt} событий`,
      phase,
    );
  } else {
    resolveAlert("critical_bug", phase);
  }

  if (wsErrors > 0 && wsErrors % 5 === 0) {
    const baseLevel: AlertLevel = wsErrors > 50 ? "emergency" : wsErrors > 20 ? "critical" : "warning";
    smartAlert(
      "ws_errors", baseLevel, wsErrors, 5,
      (dur, avgV, cnt, lvl) => `${lvl === "emergency" ? "🚨 " : ""}Накоплено ${Math.round(avgV)} WebSocket ошибок — ${dur}с, ${cnt} событий`,
      phase,
    );
  }

  if (triggeredTypes.length > 0) {
    const activeIncident = liveIncidents.find(i => i.active && LEVEL_RANK[i.max_severity] >= LEVEL_RANK["warning"]);
    if (activeIncident && !autonomousRecoveryActive) {
      startAutonomousRecovery(activeIncident);
    } else if (!activeIncident) {
      const chosen = decisionEngine(triggeredTypes);
      if (chosen) {
        executeRecovery(chosen);
      }
    }
  }

  if (autonomousRecoveryActive && isSystemRecovered()) {
    const activeIncident = liveIncidents.find(i => i.active);
    if (activeIncident) {
      const lastAction = activeIncident.recovery_actions[activeIncident.recovery_actions.length - 1] || "unknown";
      activeIncident.recovered_by = lastAction;
      stopAutonomousRecovery(activeIncident, `system recovered (sr=${liveMetrics.success_rate}% lat=${liveMetrics.avg_response_time}ms)`);
      resolveAlert(activeIncident.type as AlertType, phase);
    }
  }

  if (!autonomousRecoveryActive && triggeredTypes.length === 0) {
    const trend = analyzeTrend();
    if (trend.predicted_issue) {
      console.log(`[AI] trend analysis: sr_slope=${trend.sr_slope.toFixed(2)}/s lat_slope=${trend.latency_slope.toFixed(1)}/s health_slope=${trend.health_slope.toFixed(4)}/s → predicted=${trend.predicted_issue}`);
      executePreventiveAction(trend.predicted_issue, phase);
    }
  }
}

let liveDrivers: VirtualDriver[] = [];
let phaseStartTime = 0;

function updateLiveMetrics(phase: string, metrics: Metrics) {
  const elapsed = phaseStartTime > 0 ? (Date.now() - phaseStartTime) / 1000 : 0;
  const rate = metrics.totalRides > 0 ? Math.round((metrics.acceptedRides / metrics.totalRides) * 1000) / 10 : 0;
  const sorted = metrics.responseTimes.length > 0 ? [...metrics.responseTimes].sort((a, b) => a - b) : [];
  const avg = sorted.length > 0 ? Math.round(sorted.reduce((s, t) => s + t, 0) / sorted.length) : 0;
  const rpm = elapsed > 0 ? Math.round((metrics.totalRides / elapsed) * 60 * 10) / 10 : 0;
  const wsConns = liveDrivers.filter(d => d.wsConnected).length;

  liveMetrics.running = true;
  liveMetrics.current_phase = phase;
  liveMetrics.phase_elapsed_s = Math.round(elapsed);
  liveMetrics.rides_created = metrics.totalRides;
  liveMetrics.offers_received = metrics.offersReceived;
  liveMetrics.accepted = metrics.acceptedRides;
  liveMetrics.failed = metrics.failedAccepts;
  liveMetrics.success_rate = rate;
  liveMetrics.avg_response_time = avg;
  liveMetrics.ws_errors = metrics.wsErrors;
  liveMetrics.ws_connections = wsConns;
  liveMetrics.critical_bugs = metrics.criticalBugs.length;
  liveMetrics.chaos_offline_toggles = metrics.chaosOfflineToggle;
  liveMetrics.chaos_cancels = metrics.chaosCancels;
  liveMetrics.rides_per_minute = rpm;
  liveMetrics.updated_at = new Date().toISOString();

  updateDriverBehavior();
  runRevenueAICycle();
  checkAlerts(phase, rate, avg, wsConns, metrics.criticalBugs.length, metrics.wsErrors);
}

// JWT_SECRET imported at top of file
const PORT = process.env.PORT || 8080;
const BASE = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}/api/ws`;

const DRIVER_COUNT = 200;
const TEST_DURATION_MS = 120_000;
const RIDE_INTERVAL_MS = 2000;
const STRESS_PHONE_PREFIX = "+998970";
const STRESS_RIDER_PREFIX = "+998980";
const SNAPSHOT_INTERVAL_MS = 10_000;

const CITY_KEYS = [
  "bukhara", "samarkand", "tashkent", "namangan",
  "andijan", "fergana", "nukus", "urgench",
  "qarshi", "termez", "jizzakh", "navoiy",
];

const CITY_NAMES_RU: Record<string, string> = {
  bukhara: "Бухара", samarkand: "Самарканд", tashkent: "Ташкент",
  namangan: "Наманган", andijan: "Андижан", fergana: "Фергана",
  nukus: "Нукус", urgench: "Ургенч", qarshi: "Карши",
  termez: "Термез", jizzakh: "Джиззах", navoiy: "Навои",
};

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
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

const POPULAR_CORRIDORS = [
  { from: "tashkent", to: "samarkand", weight: 8 },
  { from: "tashkent", to: "fergana", weight: 6 },
  { from: "tashkent", to: "namangan", weight: 5 },
  { from: "tashkent", to: "andijan", weight: 5 },
  { from: "tashkent", to: "bukhara", weight: 4 },
  { from: "samarkand", to: "bukhara", weight: 4 },
  { from: "tashkent", to: "jizzakh", weight: 3 },
  { from: "samarkand", to: "qarshi", weight: 3 },
  { from: "fergana", to: "andijan", weight: 3 },
  { from: "fergana", to: "namangan", weight: 3 },
  { from: "tashkent", to: "navoiy", weight: 2 },
  { from: "bukhara", to: "navoiy", weight: 2 },
  { from: "nukus", to: "urgench", weight: 2 },
  { from: "tashkent", to: "urgench", weight: 1 },
  { from: "tashkent", to: "termez", weight: 1 },
];

interface PhaseConfig {
  name: string;
  acceptRate: number;
  chaosOfflineRate: number;
  chaosCancelRate: number;
  networkRetryChance: number;
  networkDelayMs: number;
  durationMs: number;
  rideIntervalMs: number;
}

interface Metrics {
  totalDrivers: number;
  totalRides: number;
  offersReceived: number;
  acceptedRides: number;
  failedAccepts: number;
  versionConflicts: number;
  duplicateAccepts: number;
  wsErrors: number;
  responseTimes: number[];
  chaosOfflineToggle: number;
  chaosCancels: number;
  chaosRetries: number;
  criticalBugs: string[];
  acceptNoOffer: number;
}

interface VirtualDriver {
  id: number;
  token: string;
  city: string;
  tripId?: number;
  ws: WebSocket | null;
  wsConnected: boolean;
  wsAuthed: boolean;
  sessionId?: string;
  offersReceived: Set<number>;
  isOnline: boolean;
  isBusy: boolean;
}

interface PhaseReport {
  name: string;
  total_drivers: number;
  total_rides: number;
  offers_received: number;
  accepted_rides: number;
  failed_accepts: number;
  success_rate: number;
  avg_response_time: number;
  p50_response_time: number;
  p95_response_time: number;
  p99_response_time: number;
  max_response_time: number;
  version_conflicts: number;
  duplicate_accepts: number;
  ws_errors: number;
  chaos_offline_toggles: number;
  chaos_cancels: number;
  chaos_retries: number;
  accept_no_offer: number;
  critical_bugs: number;
  critical_bug_details: string[];
  passed: boolean;
  duration_s: number;
}

interface StressResult {
  timestamp: string;
  baseline: PhaseReport;
  chaos: PhaseReport;
  comparison: {
    success_rate_delta: number;
    avg_response_delta: number;
    p95_response_delta: number;
    baseline_passed: boolean;
    chaos_passed: boolean;
    verdict: "PASSED" | "NEEDS_REVIEW";
  };
  total_duration_s: number;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function freshMetrics(): Metrics {
  return {
    totalDrivers: DRIVER_COUNT,
    totalRides: 0,
    offersReceived: 0,
    acceptedRides: 0,
    failedAccepts: 0,
    versionConflicts: 0,
    duplicateAccepts: 0,
    wsErrors: 0,
    responseTimes: [],
    chaosOfflineToggle: 0,
    chaosCancels: 0,
    chaosRetries: 0,
    criticalBugs: [],
    acceptNoOffer: 0,
  };
}

function randomRoute(): { from: string; to: string } {
  const totalWeight = POPULAR_CORRIDORS.reduce((s, c) => s + c.weight, 0);
  let r = Math.random() * totalWeight;
  for (const c of POPULAR_CORRIDORS) {
    r -= c.weight;
    if (r <= 0) {
      return Math.random() < 0.5
        ? { from: c.from, to: c.to }
        : { from: c.to, to: c.from };
    }
  }
  const from = CITY_KEYS[Math.floor(Math.random() * CITY_KEYS.length)];
  let to = from;
  while (to === from) to = CITY_KEYS[Math.floor(Math.random() * CITY_KEYS.length)];
  return { from, to };
}

function pickDriverRoute(city: string): string {
  const corridors = POPULAR_CORRIDORS.filter(c => c.from === city || c.to === city);
  if (corridors.length > 0 && Math.random() < 0.8) {
    const totalW = corridors.reduce((s, c) => s + c.weight, 0);
    let r = Math.random() * totalW;
    for (const c of corridors) {
      r -= c.weight;
      if (r <= 0) return c.from === city ? c.to : c.from;
    }
  }
  let to = CITY_KEYS[Math.floor(Math.random() * CITY_KEYS.length)];
  while (to === city) to = CITY_KEYS[Math.floor(Math.random() * CITY_KEYS.length)];
  return to;
}

async function api(method: string, path: string, body?: any, token?: string, retries = 0): Promise<{ status: number; data: any; timeMs: number }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const start = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: res.status, data: json, timeMs: Date.now() - start };
  } catch (err: any) {
    if (retries > 0) {
      await sleep(200 + Math.random() * 500);
      return api(method, path, body, token, retries - 1);
    }
    return { status: 0, data: { error: err.message }, timeMs: Date.now() - start };
  }
}

async function cleanupStressWsData() {
  const stressDrivers = await db.select({ id: usersTable.id }).from(usersTable)
    .where(like(usersTable.phone, `${STRESS_PHONE_PREFIX}%`));
  const driverIds = stressDrivers.map(d => d.id);

  const stressRides = await db.select({ id: ridesTable.id }).from(ridesTable)
    .where(like(ridesTable.riderPhone, `${STRESS_RIDER_PREFIX}%`));
  const riderRideIds = stressRides.map(r => r.id);

  let driverRideIds: number[] = [];
  if (driverIds.length > 0) {
    const driverRides = await db.select({ id: ridesTable.id }).from(ridesTable)
      .where(inArray(ridesTable.driverId, driverIds));
    driverRideIds = driverRides.map(r => r.id);
  }

  const allRideIds = [...new Set([...riderRideIds, ...driverRideIds])];
  if (allRideIds.length > 0) {
    for (let i = 0; i < allRideIds.length; i += 500) {
      const chunk = allRideIds.slice(i, i + 500);
      await db.delete(ridePassengersTable).where(inArray(ridePassengersTable.rideId, chunk));
      await db.delete(orderOffersTable).where(inArray(orderOffersTable.rideId, chunk));
      await db.delete(ridesTable).where(inArray(ridesTable.id, chunk));
    }
  }
  if (driverIds.length > 0) {
    for (let i = 0; i < driverIds.length; i += 500) {
      const chunk = driverIds.slice(i, i + 500);
      await db.delete(orderOffersTable).where(inArray(orderOffersTable.driverId, chunk));
      await db.delete(usersTable).where(inArray(usersTable.id, chunk));
    }
  }
}

async function bumpLimits() {
  await db.update(settingsTable).set({ value: "2000" }).where(eq(settingsTable.key, "max_orders_per_day"));
  await db.update(settingsTable).set({ value: "500" }).where(eq(settingsTable.key, "max_active_orders"));
  const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, "max_dispatch_cycles"));
  if (existing.length > 0) {
    await db.update(settingsTable).set({ value: "1" }).where(eq(settingsTable.key, "max_dispatch_cycles"));
  } else {
    await db.insert(settingsTable).values({ key: "max_dispatch_cycles", value: "1", label: "Max dispatch cycles (stress)" });
  }
  const { loadSettingsCache } = await import("../../src/lib/settingsCache.js");
  await loadSettingsCache();
}

async function restoreLimits() {
  await db.update(settingsTable).set({ value: "30" }).where(eq(settingsTable.key, "max_orders_per_day"));
  await db.update(settingsTable).set({ value: "20" }).where(eq(settingsTable.key, "max_active_orders"));
  await db.delete(settingsTable).where(eq(settingsTable.key, "max_dispatch_cycles"));
  const { loadSettingsCache } = await import("../../src/lib/settingsCache.js");
  await loadSettingsCache();
}

async function createDrivers(): Promise<VirtualDriver[]> {
  const crypto = await import("crypto");
  const hash = crypto.createHash("sha256").update("stress123buxtaxi-salt").digest("hex");
  const drivers: VirtualDriver[] = [];

  const CITY_WEIGHTS: Record<string, number> = {
    tashkent: 10, samarkand: 6, fergana: 5, namangan: 4, andijan: 4,
    bukhara: 4, jizzakh: 3, navoiy: 2, qarshi: 2, termez: 2, nukus: 2, urgench: 2,
  };
  const totalCityWeight = Object.values(CITY_WEIGHTS).reduce((s, w) => s + w, 0);

  const batchSize = 50;
  for (let batch = 0; batch < DRIVER_COUNT; batch += batchSize) {
    const batchValues: any[] = [];
    const cities: string[] = [];

    for (let i = batch; i < Math.min(batch + batchSize, DRIVER_COUNT); i++) {
      let r = Math.random() * totalCityWeight;
      let picked = "tashkent";
      for (const [city, w] of Object.entries(CITY_WEIGHTS)) {
        r -= w;
        if (r <= 0) { picked = city; break; }
      }
      cities.push(picked);
      const coords = CITY_COORDS[picked];
      batchValues.push({
        phone: `${STRESS_PHONE_PREFIX}${String(i).padStart(5, "0")}`,
        name: `WS-Driver ${i + 1}`,
        passwordHash: hash,
        role: "driver" as const,
        status: "online" as const,
        balance: 500000,
        carModel: `StressCar-${i}`,
        carNumber: `${String(i).padStart(2, "0")}S${String(i).padStart(3, "0")}SS`,
        carClass: ["economy", "comfort", "business"][i % 3],
        seats: 4,
        lat: coords.lat + (Math.random() - 0.5) * 0.05,
        lng: coords.lng + (Math.random() - 0.5) * 0.05,
      });
    }

    const inserted = await db.insert(usersTable).values(batchValues).returning();
    for (let i = 0; i < inserted.length; i++) {
      const token = jwt.sign({ userId: inserted[i].id, role: "driver" }, JWT_SECRET, { expiresIn: "2h" });
      drivers.push({
        id: inserted[i].id,
        token,
        city: cities[i],
        ws: null,
        wsConnected: false,
        wsAuthed: false,
        offersReceived: new Set(),
        isOnline: true,
        isBusy: false,
      });
    }
  }

  return drivers;
}

async function createTrips(drivers: VirtualDriver[]): Promise<void> {
  const departureTime = new Date(Date.now() + 60 * 60 * 1000);
  const batchSize = 50;

  for (let batch = 0; batch < drivers.length; batch += batchSize) {
    const batchDrivers = drivers.slice(batch, batch + batchSize);
    const tripValues: any[] = [];

    for (const driver of batchDrivers) {
      const toCity = pickDriverRoute(driver.city);
      tripValues.push({
        driverId: driver.id,
        fromCity: driver.city,
        toCity,
        status: "accepted",
        scheduledAt: departureTime,
        mode: "market",
        source: "auto",
        price: 0,
        carClass: ["economy", "comfort", "business"][drivers.indexOf(driver) % 3],
      });
    }

    const trips = await db.insert(ridesTable).values(tripValues).returning();
    for (let i = 0; i < trips.length; i++) {
      batchDrivers[i].tripId = trips[i].id;
    }
  }
}

interface PhaseState {
  config: PhaseConfig;
  metrics: Metrics;
}

const phaseState: PhaseState = {
  config: { name: "init", acceptRate: 0, chaosOfflineRate: 0, chaosCancelRate: 0, networkRetryChance: 0, networkDelayMs: 0, durationMs: 0, rideIntervalMs: 2000 },
  metrics: freshMetrics(),
};

function connectDriverWS(driver: VirtualDriver): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      phaseState.metrics.wsErrors++;
      resolve();
    }, 10000);

    try {
      const ws = new WebSocket(WS_URL);
      driver.ws = ws;

      ws.on("open", () => {
        driver.wsConnected = true;
        ws.send(JSON.stringify({ type: "auth", token: driver.token }));
      });

      ws.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === "auth_ok") {
            driver.wsAuthed = true;
            driver.sessionId = msg.sessionId;
            clearTimeout(timeout);
            resolve();
          } else if (msg.type === "auth_error") {
            phaseState.metrics.wsErrors++;
            clearTimeout(timeout);
            resolve();
          } else if (msg.type === "new_order" && msg.ride) {
            const m = phaseState.metrics;
            const c = phaseState.config;
            m.offersReceived++;
            const offerId = msg.offerId;
            const rideId = msg.ride.id;

            driver.offersReceived.add(rideId);

            if (offerId && driver.sessionId) {
              ws.send(JSON.stringify({ type: "offer_ack", offerId, sessionId: driver.sessionId }));
            }

            if (Math.random() < c.acceptRate) {
              const delay = 500 + Math.random() * 2500;

              if (c.networkRetryChance > 0 && Math.random() < c.networkRetryChance) {
                m.chaosRetries++;
                const extraDelay = c.networkDelayMs > 0 ? Math.random() * c.networkDelayMs : 0;
                setTimeout(() => acceptRide(driver, rideId, m, c), delay + extraDelay);
                setTimeout(() => acceptRide(driver, rideId, m, c), delay + extraDelay + 100);
              } else {
                const extraDelay = c.networkDelayMs > 0 ? Math.random() * c.networkDelayMs : 0;
                setTimeout(() => acceptRide(driver, rideId, m, c), delay + extraDelay);
              }
            }
          }
        } catch {
          phaseState.metrics.wsErrors++;
        }
      });

      ws.on("error", () => {
        phaseState.metrics.wsErrors++;
        clearTimeout(timeout);
        resolve();
      });

      ws.on("close", () => {
        driver.wsConnected = false;
        driver.wsAuthed = false;
      });
    } catch {
      phaseState.metrics.wsErrors++;
      clearTimeout(timeout);
      resolve();
    }
  });
}

async function acceptRide(driver: VirtualDriver, rideId: number, metrics: Metrics, config: PhaseConfig) {
  if (!driver.isOnline) return;

  const retries = config.networkRetryChance > 0 && Math.random() < config.networkRetryChance ? 1 : 0;
  const result = await api("POST", "/api/drivers/accept", { rideId }, driver.token, retries);
  metrics.responseTimes.push(result.timeMs);

  const isSuccess = result.status === 200 && (result.data?.success || result.data?.id || result.data?.status === "accepted");
  if (isSuccess) {
    metrics.acceptedRides++;
    driver.isBusy = true;
    trackDriverAccept(driver.id, result.timeMs);
    if (result.data.idempotent) {
      metrics.duplicateAccepts++;
    }
  } else {
    metrics.failedAccepts++;
    trackDriverReject(driver.id);
    const errCode = result.data?.error || "unknown";
    if (errCode === "version_conflict") {
      metrics.versionConflicts++;
    } else if (errCode === "no_offer") {
      metrics.acceptNoOffer++;
      metrics.criticalBugs.push(`accept_no_offer: driver=${driver.id} ride=${rideId}`);
    }
  }
}

async function createRide(index: number, metrics: Metrics, riderPrefix: string): Promise<number | null> {
  const route = randomRoute();
  const seats = 1 + Math.floor(Math.random() * 4);
  const isUrgent = Math.random() < 0.1;

  const body: any = {
    fromCity: CITY_NAMES_RU[route.from],
    toCity: CITY_NAMES_RU[route.to],
    riderName: `WS-Rider ${index}`,
    riderPhone: `${riderPrefix}${String(index).padStart(5, "0")}`,
    passengers: seats,
    seats: Array.from({ length: seats }, (_, i) => ({
      name: `Passenger ${i + 1}`,
      phone: `${riderPrefix}${String(index).padStart(4, "0")}${i}`,
    })),
    paymentType: "cash",
    carClass: ["economy", "comfort", "business"][index % 3],
    isUrgent,
  };

  const dispToken = jwt.sign({ userId: 1, role: "dispatcher" }, JWT_SECRET, { expiresIn: "2h" });
  const result = await api("POST", "/api/rides", body, dispToken);
  metrics.responseTimes.push(result.timeMs);

  if (result.status === 201 || result.status === 200) {
    metrics.totalRides++;
    trackCorridorDemand(route.from, route.to);
    return result.data?.id || null;
  }
  return null;
}

async function chaosLoop(drivers: VirtualDriver[], metrics: Metrics, config: PhaseConfig, stopSignal: { stopped: boolean }) {
  if (config.chaosOfflineRate <= 0) return;

  while (!stopSignal.stopped) {
    await sleep(3000 + Math.random() * 4000);
    if (stopSignal.stopped) break;

    for (const driver of drivers) {
      if (!driver.wsConnected || !driver.wsAuthed) continue;

      if (Math.random() < config.chaosOfflineRate) {
        metrics.chaosOfflineToggle++;
        const newStatus = driver.isOnline ? "offline" : "online";
        driver.isOnline = newStatus === "online";
        api("PATCH", "/api/drivers/status", { status: newStatus }, driver.token).catch(() => {});

        if (!driver.isOnline) {
          setTimeout(async () => {
            if (stopSignal.stopped) return;
            driver.isOnline = true;
            api("PATCH", "/api/drivers/status", { status: "online" }, driver.token).catch(() => {});
          }, 5000 + Math.random() * 10000);
        }
      }
    }
  }
}

async function cancelLoop(drivers: VirtualDriver[], metrics: Metrics, config: PhaseConfig, stopSignal: { stopped: boolean }) {
  if (config.chaosCancelRate <= 0) return;

  while (!stopSignal.stopped) {
    await sleep(5000 + Math.random() * 10000);
    if (stopSignal.stopped) break;

    for (const driver of drivers) {
      if (!driver.isBusy || Math.random() > config.chaosCancelRate) continue;

      const active = await api("GET", "/api/drivers/my-active-ride", undefined, driver.token);
      if (active.status === 200 && active.data?.ride?.id) {
        const cancelResult = await api("POST", "/api/drivers/cancel", { rideId: active.data.ride.id }, driver.token);
        if (cancelResult.status === 200) {
          metrics.chaosCancels++;
          driver.isBusy = false;
        }
      }
    }
  }
}

async function verifyIntegrity(drivers: VirtualDriver[], metrics: Metrics) {
  const stressRides = await db.select().from(ridesTable)
    .where(like(ridesTable.riderPhone, `${STRESS_RIDER_PREFIX}%`));

  const assignedRides = stressRides.filter(r => r.driverId && ["accepted", "in_progress"].includes(r.status || ""));

  for (const ride of assignedRides) {
    const driverId = ride.driverId!;
    const driver = drivers.find(d => d.id === driverId);

    if (driver && !driver.offersReceived.has(ride.id)) {
      const offers = await db.select().from(orderOffersTable)
        .where(and(eq(orderOffersTable.rideId, ride.id), eq(orderOffersTable.driverId, driverId)));

      if (offers.length === 0) {
        metrics.criticalBugs.push(`ride_assigned_without_offer: ride=${ride.id} driver=${driverId}`);
      }
    }
  }

  const tripIds = [...new Set(stressRides.filter(r => r.driverId).map(r => {
    const d = drivers.find(dr => dr.id === r.driverId);
    return d?.tripId;
  }).filter(Boolean) as number[])];

  for (const tripId of tripIds) {
    const passengers = await db.select().from(ridePassengersTable)
      .where(eq(ridePassengersTable.rideId, tripId));
    if (passengers.length > 4) {
      metrics.criticalBugs.push(`over_seat_assignment: trip=${tripId} passengers=${passengers.length}`);
    }
  }
}

function buildReport(name: string, metrics: Metrics, durationMs: number): PhaseReport {
  const sorted = [...metrics.responseTimes].sort((a, b) => a - b);
  const avg = sorted.length > 0 ? Math.round(sorted.reduce((s, t) => s + t, 0) / sorted.length) : 0;
  const p50 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.5)] : 0;
  const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0;
  const p99 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.99)] : 0;
  const max = sorted.length > 0 ? sorted[sorted.length - 1] : 0;
  const successRate = metrics.totalRides > 0
    ? Math.round((metrics.acceptedRides / metrics.totalRides) * 1000) / 10
    : 0;
  const passed = metrics.criticalBugs.length === 0 && metrics.wsErrors < metrics.totalDrivers * 0.1;

  return {
    name,
    total_drivers: metrics.totalDrivers,
    total_rides: metrics.totalRides,
    offers_received: metrics.offersReceived,
    accepted_rides: metrics.acceptedRides,
    failed_accepts: metrics.failedAccepts,
    success_rate: successRate,
    avg_response_time: avg,
    p50_response_time: p50,
    p95_response_time: p95,
    p99_response_time: p99,
    max_response_time: max,
    version_conflicts: metrics.versionConflicts,
    duplicate_accepts: metrics.duplicateAccepts,
    ws_errors: metrics.wsErrors,
    chaos_offline_toggles: metrics.chaosOfflineToggle,
    chaos_cancels: metrics.chaosCancels,
    chaos_retries: metrics.chaosRetries,
    accept_no_offer: metrics.acceptNoOffer,
    critical_bugs: metrics.criticalBugs.length,
    critical_bug_details: metrics.criticalBugs,
    passed,
    duration_s: Math.round(durationMs / 100) / 10,
  };
}

function printSnapshot(phase: string, metrics: Metrics, elapsedS: number) {
  const rate = metrics.totalRides > 0 ? Math.round((metrics.acceptedRides / metrics.totalRides) * 100) : 0;
  console.log(`[STRESS SNAPSHOT] ${phase} | ${elapsedS}s | rides=${metrics.totalRides} accepted=${metrics.acceptedRides} success=${rate}% offers=${metrics.offersReceived} errors=${metrics.wsErrors}`);
}

async function resetDriversForPhase(drivers: VirtualDriver[]) {
  for (const driver of drivers) {
    driver.isBusy = false;
    driver.isOnline = true;
    driver.offersReceived.clear();
  }

  const driverIds = drivers.map(d => d.id);
  for (let i = 0; i < driverIds.length; i += 100) {
    const chunk = driverIds.slice(i, i + 100);
    await db.update(usersTable)
      .set({ status: "online", updatedAt: new Date() })
      .where(inArray(usersTable.id, chunk));
  }

  const stressRides = await db.select({ id: ridesTable.id }).from(ridesTable)
    .where(like(ridesTable.riderPhone, `${STRESS_RIDER_PREFIX}%`));
  const rideIds = stressRides.map(r => r.id);

  let driverRideIds: number[] = [];
  if (driverIds.length > 0) {
    const driverRides = await db.select({ id: ridesTable.id }).from(ridesTable)
      .where(and(inArray(ridesTable.driverId, driverIds), like(ridesTable.riderPhone, `${STRESS_RIDER_PREFIX}%`)));
    driverRideIds = driverRides.map(r => r.id);
  }

  const allRideIds = [...new Set([...rideIds, ...driverRideIds])];
  if (allRideIds.length > 0) {
    for (let i = 0; i < allRideIds.length; i += 500) {
      const chunk = allRideIds.slice(i, i + 500);
      await db.delete(ridePassengersTable).where(inArray(ridePassengersTable.rideId, chunk));
      await db.delete(orderOffersTable).where(inArray(orderOffersTable.rideId, chunk));
      await db.delete(ridesTable).where(inArray(ridesTable.id, chunk));
    }
  }

  const tripIds = drivers.map(d => d.tripId).filter(Boolean) as number[];
  if (tripIds.length > 0) {
    for (let i = 0; i < tripIds.length; i += 500) {
      const chunk = tripIds.slice(i, i + 500);
      await db.delete(ridePassengersTable).where(inArray(ridePassengersTable.rideId, chunk));
      await db.update(ridesTable)
        .set({ seatsTaken: 0, passengers: 0, updatedAt: new Date() })
        .where(inArray(ridesTable.id, chunk));
    }
  }
}

async function runPhase(
  drivers: VirtualDriver[],
  config: PhaseConfig,
): Promise<PhaseReport> {
  const phaseStart = Date.now();
  phaseStartTime = phaseStart;
  const metrics = freshMetrics();
  phaseState.config = config;
  phaseState.metrics = metrics;
  const stopSignal = { stopped: false };

  console.log(`[STRESS] Phase: ${config.name} | accept=${(config.acceptRate * 100).toFixed(0)}% offline=${(config.chaosOfflineRate * 100).toFixed(0)}% cancel=${(config.chaosCancelRate * 100).toFixed(0)}% duration=${config.durationMs / 1000}s`);

  const chaosPromise = chaosLoop(drivers, metrics, config, stopSignal);
  const cancelPromise = cancelLoop(drivers, metrics, config, stopSignal);

  let rideIndex = 0;
  let lastSnapshot = Date.now();
  const rideStart = Date.now();

  while (Date.now() - rideStart < config.durationMs) {
    await createRide(rideIndex++, metrics, STRESS_RIDER_PREFIX);

    updateLiveMetrics(config.name, metrics);

    if (Date.now() - lastSnapshot >= SNAPSHOT_INTERVAL_MS) {
      const elapsedS = Math.round((Date.now() - rideStart) / 1000);
      printSnapshot(config.name, metrics, elapsedS);
      lastSnapshot = Date.now();
    }

    const jitter = (Math.random() - 0.5) * 500;
    await sleep((config.rideIntervalMs + jitter) * currentRideIntervalMultiplier);
  }

  await sleep(15000);

  stopSignal.stopped = true;
  await Promise.all([chaosPromise, cancelPromise]);

  await verifyIntegrity(drivers, metrics);

  const durationMs = Date.now() - phaseStart;
  const report = buildReport(config.name, metrics, durationMs);

  printSnapshot(config.name + " FINAL", metrics, Math.round(durationMs / 1000));

  return report;
}

interface HistoryEntry {
  timestamp: string;
  baseline_success_rate: number;
  chaos_success_rate: number;
  baseline_avg_response: number;
  chaos_avg_response: number;
  baseline_errors: number;
  chaos_errors: number;
  baseline_bugs: number;
  chaos_bugs: number;
  verdict: string;
  total_duration_s: number;
}

function getResultsDir(): string {
  const dir = join(process.cwd(), "stress-results");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getHistoryPath(): string {
  return join(process.cwd(), "stress-history.json");
}

function saveResult(result: StressResult) {
  const dir = getResultsDir();
  const ts = result.timestamp.replace(/:/g, "-").replace(/\.\d+Z$/, "");
  const filePath = join(dir, `result-${ts}.json`);
  try {
    writeFileSync(filePath, JSON.stringify(result, null, 2));
  } catch {}

  const legacyPath = join(process.cwd(), "stress-result.json");
  try {
    writeFileSync(legacyPath, JSON.stringify(result, null, 2));
  } catch {}

  const entry: HistoryEntry = {
    timestamp: result.timestamp,
    baseline_success_rate: result.baseline.success_rate,
    chaos_success_rate: result.chaos.success_rate,
    baseline_avg_response: result.baseline.avg_response_time,
    chaos_avg_response: result.chaos.avg_response_time,
    baseline_errors: result.baseline.ws_errors,
    chaos_errors: result.chaos.ws_errors,
    baseline_bugs: result.baseline.critical_bugs,
    chaos_bugs: result.chaos.critical_bugs,
    verdict: result.comparison.verdict,
    total_duration_s: result.total_duration_s,
  };

  let history: HistoryEntry[] = [];
  const histPath = getHistoryPath();
  try {
    if (existsSync(histPath)) {
      history = JSON.parse(readFileSync(histPath, "utf-8"));
    }
  } catch {}
  history.push(entry);
  try {
    writeFileSync(histPath, JSON.stringify(history, null, 2));
  } catch {}

  console.log(`[STRESS] Result saved: ${filePath}`);
  console.log(`[STRESS] History: ${history.length} runs tracked`);
}

function printHistory(current: StressResult) {
  let history: HistoryEntry[] = [];
  try {
    const raw = readFileSync(getHistoryPath(), "utf-8");
    history = JSON.parse(raw);
  } catch { return; }

  const recent = history.slice(-5);
  if (recent.length <= 1) return;

  console.log("");
  console.log("[STRESS HISTORY] Last runs:");
  for (let i = 0; i < recent.length; i++) {
    const h = recent[i];
    const date = h.timestamp.replace("T", " ").replace(/\.\d+Z$/, "").slice(0, 16);
    const marker = i === recent.length - 1 ? " ← current" : "";
    console.log(`  Run ${i + 1}: baseline=${h.baseline_success_rate}% chaos=${h.chaos_success_rate}% avg=${h.baseline_avg_response}ms verdict=${h.verdict}${marker}`);
  }

  if (history.length >= 2) {
    const prev = history[history.length - 2];
    const curr = history[history.length - 1];

    const baselineDrop = curr.baseline_success_rate < prev.baseline_success_rate;
    const chaosDrop = curr.chaos_success_rate < prev.chaos_success_rate;
    const avgSpike = curr.baseline_avg_response > prev.baseline_avg_response * 1.5;

    if (baselineDrop || chaosDrop || avgSpike) {
      console.log("");
      if (baselineDrop) {
        console.log(`[WARNING] Baseline regression: ${prev.baseline_success_rate}% → ${curr.baseline_success_rate}% (Δ${(curr.baseline_success_rate - prev.baseline_success_rate).toFixed(1)}%)`);
      }
      if (chaosDrop) {
        console.log(`[WARNING] Chaos regression: ${prev.chaos_success_rate}% → ${curr.chaos_success_rate}% (Δ${(curr.chaos_success_rate - prev.chaos_success_rate).toFixed(1)}%)`);
      }
      if (avgSpike) {
        console.log(`[WARNING] Response time spike: ${prev.baseline_avg_response}ms → ${curr.baseline_avg_response}ms (+${Math.round(((curr.baseline_avg_response / prev.baseline_avg_response) - 1) * 100)}%)`);
      }
    } else {
      console.log("[STRESS] No regressions detected vs previous run");
    }
  }
  console.log("");
}

export async function runWsStressSimulation() {
  const totalStart = Date.now();
  console.log(`[STRESS] Starting two-phase stress test | ${DRIVER_COUNT} drivers | ${TEST_DURATION_MS / 1000}s per phase`);

  console.log("[STRESS] Cleanup...");
  await cleanupStressWsData();
  await bumpLimits();

  console.log(`[STRESS] Creating ${DRIVER_COUNT} drivers...`);
  let drivers: VirtualDriver[];
  try {
    drivers = await createDrivers();
    liveDrivers = drivers;
    liveMetrics.running = true;
    liveMetrics.current_phase = "setup";
    resetAlertState();
    console.log(`[STRESS] ${drivers.length} drivers created`);
  } catch (err: any) {
    console.log(`[STRESS] Driver creation failed: ${err.message}`);
    await restoreLimits();
    return;
  }

  console.log("[STRESS] Creating trip routes...");
  try {
    await createTrips(drivers);
    console.log(`[STRESS] ${drivers.filter(d => d.tripId).length} trips created`);
  } catch (err: any) {
    console.log(`[STRESS] Trip creation failed: ${err.message}`);
    await cleanupStressWsData();
    await restoreLimits();
    return;
  }

  console.log(`[STRESS] Connecting ${DRIVER_COUNT} WebSockets...`);
  const connectBatchSize = 25;
  for (let i = 0; i < drivers.length; i += connectBatchSize) {
    const batch = drivers.slice(i, i + connectBatchSize);
    await Promise.all(batch.map(d => connectDriverWS(d)));
  }
  const authed = drivers.filter(d => d.wsAuthed).length;
  console.log(`[STRESS] ${authed}/${DRIVER_COUNT} WebSocket authenticated`);

  const baselineConfig: PhaseConfig = {
    name: "BASELINE",
    acceptRate: 0.80,
    chaosOfflineRate: 0,
    chaosCancelRate: 0,
    networkRetryChance: 0,
    networkDelayMs: 0,
    durationMs: TEST_DURATION_MS,
    rideIntervalMs: RIDE_INTERVAL_MS,
  };

  const baselineReport = await runPhase(drivers, baselineConfig);

  console.log("[STRESS] Resetting for chaos phase...");
  await resetDriversForPhase(drivers);
  await sleep(3000);

  const chaosConfig: PhaseConfig = {
    name: "CHAOS",
    acceptRate: 0.80,
    chaosOfflineRate: 0.05,
    chaosCancelRate: 0.02,
    networkRetryChance: 0.05,
    networkDelayMs: 500,
    durationMs: TEST_DURATION_MS,
    rideIntervalMs: RIDE_INTERVAL_MS,
  };

  const chaosReport = await runPhase(drivers, chaosConfig);

  const baselineOk = baselineReport.success_rate >= 70;
  const chaosOk = chaosReport.passed;

  const result: StressResult = {
    timestamp: new Date().toISOString(),
    baseline: baselineReport,
    chaos: chaosReport,
    comparison: {
      success_rate_delta: Math.round((chaosReport.success_rate - baselineReport.success_rate) * 10) / 10,
      avg_response_delta: chaosReport.avg_response_time - baselineReport.avg_response_time,
      p95_response_delta: chaosReport.p95_response_time - baselineReport.p95_response_time,
      baseline_passed: baselineOk,
      chaos_passed: chaosOk,
      verdict: baselineOk && chaosOk ? "PASSED" : "NEEDS_REVIEW",
    },
    total_duration_s: 0,
  };

  console.log("[STRESS] Disconnecting WebSockets...");
  for (const driver of drivers) {
    if (driver.ws) {
      try { driver.ws.close(); } catch {}
    }
  }

  console.log("[STRESS] Final cleanup...");
  await cleanupStressWsData();
  await restoreLimits();

  result.total_duration_s = Math.round((Date.now() - totalStart) / 100) / 10;

  saveResult(result);

  console.log(`[STRESS] DONE | total=${result.total_duration_s}s | verdict=${result.comparison.verdict}`);
  console.log(`[STRESS] BASELINE: rides=${baselineReport.total_rides} accepted=${baselineReport.accepted_rides} success=${baselineReport.success_rate}% avg=${baselineReport.avg_response_time}ms p95=${baselineReport.p95_response_time}ms bugs=${baselineReport.critical_bugs}`);
  console.log(`[STRESS] CHAOS:    rides=${chaosReport.total_rides} accepted=${chaosReport.accepted_rides} success=${chaosReport.success_rate}% avg=${chaosReport.avg_response_time}ms p95=${chaosReport.p95_response_time}ms bugs=${chaosReport.critical_bugs} toggles=${chaosReport.chaos_offline_toggles} cancels=${chaosReport.chaos_cancels}`);

  printHistory(result);

  liveMetrics.running = false;
  liveMetrics.current_phase = "completed";
  liveDrivers = [];

  if (autonomousRecoveryActive) {
    autonomousRecoveryActive = false;
    if (autonomousRecoveryTimer) {
      clearTimeout(autonomousRecoveryTimer);
      autonomousRecoveryTimer = null;
    }
    console.log(`[RECOVERY] === AUTONOMOUS RECOVERY STOPPED: simulation ended ===`);
  }

  if (liveAlerts.length > 0) {
    try {
      const alertLogPath = join(process.cwd(), "stress-alerts.json");
      let existingLog: any[] = [];
      if (existsSync(alertLogPath)) {
        existingLog = JSON.parse(readFileSync(alertLogPath, "utf-8"));
      }
      const runEntry = {
        run_timestamp: new Date().toISOString(),
        total_alerts: liveAlerts.length,
        emergency: liveAlerts.filter(a => a.level === "emergency").length,
        critical: liveAlerts.filter(a => a.level === "critical").length,
        warning: liveAlerts.filter(a => a.level === "warning").length,
        recovery: liveAlerts.filter(a => a.type === "recovery").length,
        alerts: [...liveAlerts],
      };
      existingLog.push(runEntry);
      if (existingLog.length > 50) existingLog.splice(0, existingLog.length - 50);
      writeFileSync(alertLogPath, JSON.stringify(existingLog, null, 2));
      console.log(`[STRESS] Alerts saved: ${liveAlerts.length} alerts (${runEntry.emergency} emergency, ${runEntry.critical} critical, ${runEntry.warning} warning, ${runEntry.recovery} recovery)`);
    } catch (e: any) {
      console.log(`[STRESS] Failed to save alerts: ${e.message}`);
    }
  }

  saveOptimizerOnTestEnd();

  return result;
}

export async function triggerManualRecovery(actionType: string): Promise<{ ok: boolean; message: string }> {
  if (!["ws_reconnect", "dispatch_restart", "load_reduce"].includes(actionType)) {
    return { ok: false, message: `Unknown action: ${actionType}` };
  }
  try {
    if (actionType === "ws_reconnect") {
      await autoRecoverWsConnections(liveDrivers);
      return { ok: true, message: "WS reconnect triggered" };
    } else if (actionType === "dispatch_restart") {
      await autoRestartDispatchCycle();
      return { ok: true, message: "Dispatch restart triggered" };
    } else {
      autoReduceLoad();
      return { ok: true, message: "Load reduction triggered" };
    }
  } catch (e: any) {
    return { ok: false, message: e.message };
  }
}

export function getDecisionSuggestions(alertType?: string): {
  suggestions: Array<{
    action: string;
    label: string;
    icon: string;
    confidence: number;
    impact_min: number;
    impact_max: number;
    reason: string;
  }>;
} {
  const bucket = getLoadBucket();
  const effectiveness = getActionEffectiveness();
  const trend = analyzeTrend();
  const metaStatus = getMetaOptimizerStatus();

  const actionLabels: Record<string, { label: string; icon: string }> = {
    dispatch_restart: { label: "Restart Dispatch", icon: "refresh" },
    ws_reconnect: { label: "Reconnect Drivers", icon: "wifi" },
    load_reduce: { label: "Reduce Load 20%", icon: "trending-down" },
  };

  const alertActionMap: Record<string, string[]> = {
    success_rate: ["dispatch_restart", "ws_reconnect", "load_reduce"],
    latency: ["load_reduce", "dispatch_restart"],
    ws_drop: ["ws_reconnect", "dispatch_restart"],
    ws_errors: ["ws_reconnect", "load_reduce"],
    critical_bug: ["dispatch_restart", "load_reduce", "ws_reconnect"],
  };

  const relevantActions = alertType && alertActionMap[alertType]
    ? alertActionMap[alertType]
    : ALL_RECOVERY_TYPES as string[];

  const bestMetaStrategy = metaStatus.strategies
    .filter((s: any) => !s.disabled && s.uses > 0)
    .sort((a: any, b: any) => b.long_term_score - a.long_term_score)[0];

  const suggestions = relevantActions.map(action => {
    const eff = effectiveness[action];
    const info = actionLabels[action] || { label: action, icon: "zap" };

    let confidence = eff ? Math.round(eff.confidence * 100) : 50;

    const ctxEff = eff?.context_effectiveness;
    if (ctxEff && ctxEff.uses > 2) {
      confidence = Math.max(confidence, Math.round(ctxEff.avg_delta > 0 ? Math.min(95, 50 + ctxEff.avg_delta * 200) : 30));
    }

    if (bestMetaStrategy) {
      const seq = bestMetaStrategy.sequence as string[];
      if (seq.includes(action)) {
        confidence = Math.min(99, confidence + 10);
      }
    }

    if (eff?.blacklisted) {
      confidence = Math.max(5, confidence - 40);
    }

    const avgDelta = eff ? eff.avg_delta : 0;
    const impactBase = Math.max(5, Math.round(Math.abs(avgDelta) * 100));
    const impactMin = Math.max(3, impactBase - 5);
    const impactMax = Math.min(40, impactBase + 8);

    let reason = "";
    if (eff && eff.uses > 0) {
      reason = `${eff.uses} prior uses, avg +${(eff.avg_delta * 100).toFixed(0)}%`;
    } else {
      reason = "No prior data";
    }
    if (bestMetaStrategy && (bestMetaStrategy.sequence as string[]).includes(action)) {
      reason += " · Meta-optimizer recommended";
    }
    if (eff?.blacklisted) {
      reason += " · Blacklisted (low effectiveness)";
    }

    return {
      action,
      label: info.label,
      icon: info.icon,
      confidence: Math.max(5, Math.min(99, confidence)),
      impact_min: impactMin,
      impact_max: impactMax,
      reason,
    };
  });

  suggestions.sort((a, b) => b.confidence - a.confidence);

  return { suggestions };
}

let autoExecEnabled = true;
let autoExecMode: "safe" | "aggressive" = "safe";
let autoExecLastActionTime = 0;
let autoExecLastAction: string | null = null;
let autoExecLastActionFailed = false;
let autoExecCooldownMs = 10000;
let autoExecMetricsBefore: { success_rate: number; avg_response_time: number } | null = null;

interface AutoExecLogEntry {
  timestamp: string;
  action: string;
  alert_type: string;
  alert_level: string;
  confidence: number;
  result: "success" | "failed" | "reverted" | "pending";
  metrics_before: { success_rate: number; latency: number };
  metrics_after: { success_rate: number; latency: number } | null;
  detail: string;
}

const autoExecLog: AutoExecLogEntry[] = [];
let autoExecSuccessCount = 0;
let autoExecTotalCount = 0;

function shouldAutoExec(alertLevel: string): boolean {
  if (!autoExecEnabled) return false;
  if (autoExecMode === "safe") {
    return alertLevel === "critical" || alertLevel === "emergency";
  }
  return alertLevel === "critical" || alertLevel === "emergency" || alertLevel === "warning";
}

let autoExecInFlight = false;

function tryAutoExec(alertType: string, alertLevel: string) {
  if (!shouldAutoExec(alertLevel)) return;

  if (isSystemRecovered()) {
    console.log(`[AUTO] system already recovered, skipping auto-action`);
    return;
  }

  if (autoExecInFlight) {
    console.log(`[AUTO] action in-flight, skipping`);
    return;
  }

  const now = Date.now();
  if (now - autoExecLastActionTime < autoExecCooldownMs) {
    console.log(`[AUTO] cooldown active, skipping (${Math.round((autoExecCooldownMs - (now - autoExecLastActionTime)) / 1000)}s remaining)`);
    return;
  }

  const { suggestions } = getDecisionSuggestions(alertType);
  if (suggestions.length === 0) return;

  const top = suggestions[0];

  if (autoExecLastAction === top.action && autoExecLastActionFailed) {
    console.log(`[AUTO] skipping ${top.action} — last attempt failed, trying next`);
    const alt = suggestions.find(s => s.action !== top.action);
    if (!alt) {
      console.log(`[AUTO] no alternative actions available`);
      return;
    }
    executeAutoAction(alt, alertType, alertLevel);
    return;
  }

  executeAutoAction(top, alertType, alertLevel);
}

function executeAutoAction(suggestion: { action: string; label: string; confidence: number }, alertType: string, alertLevel: string) {
  const now = Date.now();
  autoExecInFlight = true;
  autoExecLastActionTime = now;
  autoExecLastAction = suggestion.action;
  autoExecTotalCount++;

  autoExecMetricsBefore = {
    success_rate: liveMetrics.success_rate,
    avg_response_time: liveMetrics.avg_response_time,
  };

  const entry: AutoExecLogEntry = {
    timestamp: new Date().toISOString(),
    action: suggestion.action,
    alert_type: alertType,
    alert_level: alertLevel,
    confidence: suggestion.confidence,
    result: "pending",
    metrics_before: { success_rate: liveMetrics.success_rate, latency: liveMetrics.avg_response_time },
    metrics_after: null,
    detail: `Auto-executing ${suggestion.label} for ${alertType} (${alertLevel})`,
  };
  autoExecLog.push(entry);
  if (autoExecLog.length > 100) autoExecLog.splice(0, autoExecLog.length - 100);

  console.log(`[AUTO] action=${suggestion.action} reason=${alertType} confidence=${suggestion.confidence}% level=${alertLevel}`);

  triggerManualRecovery(suggestion.action).then(result => {
    autoExecInFlight = false;
    if (result.ok) {
      entry.result = "success";
      autoExecLastActionFailed = false;
      console.log(`[AUTO] ${suggestion.action} executed successfully`);
    } else {
      entry.result = "failed";
      autoExecLastActionFailed = true;
      console.log(`[AUTO] ${suggestion.action} failed: ${result.message}`);
    }

    setTimeout(() => {
      checkAutoExecEffectiveness(entry);
    }, 15000);
  }).catch(() => {
    autoExecInFlight = false;
    entry.result = "failed";
    autoExecLastActionFailed = true;
    console.log(`[AUTO] ${suggestion.action} threw error`);
  });
}

function checkAutoExecEffectiveness(entry: AutoExecLogEntry) {
  const afterMetrics = {
    success_rate: liveMetrics.success_rate,
    latency: liveMetrics.avg_response_time,
  };
  entry.metrics_after = afterMetrics;

  const srDelta = afterMetrics.success_rate - entry.metrics_before.success_rate;
  const latDelta = entry.metrics_before.latency - afterMetrics.latency;

  const improved = srDelta >= -2 && (srDelta > 0 || latDelta > 50);

  if (improved) {
    entry.result = "success";
    autoExecLastActionFailed = false;
    autoExecSuccessCount++;
    console.log(`[AUTO] effectiveness check: POSITIVE sr_delta=+${srDelta.toFixed(1)}% lat_delta=${latDelta.toFixed(0)}ms`);
  } else {
    entry.result = "reverted";
    autoExecLastActionFailed = true;
    console.log(`[AUTO] effectiveness check: NEGATIVE sr_delta=${srDelta.toFixed(1)}% lat_delta=${latDelta.toFixed(0)}ms → marking for rollback`);

    if (entry.action === "load_reduce") {
      autoRestoreLoad();
      console.log(`[AUTO] reverted load_reduce — restoring load multiplier`);
    }
  }
}

export function getAutoExecState() {
  return {
    enabled: autoExecEnabled,
    mode: autoExecMode,
    cooldown_ms: autoExecCooldownMs,
    last_action: autoExecLastAction,
    last_action_time: autoExecLastActionTime,
    last_action_failed: autoExecLastActionFailed,
    total_actions: autoExecTotalCount,
    successful_actions: autoExecSuccessCount,
    success_rate: autoExecTotalCount > 0 ? Math.round((autoExecSuccessCount / autoExecTotalCount) * 100) : 0,
    log: autoExecLog.slice(-20),
  };
}

export function setAutoExecEnabled(enabled: boolean) {
  autoExecEnabled = enabled;
  console.log(`[AUTO] ${enabled ? "ENABLED" : "DISABLED"}`);
}

export function setAutoExecMode(mode: "safe" | "aggressive") {
  autoExecMode = mode;
  console.log(`[AUTO] mode set to ${mode.toUpperCase()}`);
}
