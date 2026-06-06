import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import DispatcherLayout from "./DispatcherLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity, Zap, Clock, Users, AlertTriangle, AlertCircle, CheckCircle2,
  TrendingUp, TrendingDown, Wifi, WifiOff, BarChart3, Timer, Gauge,
  Bell, BellOff, X, Volume2, VolumeX, Shield, ChevronDown, ChevronUp,
  Brain, SkipForward, Play, PauseCircle, ArrowDown, ArrowUp, RefreshCw, Loader2
} from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const BUFFER_SIZE = 60;

interface LiveMetrics {
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

type AlertReason = "drivers_offline" | "low_accept_rate" | "high_latency" | "websocket_drop" | "critical_bug" | "ws_errors" | "unknown";
type AlertRouting = "dashboard" | "dashboard+telegram" | "dashboard+telegram+sms";

interface StressAlert {
  id: string;
  type: "success_rate" | "latency" | "ws_drop" | "critical_bug" | "ws_errors" | "recovery";
  severity: "info" | "warning" | "critical" | "emergency";
  level: "info" | "warning" | "critical" | "emergency";
  message: string;
  value: number;
  threshold: number;
  phase: string;
  timestamp: string;
  acknowledged: boolean;
  duration: number;
  avg_value: number;
  count: number;
  reason?: AlertReason;
  routing?: AlertRouting;
  incident_id?: string;
}

type RootCause = "driver_availability_issue" | "backend_overload" | "connection_issue" | "critical_failure" | "unknown";

interface Incident {
  id: string;
  type: string;
  start_time: string;
  last_update: string;
  max_severity: "info" | "warning" | "critical" | "emergency";
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

interface RecoveryAction {
  id: string;
  type: "ws_reconnect" | "dispatch_restart" | "load_reduce";
  trigger: string;
  message: string;
  detail: string;
  timestamp: string;
  result: "pending" | "success" | "failed";
  duration_ms: number;
}

interface ContextScoreData {
  bucket: string;
  uses: number;
  avg_effectiveness: number;
  avg_sr_delta: number;
  avg_latency_delta: number;
}

interface ObjectiveScoresData {
  health: number;
  completion: number;
  earnings: number;
  combined: number;
}

interface ActionScoreData {
  type: string;
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
  history: { timestamp: string; effectiveness: number; sr_delta: number; latency_delta: number; result: string; context?: string; time_bucket?: string; objectives?: ObjectiveScoresData }[];
  context_scores: ContextScoreData[];
  objective_impact: ObjectiveScoresData;
}

interface RecentActionData {
  type: string;
  timestamp: string;
  effectiveness: number;
}

interface OptDecisionData {
  id: string;
  timestamp: string;
  type: string;
  decision: "execute" | "skip" | "cooldown_adjusted" | "explore" | "best_pick" | "multi_action" | "repetition_penalty";
  reason: string;
  score_at_time: number;
  context?: string;
  time_context?: string;
  health_at_time?: number;
  candidates?: { type: string; score: number }[];
  objectives?: ObjectiveScoresData;
  executed_actions?: string[];
}

interface HealthScoreData {
  value: number;
  sr_component: number;
  latency_component: number;
  ws_component: number;
  trend: "improving" | "stable" | "degrading";
}

interface DriverBehaviorData {
  driverId: number;
  city: string;
  tier: "top" | "good" | "average" | "poor";
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

interface ProfitMetricsData {
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

interface DemandPredictionData {
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

interface GenerationSnapshotData {
  generation: number;
  timestamp: string;
  health: number;
  objectives: ObjectiveScoresData;
  profitMetrics: ProfitMetricsData;
  totalActions: number;
  totalEffective: number;
  avgEffectiveness: number;
  driverTierDistribution: Record<string, number>;
  topCorridors: string[];
  score: number;
}

interface OptimizationData {
  scores: ActionScoreData[];
  decisions: OptDecisionData[];
  generation: number;
  total_actions: number;
  total_effective: number;
  total_ineffective: number;
  total_explored: number;
  learning_rate: number;
  exploration_rate: number;
  health: HealthScoreData;
  context_bucket: string;
  time_bucket: string;
  objectives: ObjectiveScoresData;
  recent_actions: RecentActionData[];
  multi_action_count: number;
  profit: ProfitMetricsData;
  driver_model: DriverBehaviorData[];
  demand_predictions: DemandPredictionData[];
  generation_snapshots: GenerationSnapshotData[];
  best_generation: number;
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

interface TimePoint {
  t: number;
  second: number;
  success_rate: number;
  avg_response: number;
  rides_per_minute: number;
  rides: number;
  accepted: number;
  failed: number;
  ws_connections: number;
}

type Zone = "green" | "yellow" | "red";

function getSuccessZone(v: number): Zone {
  if (v >= 90) return "green";
  if (v >= 70) return "yellow";
  return "red";
}

function getLatencyZone(v: number): Zone {
  if (v <= 300) return "green";
  if (v <= 800) return "yellow";
  return "red";
}

function getRpmZone(v: number, max: number): Zone {
  if (max === 0) return "green";
  const ratio = v / max;
  if (ratio >= 0.6) return "green";
  if (ratio >= 0.3) return "yellow";
  return "red";
}

const ZONE_COLORS: Record<Zone, { stroke: string; fill: string; bg: string; text: string; glow: string }> = {
  green: { stroke: "#22c55e", fill: "rgba(34,197,94,0.08)", bg: "rgba(34,197,94,0.06)", text: "text-green-400", glow: "drop-shadow(0 0 6px rgba(34,197,94,0.4))" },
  yellow: { stroke: "#eab308", fill: "rgba(234,179,8,0.08)", bg: "rgba(234,179,8,0.06)", text: "text-yellow-400", glow: "drop-shadow(0 0 6px rgba(234,179,8,0.4))" },
  red: { stroke: "#ef4444", fill: "rgba(239,68,68,0.08)", bg: "rgba(239,68,68,0.06)", text: "text-red-400", glow: "drop-shadow(0 0 6px rgba(239,68,68,0.4))" },
};

const ALERT_ICONS: Record<string, typeof AlertTriangle> = {
  success_rate: Zap,
  latency: Clock,
  ws_drop: WifiOff,
  critical_bug: Shield,
  ws_errors: AlertTriangle,
};

function playAlertSound(severity: string) {
  if (severity === "info") return;
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.15;

    if (severity === "emergency" || severity === "critical") {
      osc.frequency.value = 880;
      osc.type = "square";
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.6);

      setTimeout(() => {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.frequency.value = 660;
        osc2.type = "square";
        gain2.gain.value = 0.12;
        gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
        osc2.start();
        osc2.stop(ctx.currentTime + 0.5);
      }, 200);
    } else {
      osc.frequency.value = 600;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    }
  } catch {}
}

function StatusBadge({ running, phase }: { running: boolean; phase: string }) {
  if (!running && phase === "idle") {
    return <Badge variant="secondary" className="text-sm px-3 py-1">Ожидание</Badge>;
  }
  if (!running && phase === "completed") {
    return <Badge className="bg-green-500/10 text-green-400 border-green-500/30 text-sm px-3 py-1">Завершён</Badge>;
  }
  return (
    <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-sm px-3 py-1 animate-pulse">
      {phase === "baseline" ? "⚡ Baseline" : phase === "chaos" ? "🔥 Chaos" : phase}
    </Badge>
  );
}

function getAlertLevelEmoji(level: string, isRecovery: boolean): string {
  if (isRecovery) return "🟢";
  if (level === "emergency" || level === "critical") return "🔴";
  if (level === "warning") return "🟡";
  return "🔵";
}

function getAlertBorderColor(level: string, isRecovery: boolean): string {
  if (isRecovery) return "border-l-green-500";
  if (level === "emergency" || level === "critical") return "border-l-red-500";
  if (level === "warning") return "border-l-amber-500";
  return "border-l-blue-500";
}

function getAlertAccentColor(level: string, isRecovery: boolean): string {
  if (isRecovery) return "text-green-400";
  if (level === "emergency" || level === "critical") return "text-red-400";
  if (level === "warning") return "text-amber-400";
  return "text-blue-400";
}

function parseAlertTitle(alert: StressAlert): string {
  const typeLabels: Record<string, string> = {
    success_rate: "Success Rate",
    latency: "Latency",
    ws_drop: "WebSocket",
    critical_bug: "Critical Bug",
    ws_errors: "WS Errors",
    recovery: "Recovery",
  };
  return typeLabels[alert.type] || alert.type;
}

function parseAlertMetric(alert: StressAlert): { value: string; unit: string } {
  if (alert.type === "recovery") return { value: "OK", unit: "" };
  if (alert.type === "success_rate") return { value: `${Math.round(alert.value)}`, unit: "%" };
  if (alert.type === "latency") return { value: `${Math.round(alert.value)}`, unit: "ms" };
  if (alert.type === "ws_drop" || alert.type === "ws_errors") return { value: `${Math.round(alert.value)}`, unit: "" };
  return { value: `${Math.round(alert.value)}`, unit: "" };
}

interface DecisionSuggestion {
  action: string;
  label: string;
  icon: string;
  confidence: number;
  impact_min: number;
  impact_max: number;
  reason: string;
}

const SUGGESTION_ICONS: Record<string, typeof RefreshCw> = {
  refresh: RefreshCw,
  wifi: Wifi,
  "trending-down": TrendingDown,
  zap: Zap,
};

function useDecisionSuggestions(alertType: string | null) {
  const [suggestions, setSuggestions] = useState<DecisionSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!alertType || alertType === "recovery") {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    fetch(`${BASE_URL}/api/metrics/stress/decision-suggestions?alert_type=${alertType}`)
      .then(r => r.json())
      .then(data => {
        setSuggestions(data.suggestions || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [alertType]);

  return { suggestions, loading };
}

function applyRecoveryAction(action: string): Promise<{ ok: boolean; message: string }> {
  return fetch(`${BASE_URL}/api/metrics/stress/recovery/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  }).then(r => r.json());
}

function AlertPopup({
  alert,
  onDismiss,
  onAck,
}: {
  alert: StressAlert;
  onDismiss: () => void;
  onAck: (id: string) => void;
}) {
  const level = alert.level || alert.severity;
  const isRecovery = alert.type === "recovery";
  const emoji = getAlertLevelEmoji(level, isRecovery);
  const borderColor = getAlertBorderColor(level, isRecovery);
  const accentColor = getAlertAccentColor(level, isRecovery);
  const title = parseAlertTitle(alert);
  const metric = parseAlertMetric(alert);
  const [showDetails, setShowDetails] = useState(false);
  const [applyingAction, setApplyingAction] = useState<string | null>(null);
  const [appliedAction, setAppliedAction] = useState<string | null>(null);

  const { suggestions, loading: suggestionsLoading } = useDecisionSuggestions(
    isRecovery ? null : alert.type
  );

  const levelLabel = isRecovery ? "ВОССТАНОВЛЕНИЕ" : level === "emergency" ? "АВАРИЯ" : level === "critical" ? "КРИТИЧЕСКАЯ" : "ПРЕДУПРЕЖДЕНИЕ";

  const handleApplyFix = async (action: string) => {
    setApplyingAction(action);
    try {
      const result = await applyRecoveryAction(action);
      if (result.ok) {
        setAppliedAction(action);
      }
    } catch {}
    setApplyingAction(null);
  };

  const topSuggestion = suggestions[0];

  return (
    <div className={`fixed top-4 right-4 z-50 w-[420px] rounded-xl border border-border/40 shadow-2xl backdrop-blur-md transition-all animate-in slide-in-from-right-5 duration-300 bg-card border-l-4 ${borderColor}`}>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">{emoji}</span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${accentColor}`}>
                {levelLabel}
              </span>
            </div>
            <h3 className="text-base font-bold text-foreground">{title}</h3>
            <div className="flex items-baseline gap-1.5 mt-2">
              <span className={`text-3xl font-bold font-mono ${accentColor}`}>{metric.value}</span>
              {metric.unit && <span className="text-base font-medium text-muted-foreground">{metric.unit}</span>}
            </div>
            {alert.duration > 0 && (
              <p className="text-xs text-muted-foreground mt-2">Below threshold for {alert.duration}s</p>
            )}
          </div>
          <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground transition-colors mt-0.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!isRecovery && topSuggestion && (
          <div className="mt-4 pt-3 border-t border-border/30">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Brain className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider">Recommended</span>
            </div>

            <div className="space-y-2">
              {suggestions.slice(0, 3).map((s, idx) => {
                const SIcon = SUGGESTION_ICONS[s.icon] || Zap;
                const isTop = idx === 0;
                const isApplying = applyingAction === s.action;
                const isApplied = appliedAction === s.action;

                return (
                  <div key={s.action} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${isTop ? "bg-blue-500/10 border border-blue-500/20" : "bg-muted/10"}`}>
                    <SIcon className={`w-4 h-4 shrink-0 ${isTop ? "text-blue-400" : "text-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold ${isTop ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{s.confidence}%</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        +{s.impact_min}–{s.impact_max}% improvement
                      </span>
                    </div>
                    {isApplied ? (
                      <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                    ) : (
                      <Button
                        size="sm"
                        variant={isTop ? "default" : "outline"}
                        className={`text-[10px] h-6 px-2 shrink-0 ${isTop ? "bg-blue-600 hover:bg-blue-700 text-white" : "border-border/40"}`}
                        onClick={() => handleApplyFix(s.action)}
                        disabled={!!applyingAction}
                      >
                        {isApplying ? <Loader2 className="w-3 h-3 animate-spin" /> : "Fix"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/30">
          <button
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showDetails ? "Hide" : "Details"}
          </button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 border-border/40 hover:bg-muted/30"
            onClick={() => onAck(alert.id)}
          >
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Dismiss
          </Button>
        </div>

        {showDetails && (
          <div className="mt-2 pt-2 border-t border-border/30 space-y-1 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Phase</span>
              <span className="font-mono">{alert.phase}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Time</span>
              <span className="font-mono">{new Date(alert.timestamp).toLocaleTimeString()}</span>
            </div>
            {alert.count > 1 && (
              <div className="flex items-center justify-between">
                <span>Events</span>
                <span className="font-mono">{alert.count}</span>
              </div>
            )}
            {alert.threshold > 0 && (
              <div className="flex items-center justify-between">
                <span>Threshold</span>
                <span className="font-mono">{alert.threshold}{alert.type === "success_rate" ? "%" : alert.type === "latency" ? "ms" : ""}</span>
              </div>
            )}
            {alert.reason && alert.reason !== "unknown" && (
              <div className="flex items-center justify-between">
                <span>Reason</span>
                <span className="font-mono">{REASON_LABELS[alert.reason] || alert.reason}</span>
              </div>
            )}
            {alert.routing && alert.routing !== "dashboard" && (
              <div className="flex items-center justify-between">
                <span>Routing</span>
                <span>{ROUTING_LABELS[alert.routing]?.label || alert.routing}</span>
              </div>
            )}
            {alert.incident_id && (
              <div className="flex items-center justify-between">
                <span>Incident</span>
                <span className="font-mono text-[10px]">{alert.incident_id}</span>
              </div>
            )}
            {suggestions.length > 0 && suggestions[0].reason && (
              <div className="flex items-start justify-between mt-1 pt-1 border-t border-border/20">
                <span>AI Basis</span>
                <span className="text-[10px] text-right max-w-[200px]">{suggestions[0].reason}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CriticalBanner({
  alerts,
  onAckAll,
}: {
  alerts: StressAlert[];
  onAckAll: () => void;
}) {
  const unacked = alerts.filter(a => !a.acknowledged && a.type !== "recovery");
  const emergency = unacked.filter(a => (a.level || a.severity) === "emergency");
  const critical = unacked.filter(a => (a.level || a.severity) === "critical");
  const warning = unacked.filter(a => (a.level || a.severity) === "warning");
  const recoveries = alerts.filter(a => !a.acknowledged && a.type === "recovery");

  if (unacked.length === 0 && recoveries.length === 0) return null;

  const hasEmergency = emergency.length > 0;
  const hasCritical = critical.length > 0 || hasEmergency;
  const isRecoveryOnly = recoveries.length > 0 && unacked.length === 0;

  const borderColor = isRecoveryOnly ? "border-l-green-500" : hasCritical ? "border-l-red-500" : "border-l-amber-500";
  const emoji = isRecoveryOnly ? "🟢" : hasCritical ? "🔴" : "🟡";

  return (
    <div className={`rounded-lg bg-card border border-border/40 border-l-4 ${borderColor} px-5 py-4`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">{emoji}</span>
          <div>
            <span className="text-sm font-bold text-foreground">
              {isRecoveryOnly ? "Система восстановлена" : `${unacked.length} активных тревог`}
            </span>
            {!isRecoveryOnly && (
              <div className="text-xs text-muted-foreground mt-0.5">
                {emergency.length > 0 && `${emergency.length} авар.`}
                {emergency.length > 0 && (critical.length > 0 || warning.length > 0) && " · "}
                {critical.length > 0 && `${critical.length} крит.`}
                {critical.length > 0 && warning.length > 0 && " · "}
                {warning.length > 0 && `${warning.length} пред.`}
                {recoveries.length > 0 && ` · ${recoveries.length} восст.`}
              </div>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7 border-border/40"
          onClick={onAckAll}
        >
          <BellOff className="w-3 h-3 mr-1" />
          Подтвердить все
        </Button>
      </div>
    </div>
  );
}

function AlertLogExpanded({ alert: a }: { alert: StressAlert }) {
  const isRecovery = a.type === "recovery";
  const { suggestions } = useDecisionSuggestions(isRecovery ? null : a.type);
  const [applyingAction, setApplyingAction] = useState<string | null>(null);
  const [appliedAction, setAppliedAction] = useState<string | null>(null);

  const handleApplyFix = async (action: string) => {
    setApplyingAction(action);
    try {
      const result = await applyRecoveryAction(action);
      if (result.ok) {
        setAppliedAction(action);
      }
    } catch {}
    setApplyingAction(null);
  };

  return (
    <div className="px-4 pb-3 pt-0 border-t border-border/20 mt-0">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 pt-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Phase</span>
          <span className="font-mono text-foreground">{a.phase}</span>
        </div>
        {a.count > 1 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Events</span>
            <span className="font-mono text-foreground">{a.count}</span>
          </div>
        )}
        {a.threshold > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Threshold</span>
            <span className="font-mono text-foreground">{a.threshold}{a.type === "success_rate" ? "%" : a.type === "latency" ? "ms" : ""}</span>
          </div>
        )}
        {a.avg_value > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Avg Value</span>
            <span className="font-mono text-foreground">{Math.round(a.avg_value * 10) / 10}</span>
          </div>
        )}
        {a.reason && a.reason !== "unknown" && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Reason</span>
            <span className="text-foreground">{REASON_LABELS[a.reason] || a.reason}</span>
          </div>
        )}
        {a.routing && a.routing !== "dashboard" && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Routing</span>
            <span className="text-foreground">{ROUTING_LABELS[a.routing]?.label || a.routing}</span>
          </div>
        )}
        {a.incident_id && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Incident</span>
            <span className="font-mono text-foreground text-[10px]">{a.incident_id}</span>
          </div>
        )}
      </div>

      {!isRecovery && suggestions.length > 0 && !a.acknowledged && (
        <div className="mt-2 pt-2 border-t border-border/20">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Brain className="w-3 h-3 text-blue-400" />
            <span className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider">Quick Fix</span>
          </div>
          <div className="space-y-1.5">
            {suggestions.slice(0, 3).map(s => {
              const SIcon = SUGGESTION_ICONS[s.icon] || Zap;
              const isApplying = applyingAction === s.action;
              const isApplied = appliedAction === s.action;
              return (
                <div key={s.action} className="flex items-center gap-2">
                  <SIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="text-[10px] font-medium text-foreground">{s.label}</span>
                  <span className="text-[9px] text-muted-foreground font-mono">{s.confidence}%</span>
                  <span className="text-[9px] text-muted-foreground">+{s.impact_min}–{s.impact_max}%</span>
                  <div className="flex-1" />
                  {isApplied ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[9px] h-5 px-1.5 border-border/40"
                      onClick={() => handleApplyFix(s.action)}
                      disabled={!!applyingAction}
                    >
                      {isApplying ? <Loader2 className="w-3 h-3 animate-spin" /> : "Fix"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface AutoExecState {
  enabled: boolean;
  mode: "safe" | "aggressive";
  cooldown_ms: number;
  last_action: string | null;
  last_action_time: number;
  last_action_failed: boolean;
  total_actions: number;
  successful_actions: number;
  success_rate: number;
  log: Array<{
    timestamp: string;
    action: string;
    alert_type: string;
    alert_level: string;
    confidence: number;
    result: string;
    metrics_before: { success_rate: number; latency: number };
    metrics_after: { success_rate: number; latency: number } | null;
    detail: string;
  }>;
}

const ACTION_LABELS: Record<string, string> = {
  dispatch_restart: "Restart Dispatch",
  ws_reconnect: "Reconnect Drivers",
  load_reduce: "Reduce Load",
};

const RESULT_STYLES: Record<string, { color: string; label: string }> = {
  success: { color: "text-green-400", label: "OK" },
  failed: { color: "text-red-400", label: "FAIL" },
  reverted: { color: "text-amber-400", label: "REVERTED" },
  pending: { color: "text-blue-400", label: "PENDING" },
};

function AutoExecPanel() {
  const [state, setState] = useState<AutoExecState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    const load = () => {
      fetch(`${BASE_URL}/api/metrics/stress/auto-exec`)
        .then(r => r.json())
        .then(setState)
        .catch(() => {});
    };
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  const toggleEnabled = async () => {
    if (!state) return;
    setToggling(true);
    try {
      const res = await fetch(`${BASE_URL}/api/metrics/stress/auto-exec/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !state.enabled }),
      });
      if (res.ok) setState(prev => prev ? { ...prev, enabled: !prev.enabled } : prev);
    } catch {}
    setToggling(false);
  };

  const switchMode = async (mode: "safe" | "aggressive") => {
    try {
      const res = await fetch(`${BASE_URL}/api/metrics/stress/auto-exec/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) setState(prev => prev ? { ...prev, mode } : prev);
    } catch {}
  };

  if (!state) return null;

  const recentLog = [...state.log].reverse();

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Brain className="w-4 h-4 text-blue-400" />
            Auto Execution
            {state.enabled ? (
              <Badge className="bg-green-500/10 text-green-400 border-green-500/30 text-[10px] px-1.5 py-0">ON</Badge>
            ) : (
              <Badge className="bg-muted/20 text-muted-foreground border-border/30 text-[10px] px-1.5 py-0">OFF</Badge>
            )}
            <Badge className={`text-[10px] px-1.5 py-0 ${state.mode === "aggressive" ? "bg-red-500/10 text-red-400 border-red-500/30" : "bg-blue-500/10 text-blue-400 border-blue-500/30"}`}>
              {state.mode === "aggressive" ? "AGGRESSIVE" : "SAFE"}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className={`text-[10px] h-6 px-2 ${state.mode === "safe" ? "border-blue-500/30 text-blue-400" : "border-border/40"}`}
              onClick={() => switchMode("safe")}
            >
              Safe
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={`text-[10px] h-6 px-2 ${state.mode === "aggressive" ? "border-red-500/30 text-red-400" : "border-border/40"}`}
              onClick={() => switchMode("aggressive")}
            >
              Aggressive
            </Button>
            <Button
              size="sm"
              variant={state.enabled ? "default" : "outline"}
              className={`text-[10px] h-6 px-3 ${state.enabled ? "bg-green-600 hover:bg-green-700 text-white" : "border-border/40"}`}
              onClick={toggleEnabled}
              disabled={toggling}
            >
              {toggling ? <Loader2 className="w-3 h-3 animate-spin" /> : state.enabled ? "Disable" : "Enable"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="text-center">
            <div className="text-lg font-bold font-mono text-foreground">{state.total_actions}</div>
            <div className="text-[10px] text-muted-foreground">Total Actions</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold font-mono text-green-400">{state.successful_actions}</div>
            <div className="text-[10px] text-muted-foreground">Successful</div>
          </div>
          <div className="text-center">
            <div className={`text-lg font-bold font-mono ${state.success_rate >= 70 ? "text-green-400" : state.success_rate >= 40 ? "text-amber-400" : "text-red-400"}`}>
              {state.success_rate}%
            </div>
            <div className="text-[10px] text-muted-foreground">Success Rate</div>
          </div>
        </div>

        {state.last_action && (
          <div className={`rounded-lg border px-3 py-2 mb-3 border-l-4 ${state.last_action_failed ? "border-l-red-500 bg-red-500/5" : "border-l-green-500 bg-green-500/5"} border-border/30`}>
            <div className="flex items-center gap-2">
              <span className="text-xs">
                {state.last_action_failed ? "🔴" : "🟢"}
              </span>
              <span className="text-xs font-semibold text-foreground">
                {state.last_action_failed ? "AUTO FIX FAILED" : "AUTO FIX APPLIED"}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">{ACTION_LABELS[state.last_action] || state.last_action}</span>
            </div>
          </div>
        )}

        <button
          className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          Execution Log ({state.log.length})
        </button>

        {expanded && recentLog.length > 0 && (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {recentLog.map((entry, idx) => {
              const rs = RESULT_STYLES[entry.result] || RESULT_STYLES.pending;
              return (
                <div key={idx} className="flex items-center gap-2 text-[10px] px-2 py-1.5 rounded bg-muted/10">
                  <span className={`font-bold ${rs.color}`}>{rs.label}</span>
                  <span className="font-mono text-foreground">{ACTION_LABELS[entry.action] || entry.action}</span>
                  <span className="text-muted-foreground">{entry.alert_type}</span>
                  <span className="text-muted-foreground font-mono">{entry.confidence}%</span>
                  {entry.metrics_after && (
                    <span className="text-muted-foreground">
                      SR: {entry.metrics_before.success_rate}→{entry.metrics_after.success_rate}%
                    </span>
                  )}
                  <div className="flex-1" />
                  <span className="text-muted-foreground">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AlertLog({
  alerts,
  onAck,
}: {
  alerts: StressAlert[];
  onAck: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set());
  const sorted = [...alerts].reverse();

  const toggleAlertExpand = (id: string) => {
    setExpandedAlerts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Bell className="w-4 h-4 text-amber-400" />
            Журнал тревог ({alerts.length})
            {alerts.filter(a => !a.acknowledged).length > 0 && (
              <Badge className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px] px-1.5 py-0">
                {alerts.filter(a => !a.acknowledged).length} new
              </Badge>
            )}
          </CardTitle>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0">
          {sorted.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground justify-center">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              Тревог нет
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {sorted.map(a => {
                const isRecovery = a.type === "recovery";
                const level = a.level || a.severity;
                const emoji = getAlertLevelEmoji(level, isRecovery);
                const borderColor = getAlertBorderColor(level, isRecovery);
                const accentColor = getAlertAccentColor(level, isRecovery);
                const title = parseAlertTitle(a);
                const metric = parseAlertMetric(a);
                const isOpen = expandedAlerts.has(a.id);

                return (
                  <div
                    key={a.id}
                    className={`rounded-lg border border-border/30 border-l-4 ${borderColor} transition-all ${
                      a.acknowledged ? "opacity-40" : ""
                    } bg-card`}
                  >
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                      onClick={() => toggleAlertExpand(a.id)}
                    >
                      <span className="text-sm shrink-0">{emoji}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-bold text-foreground">{title}</span>
                        <span className="text-muted-foreground text-sm">: </span>
                        <span className={`text-sm font-bold font-mono ${accentColor}`}>{metric.value}{metric.unit}</span>
                      </div>
                      {a.duration > 0 && (
                        <span className="text-xs text-muted-foreground shrink-0">{a.duration}s</span>
                      )}
                      <span className="text-xs text-muted-foreground shrink-0">{new Date(a.timestamp).toLocaleTimeString()}</span>
                      {!a.acknowledged && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onAck(a.id); }}
                          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          title="Подтвердить"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    {isOpen && (
                      <AlertLogExpanded alert={a} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

const REASON_LABELS: Record<AlertReason, string> = {
  drivers_offline: "Водители оффлайн",
  low_accept_rate: "Низкий % принятия",
  high_latency: "Высокая задержка",
  websocket_drop: "Обрыв WebSocket",
  critical_bug: "Критический баг",
  ws_errors: "Ошибки WS",
  unknown: "Неизвестно",
};

const ROOT_CAUSE_LABELS: Record<RootCause, { label: string; color: string }> = {
  driver_availability_issue: { label: "Нехватка водителей", color: "text-orange-400 bg-orange-500/10 border-orange-500/20" },
  backend_overload: { label: "Перегрузка бэкенда", color: "text-red-400 bg-red-500/10 border-red-500/20" },
  connection_issue: { label: "Проблема соединения", color: "text-violet-400 bg-violet-500/10 border-violet-500/20" },
  critical_failure: { label: "Критический сбой", color: "text-red-400 bg-red-500/10 border-red-500/20" },
  unknown: { label: "Неизвестно", color: "text-muted-foreground bg-muted/10 border-border/30" },
};

const ROUTING_LABELS: Record<AlertRouting, { label: string; color: string }> = {
  "dashboard": { label: "Дашборд", color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  "dashboard+telegram": { label: "Дашборд + TG", color: "text-violet-400 bg-violet-500/10 border-violet-500/20" },
  "dashboard+telegram+sms": { label: "Дашборд + TG + SMS", color: "text-red-400 bg-red-500/10 border-red-500/20" },
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  success_rate: "Success Rate",
  latency: "Задержка",
  ws_drop: "WS обрыв",
  critical_bug: "Крит. баг",
  ws_errors: "WS ошибки",
  recovery: "Восстановление",
};

function IncidentPanel({ incidents }: { incidents: Incident[] }) {
  const [expanded, setExpanded] = useState(true);
  const active = incidents.filter(i => i.active);
  const resolved = incidents.filter(i => !i.active);

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Shield className="w-4 h-4 text-orange-400" />
            Инциденты ({incidents.length})
            {active.length > 0 && (
              <Badge className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px] px-1.5 py-0">
                {active.length} активных
              </Badge>
            )}
          </CardTitle>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0">
          {incidents.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground justify-center">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              Инцидентов нет
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {active.length > 0 && (
                <div className="space-y-1.5">
                  {active.map(inc => (
                    <IncidentRow key={inc.id} incident={inc} />
                  ))}
                </div>
              )}
              {resolved.length > 0 && (
                <div className="space-y-1.5">
                  {active.length > 0 && <div className="text-[10px] text-muted-foreground uppercase tracking-wider pt-2 pb-1">Разрешённые</div>}
                  {resolved.slice(0, 10).map(inc => (
                    <IncidentRow key={inc.id} incident={inc} />
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

const RECOVERY_ACTION_LABELS: Record<string, string> = {
  ws_reconnect: "WS реконнект",
  dispatch_restart: "Перезапуск диспатча",
  load_reduce: "Снижение нагрузки",
};

function IncidentRow({ incident }: { incident: Incident }) {
  const severityStyle = incident.active
    ? incident.max_severity === "emergency"
      ? "bg-red-500/10 border-red-500/30 text-red-400"
      : incident.max_severity === "critical"
        ? "bg-red-500/10 border-red-500/20 text-red-400"
        : "bg-yellow-500/10 border-yellow-500/20 text-yellow-400"
    : "bg-muted/10 border-border/30 text-muted-foreground opacity-60";

  const severityBadge = incident.max_severity === "emergency" ? "АВАР"
    : incident.max_severity === "critical" ? "КРИТ"
      : incident.max_severity === "warning" ? "ПРЕД" : "ИНФО";

  const rootCauseInfo = ROOT_CAUSE_LABELS[incident.root_cause as RootCause] || ROOT_CAUSE_LABELS.unknown;

  return (
    <div className={`rounded-lg text-xs border ${severityStyle}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className={`w-2 h-2 rounded-full shrink-0 ${incident.active ? "animate-pulse" : ""} ${
          incident.max_severity === "emergency" ? "bg-red-500" :
            incident.max_severity === "critical" ? "bg-red-400" :
              incident.max_severity === "warning" ? "bg-yellow-400" : "bg-blue-400"
        }`} />
        <Badge className={`text-[9px] px-1 py-0 ${severityStyle}`}>{severityBadge}</Badge>
        <span className="font-mono text-[10px] shrink-0">{incident.id}</span>
        <span className="font-medium">{ALERT_TYPE_LABELS[incident.type] || incident.type}</span>
        <Badge className="text-[9px] px-1 py-0 bg-muted/20 text-muted-foreground border-border/30">
          {REASON_LABELS[incident.reason] || incident.reason}
        </Badge>
        <Badge className={`text-[9px] px-1 py-0 border ${rootCauseInfo.color}`}>
          {rootCauseInfo.label}
        </Badge>
        <span className="flex-1" />
        <span>{incident.alert_count} тревог</span>
        <span>{incident.duration_s}с</span>
        <span className="shrink-0">{new Date(incident.start_time).toLocaleTimeString()}</span>
        {!incident.active && <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />}
      </div>
      {((incident.recovery_actions?.length || 0) > 0 || incident.recovered_by) && (
        <div className="flex items-center gap-2 px-3 pb-2 border-t border-border/20 pt-1.5">
          {(incident.recovery_actions?.length || 0) > 0 && (
            <div className="flex items-center gap-1">
              <Shield className="w-3 h-3 text-blue-400" />
              <span className="text-[10px] text-muted-foreground">Плейбук (шаг {incident.playbook_step}):</span>
              {incident.recovery_actions.map((a, i) => (
                <Badge key={i} className="text-[9px] px-1 py-0 bg-blue-500/10 text-blue-400 border-blue-500/20">
                  {RECOVERY_ACTION_LABELS[a] || a}
                </Badge>
              ))}
            </div>
          )}
          <span className="flex-1" />
          {incident.recovered_by && !incident.active && (
            <span className="text-[10px] text-green-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {RECOVERY_ACTION_LABELS[incident.recovered_by] || incident.recovered_by}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const RECOVERY_ICONS: Record<string, typeof Activity> = {
  ws_reconnect: Wifi,
  dispatch_restart: Zap,
  load_reduce: Gauge,
};

interface EffectivenessEntry {
  uses: number;
  avg_delta: number;
  last_delta: number;
  smart_score?: number;
  blacklisted?: boolean;
  consecutive_fails?: number;
  confidence?: number;
  context_bucket?: string;
  context_effectiveness?: {
    bucket: string;
    uses: number;
    avg_delta: number;
    successes: number;
  } | null;
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

interface AIStatus {
  trend: TrendAnalysis;
  context_bucket: string;
  health: {
    value: number;
    sr: number;
    latency: number;
    ws: number;
    trend: TrendAnalysis;
  };
  preventive_actions_count: number;
  preventive_cooldown_remaining: number;
  trend_samples: number;
  actions: {
    type: string;
    smart_score: number;
    confidence: number;
    context_effectiveness: { bucket: string; uses: number; avg_delta: number; successes: number } | null;
  }[];
}

function EffectivenessPanel({ data }: { data: Record<string, EffectivenessEntry> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  const sorted = [...entries].sort((a, b) => (b[1].smart_score ?? 0) - (a[1].smart_score ?? 0));

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-violet-400" />
          Адаптивный выбор стратегий
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {sorted.map(([action, stats], idx) => {
          const isPositive = stats.avg_delta > 0;
          const isBest = idx === 0 && (stats.smart_score ?? 0) > 0;
          return (
            <div key={action} className={`px-3 py-2 rounded-lg border ${
              stats.blacklisted ? "border-red-500/30 bg-red-500/5" :
              isBest ? "border-green-500/30 bg-green-500/5" :
              "border-border/30 bg-muted/5"
            }`}>
              <div className="flex items-center gap-3">
                {isBest && <span className="text-[9px] text-green-400 font-medium">★</span>}
                <Badge className={`text-[10px] px-1.5 py-0 font-mono ${
                  stats.blacklisted ? "bg-red-500/10 text-red-400 border-red-500/20" :
                  "bg-blue-500/10 text-blue-400 border-blue-500/20"
                }`}>
                  {RECOVERY_ACTION_LABELS[action] || action}
                </Badge>
                {stats.blacklisted && (
                  <Badge className="text-[9px] px-1 py-0 bg-red-500/10 text-red-400 border-red-500/20 animate-pulse">
                    БЛОК
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">{stats.uses} исп.</span>
                {(stats.consecutive_fails ?? 0) > 0 && (
                  <span className="text-[10px] text-red-400">{stats.consecutive_fails} ошиб.</span>
                )}
                <div className="flex-1" />
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">скор:</span>
                  <span className={`text-xs font-mono font-medium ${
                    (stats.smart_score ?? 0) > 0.3 ? "text-green-400" :
                    (stats.smart_score ?? 0) > 0 ? "text-yellow-400" : "text-red-400"
                  }`}>
                    {(stats.smart_score ?? 0).toFixed(3)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">ср.Δ:</span>
                  <span className={`text-xs font-mono font-medium ${isPositive ? "text-green-400" : "text-red-400"}`}>
                    {isPositive ? "+" : ""}{stats.avg_delta.toFixed(3)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">посл.:</span>
                  <span className={`text-xs font-mono font-medium ${stats.last_delta > 0 ? "text-green-400" : "text-red-400"}`}>
                    {stats.last_delta > 0 ? "+" : ""}{stats.last_delta.toFixed(3)}
                  </span>
                </div>
                {stats.confidence !== undefined && (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">увер.:</span>
                    <span className={`text-xs font-mono font-medium ${
                      stats.confidence > 0.7 ? "text-green-400" :
                      stats.confidence > 0.4 ? "text-yellow-400" : "text-red-400"
                    }`}>
                      {(stats.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
              </div>
              {stats.context_bucket && (
                <div className="flex items-center gap-2 mt-1 pl-6">
                  <span className="text-[9px] text-muted-foreground">контекст: {CONTEXT_LABELS[stats.context_bucket] || stats.context_bucket}</span>
                  {stats.context_effectiveness && (
                    <span className="text-[9px] text-muted-foreground">
                      ({stats.context_effectiveness.uses} исп., ср.Δ {stats.context_effectiveness.avg_delta > 0 ? "+" : ""}{stats.context_effectiveness.avg_delta.toFixed(3)})
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

const CONTEXT_LABELS: Record<string, string> = {
  low_load: "Низкая нагрузка",
  mid_load: "Средняя нагрузка",
  high_load: "Высокая нагрузка",
};

const PREDICTED_ISSUE_LABELS: Record<string, string> = {
  success_rate_decline: "Снижение успешности",
  latency_increase: "Рост латентности",
  health_degradation: "Деградация здоровья",
};

function AITrendPanel({ aiStatus }: { aiStatus: AIStatus | null }) {
  if (!aiStatus) return null;

  const { trend, context_bucket, health, preventive_actions_count, preventive_cooldown_remaining, trend_samples } = aiStatus;
  const hasIssue = trend.predicted_issue !== null;
  const hasCooldown = preventive_cooldown_remaining > 0;

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Brain className="w-4 h-4 text-violet-400" />
          AI Предиктивный анализ
          <Badge className={`text-[9px] px-1.5 py-0 ${
            hasIssue ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
            "bg-green-500/10 text-green-400 border-green-500/20"
          }`}>
            {hasIssue ? "ОБНАРУЖЕН ТРЕНД" : "СТАБИЛЬНО"}
          </Badge>
          <Badge className="text-[9px] px-1.5 py-0 bg-violet-500/10 text-violet-400 border-violet-500/20">
            {CONTEXT_LABELS[context_bucket] || context_bucket}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="px-3 py-2 rounded-lg border border-border/30 bg-muted/5">
            <div className="text-[9px] text-muted-foreground mb-1">SR тренд</div>
            <div className={`text-xs font-mono font-medium ${
              trend.sr_dropping ? "text-red-400" :
              trend.sr_slope > 0 ? "text-green-400" : "text-muted-foreground"
            }`}>
              {trend.sr_slope > 0 ? "+" : ""}{trend.sr_slope.toFixed(2)}/с
              {trend.sr_dropping && " ↓"}
            </div>
          </div>
          <div className="px-3 py-2 rounded-lg border border-border/30 bg-muted/5">
            <div className="text-[9px] text-muted-foreground mb-1">Латентность</div>
            <div className={`text-xs font-mono font-medium ${
              trend.latency_rising ? "text-red-400" :
              trend.latency_slope < 0 ? "text-green-400" : "text-muted-foreground"
            }`}>
              {trend.latency_slope > 0 ? "+" : ""}{trend.latency_slope.toFixed(1)}ms/с
              {trend.latency_rising && " ↑"}
            </div>
          </div>
          <div className="px-3 py-2 rounded-lg border border-border/30 bg-muted/5">
            <div className="text-[9px] text-muted-foreground mb-1">Здоровье</div>
            <div className={`text-xs font-mono font-medium ${
              trend.health_degrading ? "text-red-400" :
              trend.health_slope > 0 ? "text-green-400" : "text-muted-foreground"
            }`}>
              {trend.health_slope > 0 ? "+" : ""}{(trend.health_slope * 100).toFixed(2)}/с
              {trend.health_degrading && " ↓"}
            </div>
          </div>
        </div>

        {hasIssue && (
          <div className="px-3 py-2 rounded-lg border border-orange-500/30 bg-orange-500/5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
              <span className="text-xs text-orange-400 font-medium">
                Прогноз: {PREDICTED_ISSUE_LABELS[trend.predicted_issue!] || trend.predicted_issue}
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>Превентивных действий: {preventive_actions_count}</span>
          {hasCooldown && <span>Кулдаун: {Math.ceil(preventive_cooldown_remaining / 1000)}с</span>}
          <span>Сэмплов: {trend_samples}</span>
          <span>Здоровье: {(health.value * 100).toFixed(1)}%</span>
        </div>

        {aiStatus.actions.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground font-medium">Уверенность действий:</div>
            {aiStatus.actions.map(a => (
              <div key={a.type} className="flex items-center gap-2 text-[10px]">
                <span className="text-muted-foreground w-24">{RECOVERY_ACTION_LABELS[a.type] || a.type}</span>
                <div className="flex-1 h-1.5 bg-muted/20 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      a.confidence > 0.7 ? "bg-green-500" :
                      a.confidence > 0.4 ? "bg-yellow-500" : "bg-red-500"
                    }`}
                    style={{ width: `${a.confidence * 100}%` }}
                  />
                </div>
                <span className="text-muted-foreground font-mono w-8 text-right">{(a.confidence * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface MetaStrategyInfo {
  id: string;
  sequence: string[];
  incident_type: string;
  context: string;
  uses: number;
  success_rate: number;
  avg_recovery_time_ms: number;
  avg_improvement: number;
  score: number;
  long_term_score: number;
  stability: number;
  selection_weight: number;
  disabled: boolean;
  source: string;
  is_best: boolean;
  history_length: number;
}

interface ClusterStats {
  total: number;
  active: number;
  disabled: number;
  best_score: number;
  best_id: string;
  avg_score: number;
}

interface MetaOptimizerData {
  total_strategies: number;
  active_strategies: number;
  disabled_strategies: number;
  current_context: string;
  exploration_rate: number;
  clusters: Record<string, ClusterStats>;
  active_execution: {
    strategy_id: string;
    incident_id: string;
    elapsed_ms: number;
    actions_executed: string[];
  } | null;
  strategies: MetaStrategyInfo[];
}

const SOURCE_LABELS: Record<string, string> = {
  playbook: "Плейбук",
  mutation: "Мутация",
  crossover: "Кроссовер",
  discovered: "Открыта",
};

function MetaOptimizerPanel({ data }: { data: MetaOptimizerData | null }) {
  const [expanded, setExpanded] = useState(true);
  const [showDisabled, setShowDisabled] = useState(false);
  if (!data) return null;

  const activeStrats = data.strategies.filter(s => !s.disabled);
  const disabledStrats = data.strategies.filter(s => s.disabled);
  const displayStrats = showDisabled ? data.strategies : activeStrats;
  const sorted = [...displayStrats].sort((a, b) => (b.long_term_score ?? b.score ?? 0) - (a.long_term_score ?? a.score ?? 0));

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-400" />
            Мета-оптимизатор
            <Badge className="text-[9px] px-1.5 py-0 bg-violet-500/10 text-violet-400 border-violet-500/20">
              {data.active_strategies} активных
            </Badge>
            {data.disabled_strategies > 0 && (
              <Badge className="text-[9px] px-1.5 py-0 bg-red-500/10 text-red-400 border-red-500/20">
                {data.disabled_strategies} убрано
              </Badge>
            )}
            <Badge className="text-[9px] px-1.5 py-0 bg-blue-500/10 text-blue-400 border-blue-500/20">
              {CONTEXT_LABELS[data.current_context] || data.current_context}
            </Badge>
            {data.active_execution && (
              <Badge className="text-[9px] px-1.5 py-0 bg-orange-500/10 text-orange-400 border-orange-500/20 animate-pulse">
                ВЫПОЛНЯЕТСЯ
              </Badge>
            )}
          </CardTitle>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-3">
          {data.active_execution && (
            <div className="px-3 py-2 rounded-lg border border-orange-500/30 bg-orange-500/5">
              <div className="flex items-center gap-2 text-xs">
                <Activity className="w-3.5 h-3.5 text-orange-400 animate-spin" />
                <span className="text-orange-400 font-medium">
                  Стратегия {data.active_execution.strategy_id}
                </span>
                <span className="text-muted-foreground">
                  {Math.round(data.active_execution.elapsed_ms / 1000)}с
                </span>
                {data.active_execution.actions_executed.length > 0 && (
                  <span className="text-muted-foreground">
                    [{data.active_execution.actions_executed.map(a => RECOVERY_ACTION_LABELS[a] || a).join(" → ")}]
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 text-[10px] text-muted-foreground flex-wrap">
            <span>Exploration: {Math.round(data.exploration_rate * 100)}%</span>
            <span>Exploitation: {Math.round((1 - data.exploration_rate) * 100)}%</span>
            {disabledStrats.length > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowDisabled(!showDisabled); }}
                className="text-violet-400 hover:text-violet-300 underline"
              >
                {showDisabled ? "Скрыть убранные" : "Показать убранные"}
              </button>
            )}
          </div>

          {data.clusters && (
            <div className="grid grid-cols-3 gap-2">
              {(["low_load", "mid_load", "high_load"] as const).map(ctx => {
                const cl = data.clusters[ctx];
                if (!cl || cl.total === 0) return (
                  <div key={ctx} className="px-2 py-1.5 rounded border border-border/20 bg-muted/5 text-center">
                    <div className="text-[9px] text-muted-foreground">{CONTEXT_LABELS[ctx]}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">—</div>
                  </div>
                );
                return (
                  <div key={ctx} className="px-2 py-1.5 rounded border border-border/30 bg-muted/5">
                    <div className="text-[9px] text-muted-foreground">{CONTEXT_LABELS[ctx]}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-green-400 font-medium">{cl.active}</span>
                      {cl.disabled > 0 && <span className="text-[10px] text-red-400">-{cl.disabled}</span>}
                      <span className={`text-[10px] font-mono font-medium ml-auto ${
                        cl.best_score > 0.6 ? "text-green-400" : cl.best_score > 0.3 ? "text-yellow-400" : "text-muted-foreground"
                      }`}>
                        {cl.best_score > 0 ? cl.best_score.toFixed(2) : "—"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {sorted.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              Стратегии будут создаваться при запуске восстановления
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map(strat => (
                <div key={strat.id} className={`px-3 py-2 rounded-lg border ${
                  strat.disabled
                    ? "border-red-500/20 bg-red-500/5 opacity-60"
                    : strat.is_best
                      ? "border-green-500/30 bg-green-500/5"
                      : "border-border/30 bg-muted/5"
                }`}>
                  <div className="flex items-center gap-2">
                    {strat.is_best && !strat.disabled && <span className="text-[9px] text-green-400 font-medium">★</span>}
                    {strat.disabled && <span className="text-[9px] text-red-400 font-medium">✕</span>}
                    <span className="text-[10px] font-mono text-blue-400">
                      {strat.sequence.map(a => RECOVERY_ACTION_LABELS[a] || a).join(" → ")}
                    </span>
                    <Badge className="text-[8px] px-1 py-0 bg-violet-500/10 text-violet-400 border-violet-500/20">
                      {SOURCE_LABELS[strat.source] || strat.source}
                    </Badge>
                    {(strat.selection_weight ?? 1) > 1.5 && (
                      <Badge className="text-[8px] px-1 py-0 bg-green-500/10 text-green-400 border-green-500/20">
                        ↑{(strat.selection_weight ?? 1).toFixed(1)}x
                      </Badge>
                    )}
                    {(strat.selection_weight ?? 1) < 0.5 && !strat.disabled && (
                      <Badge className="text-[8px] px-1 py-0 bg-yellow-500/10 text-yellow-400 border-yellow-500/20">
                        ↓{(strat.selection_weight ?? 1).toFixed(1)}x
                      </Badge>
                    )}
                    <div className="flex-1" />
                    <span className={`text-xs font-mono font-medium ${
                      (strat.long_term_score ?? 0) > 0.6 ? "text-green-400" : (strat.long_term_score ?? 0) > 0.3 ? "text-yellow-400" : "text-red-400"
                    }`}>
                      {(strat.long_term_score ?? strat.score ?? 0).toFixed(3)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[9px] text-muted-foreground flex-wrap">
                    <span>{strat.uses} исп.</span>
                    <span>Успех: {(strat.success_rate * 100).toFixed(0)}%</span>
                    {strat.avg_recovery_time_ms > 0 && (
                      <span>Время: {(strat.avg_recovery_time_ms / 1000).toFixed(1)}с</span>
                    )}
                    <span>Стаб: {((strat.stability ?? 0.5) * 100).toFixed(0)}%</span>
                    <span>Δ: {strat.avg_improvement > 0 ? "+" : ""}{strat.avg_improvement.toFixed(3)}</span>
                    <span>{ALERT_TYPE_LABELS[strat.incident_type] || strat.incident_type}</span>
                    <span>{CONTEXT_LABELS[strat.context] || strat.context}</span>
                    {strat.history_length > 0 && (
                      <span>Ист: {strat.history_length}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

interface RevenueAIData {
  enabled: boolean;
  current_mode: string;
  demand_supply: {
    active_drivers: number;
    busy_drivers: number;
    idle_drivers: number;
    pending_requests: number;
    demand_supply_ratio: number;
    timestamp: string;
  };
  surge: {
    multiplier: number;
    trend: string;
    trigger_ratio: number;
    last_change_at: string;
  };
  driver_rankings: {
    driverId: number;
    city: string;
    acceptance_rate: number;
    avg_response_ms: number;
    completion_rate: number;
    idle_time_pct: number;
    priority_score: number;
    tier: string;
    is_idle: boolean;
  }[];
  metrics: {
    revenue_per_minute: number;
    completed_rides: number;
    avg_ride_price: number;
    driver_utilization_pct: number;
    total_revenue: number;
    revenue_trend: string;
    idle_driver_assignments: number;
    top_driver_assignments: number;
  };
  strategy_results: {
    mode: string;
    score: number;
    revenue_delta_pct: number;
    utilization_delta_pct: number;
    rides_delta: number;
    evaluation_window_s: number;
    evaluated_at: string;
  }[];
  best_strategy: string;
  logs: string[];
}

const REVENUE_MODE_LABELS: Record<string, string> = {
  aggressive: "Агрессивный",
  conservative: "Консервативный",
  surge_heavy: "Сурж-фокус",
};

const REVENUE_MODE_COLORS: Record<string, string> = {
  aggressive: "text-red-400 bg-red-500/10 border-red-500/20",
  conservative: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  surge_heavy: "text-orange-400 bg-orange-500/10 border-orange-500/20",
};

const REVENUE_TREND_ICONS: Record<string, string> = {
  growing: "↑",
  stable: "→",
  declining: "↓",
};

function RevenueAIPanel({ data }: { data: RevenueAIData | null }) {
  const [expanded, setExpanded] = useState(true);
  const [showDrivers, setShowDrivers] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  if (!data) return null;

  const ds = data.demand_supply || { active_drivers: 0, busy_drivers: 0, idle_drivers: 0, pending_requests: 0, demand_supply_ratio: 0, timestamp: "" };
  const surge = data.surge || { multiplier: 1, trend: "stable", trigger_ratio: 0, last_change_at: "" };
  const metrics = data.metrics || { revenue_per_minute: 0, completed_rides: 0, avg_ride_price: 0, driver_utilization_pct: 0, total_revenue: 0, revenue_trend: "stable", idle_driver_assignments: 0, top_driver_assignments: 0 };
  const results = data.strategy_results || [];
  const rankings = data.driver_rankings || [];

  const formatPrice = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return `${v}`;
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            Revenue AI
            {data.enabled ? (
              <Badge className="text-[9px] px-1.5 py-0 bg-green-500/10 text-green-400 border-green-500/20 animate-pulse">
                ACTIVE
              </Badge>
            ) : (
              <Badge className="text-[9px] px-1.5 py-0 bg-zinc-500/10 text-zinc-400 border-zinc-500/20">
                IDLE
              </Badge>
            )}
            <Badge className={`text-[9px] px-1.5 py-0 ${REVENUE_MODE_COLORS[data.current_mode] || "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"}`}>
              {REVENUE_MODE_LABELS[data.current_mode] || data.current_mode}
            </Badge>
            {surge.multiplier > 1.05 && (
              <Badge className="text-[9px] px-1.5 py-0 bg-yellow-500/10 text-yellow-400 border-yellow-500/20 animate-pulse">
                SURGE ×{surge.multiplier.toFixed(2)}
              </Badge>
            )}
          </CardTitle>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="px-3 py-2 rounded-lg border border-border/30 bg-muted/5">
              <div className="text-[9px] text-muted-foreground">Доход/мин</div>
              <div className="text-sm font-mono font-bold text-emerald-400">
                {formatPrice(metrics.revenue_per_minute)}
              </div>
              <div className="text-[9px] text-muted-foreground">
                {REVENUE_TREND_ICONS[metrics.revenue_trend] || "→"} {metrics.revenue_trend === "growing" ? "Рост" : metrics.revenue_trend === "declining" ? "Падение" : "Стабильно"}
              </div>
            </div>
            <div className="px-3 py-2 rounded-lg border border-border/30 bg-muted/5">
              <div className="text-[9px] text-muted-foreground">Всего доход</div>
              <div className="text-sm font-mono font-bold text-blue-400">
                {formatPrice(metrics.total_revenue)}
              </div>
              <div className="text-[9px] text-muted-foreground">
                Ср. цена: {formatPrice(metrics.avg_ride_price)}
              </div>
            </div>
            <div className="px-3 py-2 rounded-lg border border-border/30 bg-muted/5">
              <div className="text-[9px] text-muted-foreground">Утилизация</div>
              <div className={`text-sm font-mono font-bold ${
                metrics.driver_utilization_pct > 70 ? "text-green-400" : metrics.driver_utilization_pct > 40 ? "text-yellow-400" : "text-red-400"
              }`}>
                {metrics.driver_utilization_pct}%
              </div>
              <div className="text-[9px] text-muted-foreground">
                {metrics.completed_rides} поездок
              </div>
            </div>
            <div className="px-3 py-2 rounded-lg border border-border/30 bg-muted/5">
              <div className="text-[9px] text-muted-foreground">Спрос/Предл.</div>
              <div className={`text-sm font-mono font-bold ${
                ds.demand_supply_ratio > 1.5 ? "text-red-400" : ds.demand_supply_ratio > 1.0 ? "text-yellow-400" : "text-green-400"
              }`}>
                {ds.demand_supply_ratio.toFixed(2)}
              </div>
              <div className="text-[9px] text-muted-foreground">
                {ds.pending_requests} ожид. / {ds.idle_drivers} своб.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="px-2 py-1.5 rounded border border-border/30 bg-muted/5 text-center">
              <div className="text-[9px] text-muted-foreground">Водители</div>
              <div className="flex items-center justify-center gap-1 mt-0.5">
                <span className="text-[10px] text-green-400 font-medium">{ds.active_drivers}</span>
                <span className="text-[9px] text-muted-foreground">/</span>
                <span className="text-[10px] text-yellow-400">{ds.busy_drivers} заняты</span>
                <span className="text-[9px] text-muted-foreground">/</span>
                <span className="text-[10px] text-blue-400">{ds.idle_drivers} своб.</span>
              </div>
            </div>
            <div className="px-2 py-1.5 rounded border border-border/30 bg-muted/5 text-center">
              <div className="text-[9px] text-muted-foreground">Сурж-множитель</div>
              <div className={`text-sm font-mono font-bold ${
                surge.multiplier > 1.5 ? "text-red-400" : surge.multiplier > 1.1 ? "text-yellow-400" : "text-green-400"
              }`}>
                ×{surge.multiplier.toFixed(2)}
              </div>
              <div className="text-[9px] text-muted-foreground">
                {surge.trend === "increasing" ? "↑ растёт" : surge.trend === "decreasing" ? "↓ снижается" : "→ стабильно"}
              </div>
            </div>
            <div className="px-2 py-1.5 rounded border border-border/30 bg-muted/5 text-center">
              <div className="text-[9px] text-muted-foreground">Лучшая стратегия</div>
              <div className={`text-[10px] font-medium mt-0.5 ${
                data.best_strategy === "aggressive" ? "text-red-400" : data.best_strategy === "surge_heavy" ? "text-orange-400" : "text-blue-400"
              }`}>
                {REVENUE_MODE_LABELS[data.best_strategy] || data.best_strategy}
              </div>
            </div>
          </div>

          {results.length > 0 && (
            <div className="space-y-1">
              <div className="text-[9px] text-muted-foreground font-medium">Оценки стратегий</div>
              <div className="space-y-1">
                {results.slice(-5).reverse().map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] px-2 py-1 rounded border border-border/20 bg-muted/5">
                    <Badge className={`text-[8px] px-1 py-0 ${REVENUE_MODE_COLORS[r.mode] || ""}`}>
                      {REVENUE_MODE_LABELS[r.mode] || r.mode}
                    </Badge>
                    <span className={`font-mono ${r.score > 0 ? "text-green-400" : "text-red-400"}`}>
                      {r.score > 0 ? "+" : ""}{r.score.toFixed(3)}
                    </span>
                    <span className="text-muted-foreground">
                      доход: {r.revenue_delta_pct > 0 ? "+" : ""}{r.revenue_delta_pct.toFixed(1)}%
                    </span>
                    <span className="text-muted-foreground">
                      утил: {r.utilization_delta_pct > 0 ? "+" : ""}{r.utilization_delta_pct.toFixed(1)}%
                    </span>
                    <span className="text-muted-foreground ml-auto">
                      {r.evaluation_window_s}с
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 text-[10px]">
            <button
              onClick={(e) => { e.stopPropagation(); setShowDrivers(!showDrivers); }}
              className="text-emerald-400 hover:text-emerald-300 underline"
            >
              {showDrivers ? "Скрыть рейтинг" : `Рейтинг водителей (${rankings.length})`}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setShowLogs(!showLogs); }}
              className="text-emerald-400 hover:text-emerald-300 underline"
            >
              {showLogs ? "Скрыть логи" : `Логи (${data.logs.length})`}
            </button>
          </div>

          {showDrivers && rankings.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {rankings.slice(0, 15).map((d, i) => (
                <div key={d.driverId} className={`flex items-center gap-2 text-[10px] px-2 py-1 rounded border ${
                  d.is_idle ? "border-blue-500/20 bg-blue-500/5" : "border-border/20 bg-muted/5"
                }`}>
                  <span className="text-muted-foreground w-4 text-right">{i + 1}</span>
                  <span className="font-mono text-blue-400 w-8">#{d.driverId}</span>
                  {d.is_idle && <Badge className="text-[7px] px-1 py-0 bg-blue-500/10 text-blue-400 border-blue-500/20">IDLE</Badge>}
                  <Badge className={`text-[7px] px-1 py-0 ${
                    d.tier === "top" ? "bg-green-500/10 text-green-400 border-green-500/20" :
                    d.tier === "good" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                    d.tier === "average" ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" :
                    "bg-red-500/10 text-red-400 border-red-500/20"
                  }`}>
                    {d.tier}
                  </Badge>
                  <span className="text-muted-foreground">прин:{d.acceptance_rate}%</span>
                  <span className="text-muted-foreground">отв:{d.avg_response_ms}мс</span>
                  <span className="text-muted-foreground">заверш:{d.completion_rate}%</span>
                  <span className={`font-mono ml-auto font-medium ${
                    d.priority_score > 0.6 ? "text-green-400" : d.priority_score > 0.3 ? "text-yellow-400" : "text-red-400"
                  }`}>
                    {d.priority_score.toFixed(3)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {showLogs && data.logs.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-0.5 font-mono text-[9px]">
              {data.logs.slice().reverse().map((log, i) => (
                <div key={i} className={`px-2 py-0.5 rounded ${
                  log.includes("surge") ? "text-yellow-400 bg-yellow-500/5" :
                  log.includes("increased") ? "text-green-400 bg-green-500/5" :
                  log.includes("switch") ? "text-violet-400 bg-violet-500/5" :
                  log.includes("prioritized") ? "text-blue-400 bg-blue-500/5" :
                  "text-muted-foreground"
                }`}>
                  {log}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function RecoveryLog({
  actions,
  multiplier,
}: {
  actions: RecoveryAction[];
  multiplier: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const sorted = [...actions].reverse();

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-400" />
            Авто-восстановление ({actions.length})
            {multiplier > 1 && (
              <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-[10px] px-1.5 py-0">
                Нагрузка ×{multiplier.toFixed(1)}
              </Badge>
            )}
            {actions.filter(a => a.result === "success").length > 0 && (
              <Badge className="bg-green-500/10 text-green-400 border-green-500/30 text-[10px] px-1.5 py-0">
                {actions.filter(a => a.result === "success").length} OK
              </Badge>
            )}
          </CardTitle>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0">
          {sorted.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground justify-center">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              Действий не было
            </div>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {sorted.map(a => {
                const Icon = RECOVERY_ICONS[a.type] || Shield;
                const resultColor = a.result === "success" ? "text-green-400" : a.result === "failed" ? "text-red-400" : "text-yellow-400";
                const bgClass = a.result === "success"
                  ? "bg-green-500/10 border border-green-500/20"
                  : a.result === "failed"
                    ? "bg-red-500/10 border border-red-500/20"
                    : "bg-blue-500/10 border border-blue-500/20";
                return (
                  <div key={a.id} className={`px-3 py-2 rounded-lg text-xs ${bgClass}`}>
                    <div className="flex items-center gap-2">
                      <Icon className={`w-3.5 h-3.5 shrink-0 ${resultColor}`} />
                      <span className="flex-1 font-medium">{a.message}</span>
                      <span className={`shrink-0 font-mono font-medium ${resultColor}`}>
                        {a.result === "success" ? "OK" : a.result === "failed" ? "FAIL" : "..."}
                      </span>
                      {a.duration_ms > 0 && (
                        <span className="text-muted-foreground shrink-0">{a.duration_ms}ms</span>
                      )}
                      <span className="text-muted-foreground shrink-0">{new Date(a.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground pl-5">{a.detail}</div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

const TYPE_LABELS: Record<string, string> = {
  ws_reconnect: "WS Reconnect",
  dispatch_restart: "Dispatch Restart",
  load_reduce: "Load Reduce",
};

const DECISION_ICONS: Record<string, typeof Activity> = {
  execute: Play,
  skip: SkipForward,
  cooldown_adjusted: Timer,
  explore: Zap,
  best_pick: TrendingUp,
  multi_action: AlertTriangle,
  repetition_penalty: Clock,
};

const CTX_LABELS: Record<string, string> = {
  low_load: "Низкая",
  mid_load: "Средняя",
  high_load: "Высокая",
};

const TIME_LABELS: Record<string, string> = {
  morning: "Утро",
  day: "День",
  evening: "Вечер",
  night: "Ночь",
};

const TIME_ICONS: Record<string, string> = {
  morning: "🌅",
  day: "☀️",
  evening: "🌆",
  night: "🌙",
};

const TREND_ICONS: Record<string, typeof Activity> = {
  improving: TrendingUp,
  stable: Activity,
  degrading: TrendingDown,
};

function EffectivenessBar({ value }: { value: number }) {
  const clamped = Math.max(-1, Math.min(1, value));
  const pct = Math.abs(clamped) * 50;
  const isPositive = clamped >= 0;
  return (
    <div className="relative h-2.5 w-full rounded-full bg-muted/20 overflow-hidden">
      <div className="absolute top-0 left-1/2 w-px h-full bg-muted-foreground/30" />
      {isPositive ? (
        <div
          className="absolute top-0 h-full bg-green-500/60 rounded-r-full transition-all"
          style={{ left: "50%", width: `${pct}%` }}
        />
      ) : (
        <div
          className="absolute top-0 h-full bg-red-500/60 rounded-l-full transition-all"
          style={{ right: "50%", width: `${pct}%` }}
        />
      )}
    </div>
  );
}

function ObjectiveBars({ objectives, label }: { objectives: ObjectiveScoresData; label?: string }) {
  const items = [
    { key: "health", name: "Здоровье", color: "bg-green-500/60", value: objectives.health },
    { key: "completion", name: "Завершение", color: "bg-blue-500/60", value: objectives.completion },
    { key: "earnings", name: "Заработок", color: "bg-yellow-500/60", value: objectives.earnings },
  ];
  return (
    <div className="space-y-1">
      {label && <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</div>}
      {items.map(item => (
        <div key={item.key} className="flex items-center gap-2 text-[10px]">
          <span className="text-muted-foreground w-16 truncate">{item.name}</span>
          <div className="flex-1 h-1.5 rounded-full bg-muted/20 overflow-hidden">
            <div className={`h-full ${item.color} rounded-full transition-all`} style={{ width: `${Math.max(0, item.value) * 100}%` }} />
          </div>
          <span className="font-mono w-8 text-right">{Math.round(item.value * 100)}%</span>
        </div>
      ))}
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-muted-foreground w-16 font-medium">Общий</span>
        <div className="flex-1 h-2 rounded-full bg-muted/20 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${objectives.combined >= 0.7 ? "bg-green-500/70" : objectives.combined >= 0.5 ? "bg-yellow-500/70" : "bg-red-500/70"}`} style={{ width: `${Math.max(0, objectives.combined) * 100}%` }} />
        </div>
        <span className={`font-mono w-8 text-right font-medium ${objectives.combined >= 0.7 ? "text-green-400" : objectives.combined >= 0.5 ? "text-yellow-400" : "text-red-400"}`}>{Math.round(objectives.combined * 100)}%</span>
      </div>
    </div>
  );
}

function RecentActionsList({ actions }: { actions: RecentActionData[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-[9px] text-muted-foreground mr-1">Память:</span>
      {actions.map((a, i) => {
        const color = a.effectiveness > 0.05 ? "bg-green-500/20 text-green-400 border-green-500/30" : a.effectiveness < -0.05 ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-muted/20 text-muted-foreground border-border/20";
        return (
          <span key={i} className={`text-[8px] px-1 py-0 rounded border ${color}`} title={`${a.type}: eff=${a.effectiveness.toFixed(3)}`}>
            {(TYPE_LABELS[a.type] || a.type).split(" ")[0][0]}{a.effectiveness > 0 ? "+" : a.effectiveness < 0 ? "-" : "="}
          </span>
        );
      })}
    </div>
  );
}

function HealthGauge({ health, objectives, timeBucket, multiActionCount }: { health: HealthScoreData; objectives?: ObjectiveScoresData; timeBucket?: string; multiActionCount?: number }) {
  const pct = Math.round(health.value * 100);
  const color = pct >= 80 ? "text-green-400" : pct >= 60 ? "text-yellow-400" : "text-red-400";
  const bgColor = pct >= 80 ? "bg-green-500/20" : pct >= 60 ? "bg-yellow-500/20" : "bg-red-500/20";
  const TIcon = TREND_ICONS[health.trend] || Activity;
  const trendColor = health.trend === "improving" ? "text-green-400" : health.trend === "degrading" ? "text-red-400" : "text-muted-foreground";

  return (
    <div className={`p-3 rounded-lg ${bgColor} border border-border/20 space-y-2`}>
      <div className="flex items-center gap-3">
        <div className="text-center">
          <div className={`text-2xl font-bold font-mono ${color}`}>{pct}%</div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Здоровье</div>
        </div>
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-muted-foreground w-9">SR</span>
            <div className="flex-1 h-1.5 rounded-full bg-muted/20 overflow-hidden">
              <div className="h-full bg-green-500/60 rounded-full" style={{ width: `${health.sr_component * 100}%` }} />
            </div>
            <span className="font-mono w-8 text-right">{Math.round(health.sr_component * 100)}%</span>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-muted-foreground w-9">Lat</span>
            <div className="flex-1 h-1.5 rounded-full bg-muted/20 overflow-hidden">
              <div className="h-full bg-blue-500/60 rounded-full" style={{ width: `${health.latency_component * 100}%` }} />
            </div>
            <span className="font-mono w-8 text-right">{Math.round(health.latency_component * 100)}%</span>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-muted-foreground w-9">WS</span>
            <div className="flex-1 h-1.5 rounded-full bg-muted/20 overflow-hidden">
              <div className="h-full bg-violet-500/60 rounded-full" style={{ width: `${health.ws_component * 100}%` }} />
            </div>
            <span className="font-mono w-8 text-right">{Math.round(health.ws_component * 100)}%</span>
          </div>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <TIcon className={`w-4 h-4 ${trendColor}`} />
          <span className={`text-[9px] ${trendColor}`}>{health.trend === "improving" ? "Рост" : health.trend === "degrading" ? "Спад" : "Стабильно"}</span>
          {timeBucket && (
            <span className="text-[9px] text-muted-foreground mt-1">{TIME_ICONS[timeBucket]} {TIME_LABELS[timeBucket]}</span>
          )}
          {(multiActionCount || 0) > 0 && (
            <span className="text-[9px] text-red-400 mt-0.5">{multiActionCount} multi</span>
          )}
        </div>
      </div>
      {objectives && <ObjectiveBars objectives={objectives} label="Цели оптимизации" />}
    </div>
  );
}

function RevenueAIProdPanel({ data, onToggle, onShadowToggle }: { data: { enabled: boolean; mode: string; surge_multiplier: number; demand_supply_ratio: number; revenue_per_minute: number; driver_utilization_pct: number; total_revenue: number; completed_rides: number; logs: string[]; safety?: { shadow_mode: boolean; kill_switch_triggered: boolean; kill_switch_reason: string; safety_blocks: number; fairness_applied: number; diversity_injected: number; starved_drivers: number; surge_rate_limited: boolean; shadow_logs: string[] } } | null; onToggle: (enabled: boolean) => void; onShadowToggle: (enabled: boolean) => void }) {
  const [expanded, setExpanded] = useState(true);
  const [showLogs, setShowLogs] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [showShadowLogs, setShowShadowLogs] = useState(false);

  const d = data || { enabled: false, mode: "conservative", surge_multiplier: 1, demand_supply_ratio: 0, revenue_per_minute: 0, driver_utilization_pct: 0, total_revenue: 0, completed_rides: 0, logs: [] };
  const s = d.safety || { shadow_mode: false, kill_switch_triggered: false, kill_switch_reason: "", safety_blocks: 0, fairness_applied: 0, diversity_injected: 0, starved_drivers: 0, surge_rate_limited: false, shadow_logs: [] };

  const formatPrice = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return String(v);
  };

  const modeColors: Record<string, string> = {
    aggressive: "text-red-400",
    conservative: "text-blue-400",
    surge_heavy: "text-amber-400",
  };

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <span className="text-green-400">$</span> Revenue AI — Production
            <span className={`text-xs px-1.5 py-0.5 rounded ${d.enabled ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>{d.enabled ? "ACTIVE" : "OFF"}</span>
            {s.shadow_mode && <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400">SHADOW</span>}
            {s.kill_switch_triggered && <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 animate-pulse">KILL SWITCH</span>}
            {s.surge_rate_limited && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">SURGE LIMITED</span>}
          </CardTitle>
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              className={`text-xs px-2 py-1 rounded ${s.shadow_mode ? "bg-violet-500/10 text-violet-400 hover:bg-violet-500/20" : "bg-violet-500/5 text-violet-400/50 hover:bg-violet-500/10"}`}
              onClick={() => onShadowToggle(!s.shadow_mode)}
            >
              {s.shadow_mode ? "Exit Shadow" : "Shadow"}
            </button>
            <button
              className={`text-xs px-2 py-1 rounded ${d.enabled ? "bg-red-500/10 text-red-400 hover:bg-red-500/20" : "bg-green-500/10 text-green-400 hover:bg-green-500/20"}`}
              onClick={() => onToggle(!d.enabled)}
            >
              {d.enabled ? "Disable" : "Enable"}
            </button>
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-green-500/10 rounded-lg p-3">
              <div className="text-xs text-muted-foreground">Revenue/min</div>
              <div className="text-lg font-bold font-mono text-green-400">{formatPrice(d.revenue_per_minute)}</div>
            </div>
            <div className="bg-blue-500/10 rounded-lg p-3">
              <div className="text-xs text-muted-foreground">Rides</div>
              <div className="text-lg font-bold font-mono text-blue-400">{d.completed_rides}</div>
            </div>
            <div className="bg-amber-500/10 rounded-lg p-3">
              <div className="text-xs text-muted-foreground">Surge</div>
              <div className={`text-lg font-bold font-mono ${d.surge_multiplier > 1.05 ? "text-amber-400" : d.surge_multiplier < 0.95 ? "text-blue-400" : "text-white"}`}>{d.surge_multiplier.toFixed(2)}x</div>
            </div>
            <div className="bg-purple-500/10 rounded-lg p-3">
              <div className="text-xs text-muted-foreground">Utilization</div>
              <div className="text-lg font-bold font-mono text-purple-400">{d.driver_utilization_pct}%</div>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs flex-wrap">
            <span className="text-muted-foreground">Mode: <span className={`font-medium ${modeColors[d.mode] || "text-white"}`}>{d.mode}</span></span>
            <span className="text-muted-foreground">D/S Ratio: <span className="font-mono font-medium text-white">{d.demand_supply_ratio}</span></span>
            <span className="text-muted-foreground">Total: <span className="font-mono font-medium text-green-400">{formatPrice(d.total_revenue)} сум</span></span>
          </div>

          {s.kill_switch_triggered && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <div className="text-xs font-medium text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Kill Switch Triggered
              </div>
              <div className="text-xs text-red-300/80 mt-1 font-mono">{s.kill_switch_reason}</div>
            </div>
          )}

          <div>
            <button className="text-xs text-muted-foreground hover:text-white flex items-center gap-1" onClick={() => setShowSafety(!showSafety)}>
              {showSafety ? "▼" : "▶"} Safety Guard
            </button>
            {showSafety && (
              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="bg-emerald-500/10 rounded p-2">
                  <div className="text-[10px] text-muted-foreground">Fairness Applied</div>
                  <div className="text-sm font-bold font-mono text-emerald-400">{s.fairness_applied}</div>
                </div>
                <div className="bg-blue-500/10 rounded p-2">
                  <div className="text-[10px] text-muted-foreground">Diversity Injections</div>
                  <div className="text-sm font-bold font-mono text-blue-400">{s.diversity_injected}</div>
                </div>
                <div className="bg-amber-500/10 rounded p-2">
                  <div className="text-[10px] text-muted-foreground">Strategy Blocks</div>
                  <div className="text-sm font-bold font-mono text-amber-400">{s.safety_blocks}</div>
                </div>
                <div className="bg-red-500/10 rounded p-2">
                  <div className="text-[10px] text-muted-foreground">Starved Drivers</div>
                  <div className="text-sm font-bold font-mono text-red-400">{s.starved_drivers}</div>
                </div>
              </div>
            )}
          </div>

          {s.shadow_mode && s.shadow_logs.length > 0 && (
            <div>
              <button className="text-xs text-violet-400/80 hover:text-violet-400 flex items-center gap-1" onClick={() => setShowShadowLogs(!showShadowLogs)}>
                {showShadowLogs ? "▼" : "▶"} Shadow Logs ({s.shadow_logs.length})
              </button>
              {showShadowLogs && (
                <div className="mt-2 max-h-40 overflow-y-auto bg-violet-500/5 border border-violet-500/10 rounded p-2 space-y-0.5">
                  {s.shadow_logs.slice(-20).reverse().map((l, i) => (
                    <div key={i} className="text-xs font-mono text-violet-300/70">{l}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {d.logs.length > 0 && (
            <div>
              <button className="text-xs text-muted-foreground hover:text-white flex items-center gap-1" onClick={() => setShowLogs(!showLogs)}>
                {showLogs ? "▼" : "▶"} Logs ({d.logs.length})
              </button>
              {showLogs && (
                <div className="mt-2 max-h-40 overflow-y-auto bg-black/30 rounded p-2 space-y-0.5">
                  {d.logs.slice(-20).reverse().map((l, i) => (
                    <div key={i} className={`text-xs font-mono ${l.includes("[SAFETY]") ? "text-amber-400" : "text-muted-foreground"}`}>{l}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function OptimizerPanel({ data }: { data: OptimizationData | null }) {
  const [expanded, setExpanded] = useState(false);
  const [showDecisions, setShowDecisions] = useState(false);

  if (!data) return null;

  const hasData = data.total_actions > 0 || data.decisions.length > 0;

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-400" />
            Decision Engine
            {data.health && (
              <Badge className={`text-[10px] px-1.5 py-0 ${
                data.health.value >= 0.8 ? "bg-green-500/10 text-green-400 border-green-500/30"
                  : data.health.value >= 0.6 ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
                    : "bg-red-500/10 text-red-400 border-red-500/30"
              }`}>
                {Math.round(data.health.value * 100)}% HP
              </Badge>
            )}
            <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/30 text-[10px] px-1.5 py-0">
              Gen {data.generation}
            </Badge>
            {data.context_bucket && (
              <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-[10px] px-1.5 py-0">
                {CTX_LABELS[data.context_bucket] || data.context_bucket}
              </Badge>
            )}
            {data.time_bucket && (
              <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/30 text-[10px] px-1.5 py-0">
                {TIME_ICONS[data.time_bucket]} {TIME_LABELS[data.time_bucket] || data.time_bucket}
              </Badge>
            )}
            {data.total_explored > 0 && (
              <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/30 text-[10px] px-1.5 py-0">
                {data.total_explored} explore
              </Badge>
            )}
            {data.multi_action_count > 0 && (
              <Badge className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px] px-1.5 py-0">
                {data.multi_action_count} multi
              </Badge>
            )}
          </CardTitle>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0 space-y-3">
          {data.health && <HealthGauge health={data.health} objectives={data.objectives} timeBucket={data.time_bucket} multiActionCount={data.multi_action_count} />}

          {data.recent_actions && data.recent_actions.length > 0 && <RecentActionsList actions={data.recent_actions} />}

          {!hasData ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground justify-center">
              <Brain className="w-4 h-4 text-violet-400/50" />
              Система обучается... ожидаются данные
            </div>
          ) : (
            <>
              <div className="space-y-2.5">
                {data.scores.map(score => {
                  const Icon = RECOVERY_ICONS[score.type] || Shield;
                  const effColor = score.avg_effectiveness > 0.1 ? "text-green-400"
                    : score.avg_effectiveness < -0.05 ? "text-red-400" : "text-yellow-400";
                  const statusColor = score.enabled ? "bg-green-500" : "bg-red-500";
                  const cooldownRatio = score.current_cooldown_ms / score.base_cooldown_ms;

                  return (
                    <div key={score.type} className="p-3 rounded-lg bg-muted/10 border border-border/20 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
                        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium flex-1">{TYPE_LABELS[score.type] || score.type}</span>
                        <span className={`text-xs font-mono font-medium ${effColor}`}>
                          {score.avg_effectiveness >= 0 ? "+" : ""}{score.avg_effectiveness.toFixed(3)}
                        </span>
                        {!score.enabled && (
                          <Badge className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px] px-1 py-0">OFF</Badge>
                        )}
                      </div>

                      <EffectivenessBar value={score.avg_effectiveness} />

                      <div className="grid grid-cols-5 gap-1.5 text-[10px]">
                        <div>
                          <span className="text-muted-foreground">Uses:</span>
                          <span className="font-mono ml-1">{score.total_uses}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">OK/F:</span>
                          <span className="font-mono ml-1 text-green-400">{score.successful}</span>
                          <span className="text-muted-foreground">/</span>
                          <span className="font-mono text-red-400">{score.failed}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground">SR:</span>
                          <span className={`font-mono ${score.avg_sr_delta > 0 ? "text-green-400" : score.avg_sr_delta < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                            {score.avg_sr_delta > 0 ? "+" : ""}{score.avg_sr_delta.toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground">Lat:</span>
                          <span className={`font-mono ${score.avg_latency_delta > 0 ? "text-green-400" : score.avg_latency_delta < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                            {score.avg_latency_delta > 0 ? "-" : "+"}{Math.abs(score.avg_latency_delta).toFixed(0)}ms
                          </span>
                        </div>
                        {score.explored > 0 && (
                          <div className="flex items-center gap-1">
                            <Zap className="w-2.5 h-2.5 text-orange-400" />
                            <span className="font-mono text-orange-400">{score.explored}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Timer className="w-3 h-3" />
                          {Math.round(score.current_cooldown_ms / 1000)}s
                          {cooldownRatio < 0.95 && <ArrowDown className="w-2.5 h-2.5 text-green-400" />}
                          {cooldownRatio > 1.05 && <ArrowUp className="w-2.5 h-2.5 text-red-400" />}
                        </span>
                        {score.skipped > 0 && (
                          <span className="flex items-center gap-1">
                            <SkipForward className="w-3 h-3" />
                            {score.skipped}
                          </span>
                        )}
                        {score.context_scores && score.context_scores.length > 0 && (
                          <span className="flex items-center gap-1">
                            {score.context_scores.map(cs => (
                              <span key={cs.bucket} className="px-1 py-0 rounded bg-muted/20 text-[9px]" title={`${CTX_LABELS[cs.bucket]}: eff=${cs.avg_effectiveness.toFixed(3)}, uses=${cs.uses}`}>
                                {CTX_LABELS[cs.bucket]?.[0] || "?"}{cs.uses}
                              </span>
                            ))}
                          </span>
                        )}
                        {score.objective_impact && score.objective_impact.combined !== 0 && (
                          <span className="flex items-center gap-1 text-[9px]" title={`H:${score.objective_impact.health.toFixed(3)} C:${score.objective_impact.completion.toFixed(3)} E:${score.objective_impact.earnings.toFixed(3)}`}>
                            <span className="text-green-400">H{score.objective_impact.health > 0 ? "+" : ""}{(score.objective_impact.health * 100).toFixed(0)}</span>
                            <span className="text-blue-400">C{score.objective_impact.completion > 0 ? "+" : ""}{(score.objective_impact.completion * 100).toFixed(0)}</span>
                            <span className="text-yellow-400">E{score.objective_impact.earnings > 0 ? "+" : ""}{(score.objective_impact.earnings * 100).toFixed(0)}</span>
                          </span>
                        )}
                      </div>

                      {score.history.length > 0 && (
                        <div className="flex items-end gap-px h-6 mt-1">
                          {score.history.slice(-20).map((h, i) => {
                            const normalized = Math.max(0, Math.min(1, (h.effectiveness + 0.5) / 1));
                            const barH = Math.max(2, normalized * 24);
                            const color = h.effectiveness > 0.1 ? "bg-green-500/70"
                              : h.effectiveness < -0.05 ? "bg-red-500/70" : "bg-yellow-500/70";
                            return (
                              <div
                                key={i}
                                className={`flex-1 rounded-t-sm ${color} transition-all`}
                                style={{ height: `${barH}px` }}
                                title={`${h.effectiveness.toFixed(3)} | SR: ${h.sr_delta > 0 ? "+" : ""}${h.sr_delta}% | Lat: ${h.latency_delta > 0 ? "-" : "+"}${Math.abs(h.latency_delta)}ms${h.context ? ` | ${CTX_LABELS[h.context] || h.context}` : ""}`}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowDecisions(!showDecisions); }}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  {showDecisions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  Решения движка ({data.decisions.length})
                </button>
                {showDecisions && data.decisions.length > 0 && (
                  <div className="mt-1.5 space-y-1 max-h-48 overflow-y-auto pr-1">
                    {[...data.decisions].reverse().slice(0, 40).map(d => {
                      const DIcon = DECISION_ICONS[d.decision] || Brain;
                      const dColor = d.decision === "best_pick" ? "text-green-400"
                        : d.decision === "multi_action" ? "text-red-400"
                          : d.decision === "explore" ? "text-orange-400"
                            : d.decision === "repetition_penalty" ? "text-yellow-400"
                              : d.decision === "skip" ? "text-red-400"
                                : d.decision === "cooldown_adjusted" ? "text-blue-400" : "text-green-400";
                      return (
                        <div key={d.id} className={`px-2 py-1.5 rounded space-y-0.5 ${d.decision === "multi_action" ? "bg-red-500/5 border border-red-500/20" : "bg-muted/5"}`}>
                          <div className="flex items-center gap-2 text-[10px]">
                            <DIcon className={`w-3 h-3 shrink-0 ${dColor}`} />
                            <span className={`shrink-0 font-mono font-medium ${dColor}`}>{d.decision === "multi_action" ? "MULTI" : d.decision.toUpperCase()}</span>
                            <span className="text-muted-foreground shrink-0">{TYPE_LABELS[d.type] || d.type}</span>
                            {d.context && <span className="text-[9px] px-1 rounded bg-blue-500/10 text-blue-400">{CTX_LABELS[d.context] || d.context}</span>}
                            {d.time_context && <span className="text-[9px]">{TIME_ICONS[d.time_context]}</span>}
                            {d.health_at_time !== undefined && (
                              <span className="text-[9px] px-1 rounded bg-muted/20">{Math.round(d.health_at_time * 100)}% HP</span>
                            )}
                            {d.objectives && (
                              <span className={`text-[9px] px-1 rounded ${d.objectives.combined >= 0.7 ? "bg-green-500/10 text-green-400" : d.objectives.combined >= 0.5 ? "bg-yellow-500/10 text-yellow-400" : "bg-red-500/10 text-red-400"}`}>
                                OBJ {Math.round(d.objectives.combined * 100)}%
                              </span>
                            )}
                            <span className="flex-1" />
                            <span className="text-muted-foreground shrink-0">{new Date(d.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <div className="text-[9px] text-muted-foreground pl-5 truncate">{d.reason}</div>
                          {d.executed_actions && d.executed_actions.length > 0 && (
                            <div className="flex items-center gap-1.5 pl-5 text-[9px]">
                              <span className="text-red-400">Запущено:</span>
                              {d.executed_actions.map((a, ai) => (
                                <span key={ai} className="font-mono px-1 rounded bg-red-500/10 text-red-400">
                                  {TYPE_LABELS[a]?.split(" ")[0] || a}
                                </span>
                              ))}
                            </div>
                          )}
                          {d.candidates && d.candidates.length > 1 && (
                            <div className="flex items-center gap-1.5 pl-5 text-[9px]">
                              <span className="text-muted-foreground">Кандидаты:</span>
                              {d.candidates.map((c, ci) => (
                                <span key={ci} className={`font-mono px-1 rounded ${ci === 0 ? "bg-green-500/10 text-green-400" : "bg-muted/20 text-muted-foreground"}`}>
                                  {TYPE_LABELS[c.type]?.split(" ")[0] || c.type} {c.score.toFixed(2)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

const TIER_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  top: { bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/30", label: "Топ" },
  good: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30", label: "Хороший" },
  average: { bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/30", label: "Средний" },
  poor: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30", label: "Слабый" },
};

const TREND_PROFIT: Record<string, { icon: typeof TrendingUp; color: string; label: string }> = {
  growing: { icon: TrendingUp, color: "text-green-400", label: "Рост" },
  stable: { icon: Activity, color: "text-yellow-400", label: "Стабильно" },
  declining: { icon: TrendingDown, color: "text-red-400", label: "Спад" },
};

const DEMAND_TREND: Record<string, { color: string; icon: typeof TrendingUp }> = {
  rising: { color: "text-green-400", icon: TrendingUp },
  stable: { color: "text-yellow-400", icon: Activity },
  falling: { color: "text-red-400", icon: TrendingDown },
};

function ProfitPanel({ data }: { data: ProfitMetricsData | null }) {
  const [expanded, setExpanded] = useState(true);
  if (!data) return null;

  const trendInfo = TREND_PROFIT[data.trend] || TREND_PROFIT.stable;
  const TrendIcon = trendInfo.icon;

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-green-400" />
            Profit Optimization
            <Badge className={`text-[10px] px-1.5 py-0 ${data.trend === "growing" ? "bg-green-500/10 text-green-400 border-green-500/30" : data.trend === "declining" ? "bg-red-500/10 text-red-400 border-red-500/30" : "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"}`}>
              <TrendIcon className="w-3 h-3 mr-0.5 inline" />{trendInfo.label}
            </Badge>
            <Badge className="bg-green-500/10 text-green-400 border-green-500/30 text-[10px] px-1.5 py-0">
              {data.ridesPerHour} рейсов/ч
            </Badge>
          </CardTitle>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Выручка</div>
              <div className="text-lg font-bold text-green-400 font-mono">{(data.revenueProxy / 1000).toFixed(0)}K</div>
              <div className="text-[10px] text-muted-foreground">{data.avgRevenuePerRide > 0 ? `~${(data.avgRevenuePerRide / 1000).toFixed(0)}K/рейс` : "—"}</div>
            </div>
            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Утилизация</div>
              <div className={`text-lg font-bold font-mono ${data.driverUtilization >= 60 ? "text-green-400" : data.driverUtilization >= 30 ? "text-yellow-400" : "text-red-400"}`}>{data.driverUtilization}%</div>
              <div className="text-[10px] text-muted-foreground">{data.busyDrivers}/{data.activeDrivers} заняты</div>
            </div>
            <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Простой</div>
              <div className={`text-lg font-bold font-mono ${data.idleDriversPct <= 30 ? "text-green-400" : data.idleDriversPct <= 60 ? "text-yellow-400" : "text-red-400"}`}>{data.idleDriversPct}%</div>
              <div className="text-[10px] text-muted-foreground">{data.idleDrivers} водителей</div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-muted-foreground">Утилизация</span>
            <div className="flex-1 h-2 rounded-full bg-muted/20 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${data.driverUtilization >= 60 ? "bg-green-500/70" : data.driverUtilization >= 30 ? "bg-yellow-500/70" : "bg-red-500/70"}`} style={{ width: `${Math.min(100, data.driverUtilization)}%` }} />
            </div>
            <span className="font-mono w-10 text-right">{data.driverUtilization}%</span>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function DriverModelPanel({ drivers }: { drivers: DriverBehaviorData[] }) {
  const [expanded, setExpanded] = useState(false);

  if (!drivers || drivers.length === 0) return null;

  const tierCounts = drivers.reduce((acc, d) => {
    acc[d.tier] = (acc[d.tier] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-400" />
            Driver Behavior Model
            {Object.entries(tierCounts).map(([tier, count]) => {
              const tc = TIER_COLORS[tier] || TIER_COLORS.average;
              return (
                <Badge key={tier} className={`${tc.bg} ${tc.text} ${tc.border} text-[10px] px-1.5 py-0`}>
                  {tc.label} {count}
                </Badge>
              );
            })}
          </CardTitle>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0">
          <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {drivers.slice(0, 30).map(d => {
              const tc = TIER_COLORS[d.tier] || TIER_COLORS.average;
              return (
                <div key={d.driverId} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${tc.bg} border ${tc.border}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${d.tier === "top" ? "bg-green-500" : d.tier === "good" ? "bg-blue-500" : d.tier === "average" ? "bg-yellow-500" : "bg-red-500"}`} />
                  <span className="font-mono text-muted-foreground w-8">#{d.driverId}</span>
                  <span className="text-muted-foreground w-16 truncate">{d.city}</span>
                  <Badge className={`${tc.bg} ${tc.text} ${tc.border} text-[9px] px-1 py-0`}>{tc.label}</Badge>
                  <span className="flex-1" />
                  <span className="text-[10px] text-muted-foreground">Accept: <span className={d.acceptRate >= 70 ? "text-green-400" : d.acceptRate >= 40 ? "text-yellow-400" : "text-red-400"}>{d.acceptRate}%</span></span>
                  <span className="text-[10px] text-muted-foreground">Resp: <span className="font-mono">{d.avgResponseMs}ms</span></span>
                  <span className="text-[10px] text-muted-foreground">Score: <span className={`font-mono font-bold ${tc.text}`}>{d.score.toFixed(2)}</span></span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground flex-wrap">
            <span>Всего: {drivers.length}</span>
            {Object.entries(tierCounts).map(([tier, count]) => {
              const tc = TIER_COLORS[tier] || TIER_COLORS.average;
              return <span key={tier} className={tc.text}>{tc.label}: {count} ({Math.round(count / drivers.length * 100)}%)</span>;
            })}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function DemandPanel({ predictions }: { predictions: DemandPredictionData[] }) {
  const [expanded, setExpanded] = useState(false);

  if (!predictions || predictions.length === 0) return null;

  const hotspots = predictions.filter(p => p.hotspot);

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Zap className="w-4 h-4 text-orange-400" />
            Demand Prediction
            {hotspots.length > 0 && (
              <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/30 text-[10px] px-1.5 py-0 animate-pulse">
                {hotspots.length} hotspot{hotspots.length > 1 ? "s" : ""}
              </Badge>
            )}
            <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-[10px] px-1.5 py-0">
              {predictions.length} коридоров
            </Badge>
          </CardTitle>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0">
          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {predictions.map(p => {
              const dt = DEMAND_TREND[p.trend] || DEMAND_TREND.stable;
              const DTIcon = dt.icon;
              return (
                <div key={p.corridor} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border ${p.hotspot ? "bg-orange-500/10 border-orange-500/20" : "bg-muted/10 border-border/20"}`}>
                  {p.hotspot && <Zap className="w-3 h-3 text-orange-400 shrink-0" />}
                  <span className="font-medium w-40 truncate">{p.corridor}</span>
                  <span className="flex-1" />
                  <span className="text-[10px] text-muted-foreground">Сейчас: <span className="font-mono">{p.currentDemand}</span></span>
                  <span className="text-[10px] text-muted-foreground">Прогноз: <span className={`font-mono font-bold ${p.predictedDemand >= 3 ? "text-orange-400" : "text-muted-foreground"}`}>{p.predictedDemand.toFixed(1)}</span></span>
                  <DTIcon className={`w-3 h-3 ${dt.color}`} />
                  <span className="text-[10px] text-muted-foreground">Conf: <span className="font-mono">{Math.round(p.confidence * 100)}%</span></span>
                  <span className="text-[10px] text-muted-foreground">Time: <span className="font-mono">{p.timeFactor.toFixed(2)}</span></span>
                </div>
              );
            })}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function GenerationPanel({ snapshots, bestGeneration, onRollback }: { snapshots: GenerationSnapshotData[]; bestGeneration: number; onRollback: (gen: number) => void }) {
  const [expanded, setExpanded] = useState(false);

  if (!snapshots || snapshots.length === 0) return null;

  const sorted = [...snapshots].reverse();
  const current = sorted[0];

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-400" />
            Generation Comparison
            {current && (
              <Badge className={`text-[10px] px-1.5 py-0 ${current.score >= 0.6 ? "bg-green-500/10 text-green-400 border-green-500/30" : current.score >= 0.4 ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" : "bg-red-500/10 text-red-400 border-red-500/30"}`}>
                Score {current.score.toFixed(3)}
              </Badge>
            )}
            {bestGeneration > 0 && (
              <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/30 text-[10px] px-1.5 py-0">
                Best: Gen {bestGeneration}
              </Badge>
            )}
            <Badge className="bg-muted text-muted-foreground text-[10px] px-1.5 py-0">
              {snapshots.length} snapshots
            </Badge>
          </CardTitle>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0">
          <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {sorted.map(s => {
              const isBest = s.generation === bestGeneration;
              const scorePct = Math.round(s.score * 100);
              return (
                <div key={s.generation} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border ${isBest ? "bg-violet-500/10 border-violet-500/30" : "bg-muted/10 border-border/20"}`}>
                  <span className={`font-mono font-bold w-10 ${isBest ? "text-violet-400" : "text-muted-foreground"}`}>G{s.generation}</span>
                  {isBest && <span className="text-[9px] text-violet-400 font-bold">★</span>}
                  <div className="flex-1 h-1.5 rounded-full bg-muted/20 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${scorePct >= 60 ? "bg-green-500/70" : scorePct >= 40 ? "bg-yellow-500/70" : "bg-red-500/70"}`} style={{ width: `${scorePct}%` }} />
                  </div>
                  <span className={`font-mono w-10 text-right ${scorePct >= 60 ? "text-green-400" : scorePct >= 40 ? "text-yellow-400" : "text-red-400"}`}>{scorePct}%</span>
                  <span className="text-[10px] text-muted-foreground">HP:{Math.round(s.health * 100)}</span>
                  <span className="text-[10px] text-muted-foreground">Util:{s.profitMetrics.driverUtilization}%</span>
                  <span className="text-[10px] text-muted-foreground">Eff:{s.avgEffectiveness >= 0 ? "+" : ""}{s.avgEffectiveness.toFixed(2)}</span>
                  {!isBest && s.generation !== sorted[0]?.generation && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[9px] h-5 px-1.5 border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                      onClick={(e) => { e.stopPropagation(); onRollback(s.generation); }}
                    >
                      Rollback
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {sorted.length >= 2 && (() => {
            const curr = sorted[0];
            const prev = sorted[1];
            const scoreDelta = curr.score - prev.score;
            const healthDelta = curr.health - prev.health;
            return (
              <div className="mt-2 p-2 rounded-lg bg-muted/10 border border-border/20">
                <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Gen {prev.generation} → Gen {curr.generation}</div>
                <div className="flex items-center gap-4 text-[10px]">
                  <span className={scoreDelta >= 0 ? "text-green-400" : "text-red-400"}>
                    Score: {scoreDelta >= 0 ? "+" : ""}{scoreDelta.toFixed(3)}
                  </span>
                  <span className={healthDelta >= 0 ? "text-green-400" : "text-red-400"}>
                    HP: {healthDelta >= 0 ? "+" : ""}{(healthDelta * 100).toFixed(0)}%
                  </span>
                  <span className="text-muted-foreground">
                    Actions: {curr.totalActions} ({curr.totalEffective} eff)
                  </span>
                </div>
              </div>
            );
          })()}
        </CardContent>
      )}
    </Card>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  zone,
}: {
  icon: any;
  label: string;
  value: string | number;
  sub?: string;
  zone?: Zone;
}) {
  const z = zone || "green";
  const zc = ZONE_COLORS[z];

  return (
    <Card className="border-border/40 relative overflow-hidden">
      <div className="absolute inset-0 opacity-30" style={{ background: `radial-gradient(ellipse at bottom right, ${zc.fill}, transparent 70%)` }} />
      <CardContent className="p-4 relative">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: zc.fill, color: zc.stroke }}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold leading-tight" style={{ color: zc.stroke }}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
        </div>
        <div className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ backgroundColor: zc.stroke, filter: zc.glow }} />
      </CardContent>
    </Card>
  );
}

function LineChart({
  points,
  dataKey,
  getZone,
  height = 140,
  unit = "",
  thresholds,
}: {
  points: TimePoint[];
  dataKey: keyof TimePoint;
  getZone: (v: number) => Zone;
  height?: number;
  unit?: string;
  thresholds?: { warning: number; critical: number };
}) {
  const W = 600;
  const H = height;
  const PAD_L = 45;
  const PAD_R = 10;
  const PAD_T = 10;
  const PAD_B = 25;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        <div className="text-center">
          <Activity className="w-6 h-6 mx-auto mb-2 opacity-30" />
          Ожидание данных...
        </div>
      </div>
    );
  }

  const values = points.map(p => p[dataKey] as number);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = (rawMax - rawMin) * 0.15 || 10;
  const min = Math.max(0, rawMin - pad);
  const max = rawMax + pad;
  const range = max - min || 1;

  const toX = (i: number) => PAD_L + (i / (BUFFER_SIZE - 1)) * chartW;
  const toY = (v: number) => PAD_T + chartH - ((v - min) / range) * chartH;

  const offset = BUFFER_SIZE - points.length;
  const pathD = points.map((p, i) => {
    const x = toX(i + offset);
    const y = toY(p[dataKey] as number);
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const areaD = pathD + ` L ${toX(points.length - 1 + offset).toFixed(1)},${(PAD_T + chartH).toFixed(1)} L ${toX(offset).toFixed(1)},${(PAD_T + chartH).toFixed(1)} Z`;

  const lastVal = values[values.length - 1];
  const zone = getZone(lastVal);
  const zc = ZONE_COLORS[zone];

  const yTicks = 5;
  const yLines = Array.from({ length: yTicks }, (_, i) => {
    const v = min + (range / (yTicks - 1)) * i;
    return { v, y: toY(v) };
  });

  const xLabels: { x: number; label: string }[] = [];
  if (points.length > 1) {
    const indices = [0, Math.floor(points.length / 2), points.length - 1];
    for (const idx of indices) {
      const sec = points[idx].second;
      xLabels.push({ x: toX(idx + offset), label: `${sec}s` });
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={`grad-${dataKey}-${zone}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={zc.stroke} stopOpacity="0.2" />
          <stop offset="100%" stopColor={zc.stroke} stopOpacity="0" />
        </linearGradient>
        <filter id={`glow-${dataKey}`}>
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {yLines.map((yl, i) => (
        <g key={i}>
          <line x1={PAD_L} y1={yl.y} x2={W - PAD_R} y2={yl.y} stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.5" />
          <text x={PAD_L - 5} y={yl.y + 3} textAnchor="end" fill="currentColor" fillOpacity="0.35" fontSize="9" fontFamily="monospace">
            {Math.round(yl.v)}{unit}
          </text>
        </g>
      ))}

      {thresholds && (
        <>
          <line x1={PAD_L} y1={toY(thresholds.warning)} x2={W - PAD_R} y2={toY(thresholds.warning)} stroke="#eab308" strokeOpacity="0.3" strokeWidth="0.8" strokeDasharray="4 3" />
          <line x1={PAD_L} y1={toY(thresholds.critical)} x2={W - PAD_R} y2={toY(thresholds.critical)} stroke="#ef4444" strokeOpacity="0.3" strokeWidth="0.8" strokeDasharray="4 3" />
        </>
      )}

      {xLabels.map((xl, i) => (
        <text key={i} x={xl.x} y={H - 5} textAnchor="middle" fill="currentColor" fillOpacity="0.35" fontSize="9" fontFamily="monospace">
          {xl.label}
        </text>
      ))}

      <path d={areaD} fill={`url(#grad-${dataKey}-${zone})`} />
      <path d={pathD} fill="none" stroke={zc.stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" filter={`url(#glow-${dataKey})`} />

      <circle cx={toX(points.length - 1 + offset)} cy={toY(lastVal)} r="4" fill={zc.stroke} filter={`url(#glow-${dataKey})`} />
      <circle cx={toX(points.length - 1 + offset)} cy={toY(lastVal)} r="7" fill="none" stroke={zc.stroke} strokeOpacity="0.3" strokeWidth="1.5">
        <animate attributeName="r" values="5;9;5" dur="2s" repeatCount="indefinite" />
        <animate attributeName="stroke-opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
      </circle>

      <rect x={toX(points.length - 1 + offset) - 25} y={toY(lastVal) - 22} width="50" height="16" rx="4" fill="rgba(0,0,0,0.7)" stroke={zc.stroke} strokeWidth="0.5" />
      <text x={toX(points.length - 1 + offset)} y={toY(lastVal) - 10} textAnchor="middle" fill={zc.stroke} fontSize="9" fontWeight="bold" fontFamily="monospace">
        {lastVal}{unit}
      </text>
    </svg>
  );
}

function BarChart({ points, height = 140 }: { points: TimePoint[]; height?: number }) {
  const W = 600;
  const H = height;
  const PAD_L = 45;
  const PAD_R = 10;
  const PAD_T = 10;
  const PAD_B = 25;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        <div className="text-center">
          <BarChart3 className="w-6 h-6 mx-auto mb-2 opacity-30" />
          Ожидание данных...
        </div>
      </div>
    );
  }

  const values = points.map(p => p.rides_per_minute);
  const maxVal = Math.max(...values, 1);
  const barGap = 1;
  const totalBars = BUFFER_SIZE;
  const barW = Math.max(1, (chartW - barGap * totalBars) / totalBars);
  const offset = totalBars - points.length;

  const yTicks = 4;
  const yLines = Array.from({ length: yTicks }, (_, i) => {
    const v = (maxVal / (yTicks - 1)) * i;
    const y = PAD_T + chartH - (v / maxVal) * chartH;
    return { v, y };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      {yLines.map((yl, i) => (
        <g key={i}>
          <line x1={PAD_L} y1={yl.y} x2={W - PAD_R} y2={yl.y} stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.5" />
          <text x={PAD_L - 5} y={yl.y + 3} textAnchor="end" fill="currentColor" fillOpacity="0.35" fontSize="9" fontFamily="monospace">
            {Math.round(yl.v)}
          </text>
        </g>
      ))}

      {points.map((p, i) => {
        const v = p.rides_per_minute;
        const barH = (v / maxVal) * chartH;
        const x = PAD_L + (i + offset) * (barW + barGap);
        const y = PAD_T + chartH - barH;
        const zone = getRpmZone(v, maxVal);
        const zc = ZONE_COLORS[zone];
        const isLast = i === points.length - 1;

        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={Math.max(0, barH)} fill={zc.stroke} fillOpacity={isLast ? 0.9 : 0.5} rx="1" />
            {isLast && v > 0 && (
              <>
                <rect x={x - 5} y={y - 18} width={barW + 10} height="14" rx="3" fill="rgba(0,0,0,0.7)" stroke={zc.stroke} strokeWidth="0.5" />
                <text x={x + barW / 2} y={y - 8} textAnchor="middle" fill={zc.stroke} fontSize="8" fontWeight="bold" fontFamily="monospace">{v}</text>
              </>
            )}
          </g>
        );
      })}

      {points.length > 1 && (
        <>
          <text x={PAD_L + offset * (barW + barGap) + barW / 2} y={H - 5} textAnchor="middle" fill="currentColor" fillOpacity="0.35" fontSize="9" fontFamily="monospace">{points[0].second}s</text>
          <text x={PAD_L + (points.length - 1 + offset) * (barW + barGap) + barW / 2} y={H - 5} textAnchor="middle" fill="currentColor" fillOpacity="0.35" fontSize="9" fontFamily="monospace">{points[points.length - 1].second}s</text>
        </>
      )}
    </svg>
  );
}

function ZoneLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-green-500" /><span>Норма</span></div>
      <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-yellow-500" /><span>Предупреждение</span></div>
      <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-red-500" /><span>Критично</span></div>
    </div>
  );
}

function HistoryTable({ history }: { history: HistoryEntry[] }) {
  const recent = history.slice(-10).reverse();
  if (recent.length === 0) return <p className="text-sm text-muted-foreground text-center py-6">Нет данных</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/40 text-muted-foreground text-left">
            <th className="py-2 px-2 font-medium">Дата</th>
            <th className="py-2 px-2 font-medium text-right">Baseline</th>
            <th className="py-2 px-2 font-medium text-right">Chaos</th>
            <th className="py-2 px-2 font-medium text-right">Avg ms</th>
            <th className="py-2 px-2 font-medium text-right">Ошибки</th>
            <th className="py-2 px-2 font-medium text-center">Вердикт</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((h, i) => {
            const date = h.timestamp.replace("T", " ").slice(0, 16);
            const isPassed = h.verdict === "PASSED";
            return (
              <tr key={i} className="border-b border-border/20 hover:bg-muted/30 transition-colors">
                <td className="py-2 px-2 text-xs text-muted-foreground whitespace-nowrap">{date}</td>
                <td className="py-2 px-2 text-right font-mono">
                  <span className={h.baseline_success_rate >= 90 ? "text-green-400" : h.baseline_success_rate >= 70 ? "text-yellow-400" : "text-red-400"}>{h.baseline_success_rate}%</span>
                </td>
                <td className="py-2 px-2 text-right font-mono">
                  <span className={h.chaos_success_rate >= 90 ? "text-green-400" : h.chaos_success_rate >= 70 ? "text-yellow-400" : "text-red-400"}>{h.chaos_success_rate}%</span>
                </td>
                <td className="py-2 px-2 text-right font-mono">
                  <span className={h.baseline_avg_response <= 300 ? "text-green-400" : h.baseline_avg_response <= 800 ? "text-yellow-400" : "text-red-400"}>{h.baseline_avg_response}</span>
                </td>
                <td className="py-2 px-2 text-right font-mono">
                  {h.baseline_errors + h.chaos_errors > 0 ? <span className="text-yellow-400">{h.baseline_errors + h.chaos_errors}</span> : <span className="text-green-400">0</span>}
                </td>
                <td className="py-2 px-2 text-center">
                  <Badge variant={isPassed ? "default" : "destructive"} className={`text-xs ${isPassed ? "bg-green-500/10 text-green-400 border-green-500/30" : ""}`}>{h.verdict}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RegressionIndicator({ history }: { history: HistoryEntry[] }) {
  if (history.length < 2) return null;
  const curr = history[history.length - 1];
  const prev = history[history.length - 2];
  const baselineDrop = curr.baseline_success_rate < prev.baseline_success_rate;
  const chaosDrop = curr.chaos_success_rate < prev.chaos_success_rate;
  const avgSpike = curr.baseline_avg_response > prev.baseline_avg_response * 1.5;

  if (!baselineDrop && !chaosDrop && !avgSpike) {
    return <div className="flex items-center gap-2 text-sm text-green-400"><TrendingUp className="w-4 h-4" />Стабильная работа</div>;
  }

  return (
    <div className="space-y-1">
      {baselineDrop && <div className="flex items-center gap-2 text-sm text-red-400"><TrendingDown className="w-4 h-4" />Baseline: {prev.baseline_success_rate}% → {curr.baseline_success_rate}%</div>}
      {chaosDrop && <div className="flex items-center gap-2 text-sm text-red-400"><TrendingDown className="w-4 h-4" />Chaos: {prev.chaos_success_rate}% → {curr.chaos_success_rate}%</div>}
      {avgSpike && <div className="flex items-center gap-2 text-sm text-yellow-400"><AlertTriangle className="w-4 h-4" />Латентность: {prev.baseline_avg_response}ms → {curr.baseline_avg_response}ms</div>}
    </div>
  );
}

function PhaseTimeline({ phase, elapsed }: { phase: string; elapsed: number }) {
  const phases = ["setup", "baseline", "chaos", "completed"];
  const activeIdx = phases.indexOf(phase);

  return (
    <div className="flex items-center gap-1">
      {phases.map((p, i) => {
        const isActive = i === activeIdx;
        const isDone = i < activeIdx;
        const color = isDone ? "#22c55e" : isActive ? "#3b82f6" : "rgba(255,255,255,0.1)";
        return (
          <div key={p} className="flex items-center gap-1">
            <div className="flex flex-col items-center">
              <div className={`w-3 h-3 rounded-full border-2 ${isActive ? "animate-pulse" : ""}`} style={{ borderColor: color, backgroundColor: isDone ? color : isActive ? color : "transparent" }} />
              <span className={`text-[10px] mt-0.5 ${isActive ? "text-blue-400 font-medium" : isDone ? "text-green-400" : "text-muted-foreground"}`}>{p}</span>
            </div>
            {i < phases.length - 1 && <div className="w-8 h-0.5 mb-3 rounded" style={{ backgroundColor: isDone ? "#22c55e" : "rgba(255,255,255,0.1)" }} />}
          </div>
        );
      })}
      {activeIdx > 0 && activeIdx < 3 && <span className="text-xs text-muted-foreground ml-2 font-mono">{elapsed}s</span>}
    </div>
  );
}

export default function StressMonitor() {
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [timeline, setTimeline] = useState<TimePoint[]>([]);
  const [alerts, setAlerts] = useState<StressAlert[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [recoveryActions, setRecoveryActions] = useState<RecoveryAction[]>([]);
  const [loadMultiplier, setLoadMultiplier] = useState(1);
  const [optimizerData, setOptimizerData] = useState<OptimizationData | null>(null);
  const [effectiveness, setEffectiveness] = useState<Record<string, EffectivenessEntry>>({});
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [metaOptimizer, setMetaOptimizer] = useState<MetaOptimizerData | null>(null);
  const [revenueAI, setRevenueAI] = useState<RevenueAIData | null>(null);
  const [revenueAIProd, setRevenueAIProd] = useState<{ enabled: boolean; mode: string; surge_multiplier: number; demand_supply_ratio: number; revenue_per_minute: number; driver_utilization_pct: number; total_revenue: number; completed_rides: number; logs: string[]; safety?: { shadow_mode: boolean; kill_switch_triggered: boolean; kill_switch_reason: string; safety_blocks: number; fairness_applied: number; diversity_injected: number; starved_drivers: number; surge_rate_limited: boolean; shadow_logs: string[] } } | null>(null);
  const [popupAlert, setPopupAlert] = useState<StressAlert | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [error, setError] = useState(false);
  const timelineRef = useRef<TimePoint[]>([]);
  const secondCounter = useRef(0);
  const prevRunning = useRef(false);
  const lastAlertId = useRef("");
  const popupTimeout = useRef<ReturnType<typeof setTimeout>>();

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/metrics/stress`);
      if (!res.ok) throw new Error();
      const data: LiveMetrics = await res.json();
      setMetrics(data);
      setError(false);

      if (data.running && !prevRunning.current) {
        timelineRef.current = [];
        secondCounter.current = 0;
        setAlerts([]);
        setIncidents([]);
        setRecoveryActions([]);
        setLoadMultiplier(1);
        lastAlertId.current = "";
      }
      prevRunning.current = data.running;

      if (data.running) {
        secondCounter.current++;
        const point: TimePoint = {
          t: Date.now(),
          second: secondCounter.current,
          success_rate: data.success_rate,
          avg_response: data.avg_response_time,
          rides_per_minute: data.rides_per_minute,
          rides: data.rides_created,
          accepted: data.accepted,
          failed: data.failed,
          ws_connections: data.ws_connections,
        };
        const updated = [...timelineRef.current, point].slice(-BUFFER_SIZE);
        timelineRef.current = updated;
        setTimeline(updated);
      }
    } catch {
      setError(true);
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const sinceParam = lastAlertId.current ? `?since=${lastAlertId.current}` : "";
      const res = await fetch(`${BASE_URL}/api/metrics/stress/alerts${sinceParam}`);
      if (!res.ok) return;
      const newAlerts: StressAlert[] = await res.json();

      if (newAlerts.length > 0) {
        setAlerts(prev => {
          const existingIds = new Set(prev.map(a => a.id));
          const fresh = newAlerts.filter(a => !existingIds.has(a.id));
          if (fresh.length === 0) return prev;

          const lvl = (a: StressAlert) => a.level || a.severity;
          const mostSevere = fresh.find(a => lvl(a) === "emergency") || fresh.find(a => lvl(a) === "critical") || fresh.find(a => a.type !== "recovery") || fresh[0];
          setPopupAlert(mostSevere);
          if (soundEnabled) playAlertSound(lvl(mostSevere));

          if (popupTimeout.current) clearTimeout(popupTimeout.current);
          popupTimeout.current = setTimeout(() => setPopupAlert(null), 8000);

          return [...prev, ...fresh];
        });
        lastAlertId.current = newAlerts[newAlerts.length - 1].id;
      }
    } catch {}
  }, [soundEnabled]);

  const fetchRecovery = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/metrics/stress/recovery`);
      if (!res.ok) return;
      const data = await res.json();
      const allActions: RecoveryAction[] = data.actions || [];
      setLoadMultiplier(data.multiplier || 1);
      setRecoveryActions(allActions);
    } catch {}
  }, []);

  const fetchOptimizer = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/metrics/stress/optimizer`);
      if (!res.ok) return;
      setOptimizerData(await res.json());
    } catch {}
  }, []);

  const fetchIncidents = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/metrics/stress/incidents`);
      if (!res.ok) return;
      setIncidents(await res.json());
    } catch {}
  }, []);

  const fetchEffectiveness = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/metrics/stress/effectiveness`);
      if (!res.ok) return;
      setEffectiveness(await res.json());
    } catch {}
  }, []);

  const fetchAiStatus = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/metrics/stress/ai-status`);
      if (!res.ok) return;
      setAiStatus(await res.json());
    } catch {}
    try {
      const res = await fetch(`${BASE_URL}/api/metrics/stress/meta-optimizer`);
      if (!res.ok) return;
      setMetaOptimizer(await res.json());
    } catch {}
    try {
      const res = await fetch(`${BASE_URL}/api/metrics/stress/revenue-ai`);
      if (!res.ok) return;
      setRevenueAI(await res.json());
    } catch {}
    try {
      const res = await fetch(`${BASE_URL}/api/metrics/stress/revenue-ai-prod`);
      if (res.ok) setRevenueAIProd(await res.json());
    } catch {}
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/metrics/stress/history`);
      if (res.ok) setHistory(await res.json());
    } catch {}
  }, []);

  const ackAlert = useCallback(async (id: string) => {
    try {
      await fetch(`${BASE_URL}/api/metrics/stress/alerts/${id}/ack`, { method: "POST" });
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a));
      if (popupAlert?.id === id) setPopupAlert(null);
    } catch {}
  }, [popupAlert]);

  const ackAll = useCallback(async () => {
    try {
      await fetch(`${BASE_URL}/api/metrics/stress/alerts/ack-all`, { method: "POST" });
      setAlerts(prev => prev.map(a => ({ ...a, acknowledged: true })));
      setPopupAlert(null);
    } catch {}
  }, []);

  useEffect(() => {
    fetchMetrics();
    fetchAlerts();
    fetchIncidents();
    fetchRecovery();
    fetchOptimizer();
    fetchHistory();
    fetchEffectiveness();
    fetchAiStatus();
    const metricsInterval = setInterval(fetchMetrics, 15000);
    const alertsInterval = setInterval(fetchAlerts, 15000);
    const incidentsInterval = setInterval(fetchIncidents, 15000);
    const recoveryInterval = setInterval(fetchRecovery, 15000);
    const optimizerInterval = setInterval(fetchOptimizer, 15000);
    const historyInterval = setInterval(fetchHistory, 15000);
    const effectivenessInterval = setInterval(fetchEffectiveness, 15000);
    const aiStatusInterval = setInterval(fetchAiStatus, 15000);
    return () => {
      clearInterval(metricsInterval);
      clearInterval(alertsInterval);
      clearInterval(incidentsInterval);
      clearInterval(recoveryInterval);
      clearInterval(optimizerInterval);
      clearInterval(historyInterval);
      clearInterval(effectivenessInterval);
      clearInterval(aiStatusInterval);
      if (popupTimeout.current) clearTimeout(popupTimeout.current);
    };
  }, [fetchMetrics, fetchAlerts, fetchIncidents, fetchRecovery, fetchOptimizer, fetchHistory, fetchEffectiveness, fetchAiStatus]);

  const rollbackGen = useCallback(async (generation: number) => {
    try {
      const res = await fetch(`${BASE_URL}/api/metrics/stress/optimizer/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generation }),
      });
      if (res.ok) {
        fetchOptimizer();
      }
    } catch {}
  }, [fetchOptimizer]);

  const successZone = useMemo(() => metrics ? getSuccessZone(metrics.success_rate) : "green" as Zone, [metrics?.success_rate]);
  const latencyZone = useMemo(() => metrics ? getLatencyZone(metrics.avg_response_time) : "green" as Zone, [metrics?.avg_response_time]);
  const unackedCount = alerts.filter(a => !a.acknowledged).length;

  return (
    <DispatcherLayout>
      {popupAlert && (
        <AlertPopup
          alert={popupAlert}
          onDismiss={() => setPopupAlert(null)}
          onAck={ackAlert}
        />
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Gauge className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight">Стресс-монитор</h1>
              <p className="text-xs text-muted-foreground">Реальное время · 60с буфер · автотревоги</p>
            </div>
            {metrics && <StatusBadge running={metrics.running} phase={metrics.current_phase} />}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                soundEnabled ? "bg-blue-500/10 text-blue-400" : "bg-muted/30 text-muted-foreground"
              }`}
              title={soundEnabled ? "Отключить звук" : "Включить звук"}
            >
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              {soundEnabled ? "Звук вкл" : "Звук выкл"}
            </button>
            {unackedCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium">
                <Bell className="w-3.5 h-3.5 animate-bounce" />
                {unackedCount}
              </div>
            )}
            <ZoneLegend />
            {error && <div className="flex items-center gap-2 text-sm text-red-400"><WifiOff className="w-4 h-4" />Нет соединения</div>}
            {!error && metrics && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Wifi className="w-3 h-3 text-green-400" />Live</div>}
          </div>
        </div>

        {metrics?.running && <PhaseTimeline phase={metrics.current_phase} elapsed={metrics.phase_elapsed_s} />}

        <CriticalBanner alerts={alerts} onAckAll={ackAll} />

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard icon={Zap} label="Success Rate" value={metrics ? `${metrics.success_rate}%` : "—"} zone={successZone} />
          <MetricCard icon={Activity} label="Рейсов создано" value={metrics?.rides_created ?? "—"} sub={metrics ? `${metrics.accepted} / ${metrics.failed} fail` : undefined} zone="green" />
          <MetricCard icon={Timer} label="Rides/min" value={metrics?.rides_per_minute ?? "—"} zone="green" />
          <MetricCard icon={Clock} label="Avg Latency" value={metrics ? `${metrics.avg_response_time}ms` : "—"} zone={latencyZone} />
          <MetricCard icon={Users} label="WS Connections" value={metrics?.ws_connections ?? "—"} zone="green" />
          <MetricCard icon={metrics?.ws_errors ? AlertTriangle : CheckCircle2} label="Ошибки" value={(metrics?.ws_errors ?? 0) + (metrics?.critical_bugs ?? 0)} sub={metrics?.critical_bugs ? `${metrics.critical_bugs} баг` : undefined} zone={metrics && (metrics.ws_errors > 0 || metrics.critical_bugs > 0) ? "red" : "green"} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="border-border/40">
            <CardHeader className="pb-1">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Zap className="w-4 h-4" style={{ color: ZONE_COLORS[successZone].stroke }} />Success Rate
                </CardTitle>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Зоны:</span>
                  <span className="text-green-400">≥90%</span>
                  <span className="text-yellow-400">70-89%</span>
                  <span className="text-red-400">&lt;70%</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <LineChart points={timeline} dataKey="success_rate" getZone={getSuccessZone} unit="%" thresholds={{ warning: 90, critical: 70 }} />
            </CardContent>
          </Card>

          <Card className="border-border/40">
            <CardHeader className="pb-1">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Clock className="w-4 h-4" style={{ color: ZONE_COLORS[latencyZone].stroke }} />Latency (Response Time)
                </CardTitle>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Зоны:</span>
                  <span className="text-green-400">≤300ms</span>
                  <span className="text-yellow-400">301-800ms</span>
                  <span className="text-red-400">&gt;800ms</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <LineChart points={timeline} dataKey="avg_response" getZone={getLatencyZone} unit="ms" thresholds={{ warning: 300, critical: 800 }} />
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/40">
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-cyan-400" />Rides per Minute (Throughput)
              </CardTitle>
              <div className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">Каждый столбец = 1 секунда</span></div>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <BarChart points={timeline} height={120} />
          </CardContent>
        </Card>

        {metrics?.running && (metrics.chaos_offline_toggles > 0 || metrics.chaos_cancels > 0) && (
          <div className="grid grid-cols-2 gap-3">
            <MetricCard icon={WifiOff} label="Chaos Offline Toggles" value={metrics.chaos_offline_toggles} zone="yellow" />
            <MetricCard icon={AlertTriangle} label="Chaos Cancels" value={metrics.chaos_cancels} zone="red" />
          </div>
        )}

        {optimizerData?.profit && <ProfitPanel data={optimizerData.profit} />}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <DriverModelPanel drivers={optimizerData?.driver_model || []} />
          <DemandPanel predictions={optimizerData?.demand_predictions || []} />
        </div>

        <IncidentPanel incidents={incidents} />
        <AITrendPanel aiStatus={aiStatus} />
        <MetaOptimizerPanel data={metaOptimizer} />
        <RevenueAIPanel data={revenueAI} />
        <RevenueAIProdPanel data={revenueAIProd} onToggle={async (enabled: boolean) => {
          try {
            await fetch(`${BASE_URL}/api/metrics/stress/revenue-ai-prod/toggle`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enabled }),
            });
          } catch {}
        }} onShadowToggle={async (enabled: boolean) => {
          try {
            await fetch(`${BASE_URL}/api/metrics/stress/revenue-ai-prod/shadow`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enabled }),
            });
          } catch {}
        }} />
        <AutoExecPanel />
        <EffectivenessPanel data={effectiveness} />
        <AlertLog alerts={alerts} onAck={ackAlert} />
        <RecoveryLog actions={recoveryActions} multiplier={loadMultiplier} />
        <OptimizerPanel data={optimizerData} />
        <GenerationPanel
          snapshots={optimizerData?.generation_snapshots || []}
          bestGeneration={optimizerData?.best_generation || 0}
          onRollback={rollbackGen}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 border-border/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">История тестов (последние 10)</CardTitle>
            </CardHeader>
            <CardContent>
              <HistoryTable history={history} />
            </CardContent>
          </Card>

          <Card className="border-border/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Регрессия</CardTitle>
            </CardHeader>
            <CardContent>
              <RegressionIndicator history={history} />
              {history.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border/30 space-y-2">
                  <p className="text-xs text-muted-foreground">Последний тест</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-muted-foreground">Baseline:</span> <span className="font-mono font-medium">{history[history.length - 1].baseline_success_rate}%</span></div>
                    <div><span className="text-muted-foreground">Chaos:</span> <span className="font-mono font-medium">{history[history.length - 1].chaos_success_rate}%</span></div>
                    <div><span className="text-muted-foreground">Avg:</span> <span className="font-mono font-medium">{history[history.length - 1].baseline_avg_response}ms</span></div>
                    <div><span className="text-muted-foreground">Время:</span> <span className="font-mono font-medium">{history[history.length - 1].total_duration_s}s</span></div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {metrics?.running && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground px-1">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="font-mono">
              Фаза: {metrics.current_phase} · {metrics.phase_elapsed_s}s · Буфер: {timeline.length}/{BUFFER_SIZE} · Тревоги: {alerts.length} ({unackedCount} active) · Восстановлений: {recoveryActions.length}{loadMultiplier > 1 ? ` · Нагрузка ×${loadMultiplier.toFixed(1)}` : ""} · {new Date(metrics.updated_at).toLocaleTimeString()}
            </span>
          </div>
        )}
      </div>
    </DispatcherLayout>
  );
}
