import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import DispatcherLayout from "./DispatcherLayout";
import { Cpu, HardDrive, MemoryStick, Clock, Activity, Wifi, WifiOff, Database, Server, AlertTriangle, RefreshCw, TrendingUp, TrendingDown, ShieldAlert, Layers, Zap } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

type HealthData = {
  cpu: { load: number; cores: number; loadAvg: number[] };
  memory: { total: number; realUsed: number; cache: number; free: number; buffers: number; cached: number };
  disk: { total: number; used: number; free: number };
  uptime: number;
  services: { api: string; websocket: string; database: string };
  websocket?: { totalClients: number; authenticatedClients: number; onlineUsers: number; driverSessions: number };
  dbPool?: { totalCount: number; idleCount: number; waitingCount: number };
  timestamp: number;
};

type MemoryData = {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  arrayBuffers: number;
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
};

type PerfData = {
  memory: { heapUsedMB: number; heapTotalMB: number; rssMB: number; externalMB: number; arrayBuffersMB: number };
  eventLoopDelayMs: number;
  activeHandles: number;
  activeRequests: number;
  uptime: number;
  maxOldSpaceMB: number;
};

type ProcessInfo = { pid: number; name: string; cpu: number; memory: number; rssMB?: number; heapUsedMB?: number | null };
type GroupInfo = { name: string; cpu: number; memory: number; rssMB?: number; count: number };
type ProcessData = {
  top: ProcessInfo[];
  groups: GroupInfo[];
  cache: { cached: number; buffers: number; sReclaimable: number; shmem: number };
};

type MemProfileSample = {
  ts: number;
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
  arrayBuffersMB: number;
};

type MemProfileData = {
  current: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    externalMB: number;
    arrayBuffersMB: number;
    heapPct: number;
    maxOldSpaceMB: number;
  };
  resourceUsage: {
    userCpuMs: number;
    systemCpuMs: number;
    maxRssKB: number;
    pageFaults: { minor: number; major: number };
    fsOps: { reads: number; writes: number };
    voluntaryContextSwitches: number;
    involuntaryContextSwitches: number;
  };
  system: {
    totalMemMB: number;
    freeMemMB: number;
    cpuCores: number;
    loadAvg: number[];
    nodeVersion: string;
    pid: number;
    uptimeMin: number;
  };
  leak: {
    suspected: boolean;
    detail: string;
    heapTrendMBperMin: number;
    rssTrendMBperMin: number;
  };
  guardian: {
    gcAvailable: boolean;
    gcCount: number;
    lastGcTs: number;
    lastCacheClearTs: number;
    leakWarningActive: boolean;
    rssWarningActive: boolean;
    rssLimitMB: number;
    heapWarnPct: number;
    registeredCaches: number;
    snapshotCount: number;
    heapUsedMB: number;
    rssMB: number;
  };
  samples: MemProfileSample[];
  sampleIntervalSec: number;
  sampleCount: number;
  maxSamples: number;
};

type PerfStatsData = {
  rps: number;
  totalRequests: number;
  topEndpoints: { path: string; rps: number }[];
  cache: { entries: number; hits: number; misses: number; hitRate: number };
  slowQueries: { count: number; recent: { query: string; durationMs: number; ts: number }[] };
  dbPool: { totalCount: number; idleCount: number; waitingCount: number };
  postgres: { activeConnections: number; dbSizeMB: number; cacheHitRatio: number; deadTuples: number };
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}д`);
  if (h > 0) parts.push(`${h}ч`);
  if (m > 0) parts.push(`${m}м`);
  if (parts.length === 0) parts.push(`${s}с`);
  return parts.join(" ");
}

function getColor(value: number, warn: number, crit: number): "green" | "yellow" | "red" {
  if (value >= crit) return "red";
  if (value >= warn) return "yellow";
  return "green";
}

const colorMap = {
  green: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    text: "text-emerald-600",
    bar: "bg-emerald-500",
    barBg: "bg-emerald-500/10",
    icon: "text-emerald-500",
    badge: "bg-emerald-100 text-emerald-700",
  },
  yellow: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    text: "text-amber-600",
    bar: "bg-amber-500",
    barBg: "bg-amber-500/10",
    icon: "text-amber-500",
    badge: "bg-amber-100 text-amber-700",
  },
  red: {
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    text: "text-red-600",
    bar: "bg-red-500",
    barBg: "bg-red-500/10",
    icon: "text-red-500",
    badge: "bg-red-100 text-red-700",
  },
};

function MetricCard({ title, icon: Icon, value, percent, detail, color, alert }: {
  title: string;
  icon: typeof Cpu;
  value: string;
  percent: number;
  detail?: string;
  color: "green" | "yellow" | "red";
  alert?: boolean;
}) {
  const c = colorMap[color];
  return (
    <div className={`bg-card rounded-xl border ${c.border} p-5 relative overflow-hidden transition-all hover:shadow-md`}>
      {alert && (
        <div className="absolute top-3 right-3">
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold animate-pulse">
            <AlertTriangle className="w-3 h-3" />
            ВНИМАНИЕ
          </div>
        </div>
      )}
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${c.icon}`} />
        </div>
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
          <p className={`text-2xl font-bold ${c.text}`}>{value}</p>
        </div>
      </div>
      <div className="space-y-2">
        <div className={`w-full h-3 rounded-full ${c.barBg} overflow-hidden`}>
          <div
            className={`h-full rounded-full ${c.bar} transition-all duration-700 ease-out`}
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
        {detail && (
          <p className="text-xs text-muted-foreground">{detail}</p>
        )}
      </div>
    </div>
  );
}

function ServiceCard({ name, status, icon: Icon }: { name: string; status: string; icon: typeof Server }) {
  const ok = status === "ok";
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
      ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"
    }`}>
      <Icon className={`w-5 h-5 ${ok ? "text-emerald-500" : "text-red-500"}`} />
      <span className="text-sm font-medium text-foreground flex-1">{name}</span>
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
        ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
      }`}>
        <div className={`w-2 h-2 rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"} ${ok ? "" : "animate-pulse"}`} />
        {ok ? "OK" : "ERROR"}
      </div>
    </div>
  );
}

function MultiLineChart({ samples, maxOldSpaceMB }: { samples: MemProfileSample[]; maxOldSpaceMB: number }) {
  if (samples.length < 2) {
    return (
      <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">
        Сбор данных (минимум 2 замера)...
      </div>
    );
  }

  const w = 700;
  const h = 160;
  const padX = 45;
  const padR = 10;
  const padY = 10;
  const padB = 20;
  const chartW = w - padX - padR;
  const chartH = h - padY - padB;

  const allVals = samples.flatMap(s => [s.heapUsedMB, s.rssMB, s.heapTotalMB]);
  const maxVal = Math.max(...allVals, maxOldSpaceMB * 1.1, 100);

  const makeLine = (getter: (s: MemProfileSample) => number) => {
    return samples.map((s, i) => {
      const x = padX + (i / (samples.length - 1)) * chartW;
      const y = padY + chartH - (getter(s) / maxVal) * chartH;
      return `${x},${y}`;
    }).join(" L");
  };

  const heapLine = `M${makeLine(s => s.heapUsedMB)}`;
  const rssLine = `M${makeLine(s => s.rssMB)}`;
  const heapTotalLine = `M${makeLine(s => s.heapTotalMB)}`;

  const gridLines = [0, 25, 50, 75, 100].map(pct => {
    const val = (pct / 100) * maxVal;
    const y = padY + chartH - (pct / 100) * chartH;
    return { y, label: `${Math.round(val)}` };
  });

  const limitY = padY + chartH - (maxOldSpaceMB / maxVal) * chartH;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-40" preserveAspectRatio="none">
      {gridLines.map((g, i) => (
        <g key={i}>
          <line x1={padX} y1={g.y} x2={w - padR} y2={g.y} stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
          <text x={padX - 4} y={g.y + 3} textAnchor="end" fill="currentColor" fillOpacity="0.4" fontSize="8">{g.label}</text>
        </g>
      ))}

      {limitY > padY && (
        <>
          <line x1={padX} y1={limitY} x2={w - padR} y2={limitY} stroke="#ef4444" strokeOpacity="0.4" strokeWidth="1" strokeDasharray="6,4" />
          <text x={w - padR} y={limitY - 3} textAnchor="end" fill="#ef4444" fillOpacity="0.6" fontSize="7">limit {maxOldSpaceMB}MB</text>
        </>
      )}

      <defs>
        <linearGradient id="heap-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={`${heapLine} L${padX + chartW},${padY + chartH} L${padX},${padY + chartH} Z`} fill="url(#heap-grad)" />

      <path d={heapTotalLine} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4,3" strokeOpacity="0.5" />
      <path d={rssLine} fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.7" />
      <path d={heapLine} fill="none" stroke="#8b5cf6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      <text x={padX + 4} y={h - 4} fill="currentColor" fillOpacity="0.3" fontSize="7">
        {samples.length} замеров × 10с
      </text>
    </svg>
  );
}

function MemoryDeepAnalysis({ profile, token }: { profile: MemProfileData; token: string }) {
  const { current, leak, resourceUsage: ru, samples } = profile;

  const heapColor = getColor(current.heapPct, 70, 85);
  const heapC = colorMap[heapColor];

  const rssOfTotal = profile.system.totalMemMB > 0
    ? Math.round((current.rssMB / profile.system.totalMemMB) * 1000) / 10
    : 0;

  return (
    <div className="space-y-4">
      {leak.suspected && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3 animate-pulse">
          <ShieldAlert className="w-6 h-6 text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-bold text-red-600">Возможная утечка памяти!</h4>
            <p className="text-xs text-red-500 mt-1">{leak.detail}</p>
            <div className="flex gap-4 mt-2 text-xs">
              <span className="text-red-400">Heap тренд: <span className="font-bold">{leak.heapTrendMBperMin > 0 ? "+" : ""}{leak.heapTrendMBperMin} MB/мин</span></span>
              <span className="text-red-400">RSS тренд: <span className="font-bold">{leak.rssTrendMBperMin > 0 ? "+" : ""}{leak.rssTrendMBperMin} MB/мин</span></span>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`bg-card rounded-xl border ${heapC.border} p-4`}>
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-8 h-8 rounded-lg ${heapC.bg} flex items-center justify-center`}>
              <Layers className={`w-4 h-4 ${heapC.icon}`} />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Heap Used</p>
              <p className={`text-xl font-bold ${heapC.text}`}>{current.heapUsedMB} MB</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="w-full h-2.5 rounded-full bg-muted/40 overflow-hidden relative">
              <div className={`h-full rounded-full ${heapC.bar} transition-all duration-700`} style={{ width: `${Math.min(100, current.heapPct)}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{current.heapPct}% of allocated ({current.heapTotalMB} MB)</span>
              <span>лимит: {current.maxOldSpaceMB} MB</span>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1 text-xs">
            {leak.heapTrendMBperMin > 0.5 ? (
              <><TrendingUp className="w-3.5 h-3.5 text-red-500" /><span className="text-red-500 font-semibold">+{leak.heapTrendMBperMin} MB/мин</span></>
            ) : leak.heapTrendMBperMin < -0.5 ? (
              <><TrendingDown className="w-3.5 h-3.5 text-emerald-500" /><span className="text-emerald-500 font-semibold">{leak.heapTrendMBperMin} MB/мин</span></>
            ) : (
              <span className="text-muted-foreground">Стабильно</span>
            )}
          </div>
        </div>

        <div className="bg-card rounded-xl border border-orange-500/20 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <MemoryStick className="w-4 h-4 text-orange-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">RSS (Resident Set)</p>
              <p className="text-xl font-bold text-orange-600">{current.rssMB} MB</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="w-full h-2.5 rounded-full bg-muted/40 overflow-hidden">
              <div className="h-full rounded-full bg-orange-500 transition-all duration-700" style={{ width: `${Math.min(100, rssOfTotal)}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground">{rssOfTotal}% от системной RAM ({profile.system.totalMemMB} MB)</p>
          </div>
          <div className="mt-2 flex items-center gap-1 text-xs">
            {leak.rssTrendMBperMin > 1 ? (
              <><TrendingUp className="w-3.5 h-3.5 text-red-500" /><span className="text-red-500 font-semibold">+{leak.rssTrendMBperMin} MB/мин</span></>
            ) : leak.rssTrendMBperMin < -1 ? (
              <><TrendingDown className="w-3.5 h-3.5 text-emerald-500" /><span className="text-emerald-500 font-semibold">{leak.rssTrendMBperMin} MB/мин</span></>
            ) : (
              <span className="text-muted-foreground">Стабильно</span>
            )}
          </div>
        </div>

        <div className="bg-card rounded-xl border border-cyan-500/20 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center">
              <Zap className="w-4 h-4 text-cyan-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">External + ArrayBuffers</p>
              <p className="text-xl font-bold text-cyan-600">{current.externalMB} MB</p>
            </div>
          </div>
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>External (C++ objects)</span>
              <span className="font-semibold text-foreground">{current.externalMB} MB</span>
            </div>
            <div className="flex justify-between">
              <span>ArrayBuffers</span>
              <span className="font-semibold text-foreground">{current.arrayBuffersMB} MB</span>
            </div>
            <div className="flex justify-between">
              <span>Max RSS (пиковый)</span>
              <span className="font-semibold text-foreground">{Math.round(ru.maxRssKB / 1024)} MB</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-violet-500" />
          Heap / RSS — история ({profile.sampleCount} × {profile.sampleIntervalSec}с)
        </h4>
        <MultiLineChart samples={samples} maxOldSpaceMB={current.maxOldSpaceMB} />
        <div className="flex items-center gap-6 mt-2 text-[10px]">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-violet-500 inline-block rounded-full" />
            <span className="text-muted-foreground">Heap Used</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-orange-500 inline-block rounded-full" />
            <span className="text-muted-foreground">RSS</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-slate-400 inline-block rounded-full border-dashed" style={{ borderTop: "1px dashed" }} />
            <span className="text-muted-foreground">Heap Total</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-red-400 inline-block rounded-full border-dashed" style={{ borderTop: "1px dashed" }} />
            <span className="text-muted-foreground">Лимит ({current.maxOldSpaceMB} MB)</span>
          </span>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-5">
        <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Server className="w-4 h-4 text-indigo-500" />
          Использование ресурсов (process.resourceUsage)
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">{(ru.userCpuMs / 1000).toFixed(1)}s</p>
            <p className="text-[10px] text-muted-foreground">User CPU</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">{(ru.systemCpuMs / 1000).toFixed(1)}s</p>
            <p className="text-[10px] text-muted-foreground">System CPU</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">{ru.fsOps.reads}</p>
            <p className="text-[10px] text-muted-foreground">FS Reads</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">{ru.fsOps.writes}</p>
            <p className="text-[10px] text-muted-foreground">FS Writes</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3 pt-3 border-t border-border">
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">{ru.pageFaults.minor.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Minor Page Faults</p>
          </div>
          <div className="text-center">
            <p className={`text-lg font-bold ${ru.pageFaults.major > 100 ? "text-red-500" : "text-foreground"}`}>{ru.pageFaults.major.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Major Page Faults</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">{ru.voluntaryContextSwitches.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Vol. Ctx Switches</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">{ru.involuntaryContextSwitches.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Invol. Ctx Switches</p>
          </div>
        </div>
      </div>

      {profile.guardian && <div className={`bg-card rounded-xl border ${profile.guardian.leakWarningActive || profile.guardian.rssWarningActive ? "border-red-500/30" : "border-emerald-500/20"} p-5`}>
        <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <ShieldAlert className={`w-4 h-4 ${profile.guardian.leakWarningActive || profile.guardian.rssWarningActive ? "text-red-500" : "text-emerald-500"}`} />
          Memory Guardian
          {profile.guardian.gcAvailable ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 font-medium">GC ENABLED</span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 font-medium">GC UNAVAILABLE</span>
          )}
          {profile.guardian.leakWarningActive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 font-bold animate-pulse">LEAK WARNING</span>
          )}
          {profile.guardian.rssWarningActive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 font-bold animate-pulse">RSS &gt; {profile.guardian.rssLimitMB}MB</span>
          )}
        </h4>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">{profile.guardian.gcCount}</p>
            <p className="text-[10px] text-muted-foreground">GC вызовов</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">{profile.guardian.registeredCaches}</p>
            <p className="text-[10px] text-muted-foreground">Кэшей</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">{profile.guardian.snapshotCount}</p>
            <p className="text-[10px] text-muted-foreground">Снимков</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">{profile.guardian.heapUsedMB} MB</p>
            <p className="text-[10px] text-muted-foreground">Heap</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">{profile.guardian.rssLimitMB} MB</p>
            <p className="text-[10px] text-muted-foreground">RSS лимит</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">{profile.guardian.heapWarnPct}%</p>
            <p className="text-[10px] text-muted-foreground">Heap порог</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Последний GC</span>
            <span className="font-semibold text-foreground">
              {profile.guardian.lastGcTs > 0 ? `${Math.round((Date.now() - profile.guardian.lastGcTs) / 1000)}с назад` : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Последняя очистка кэшей</span>
            <span className="font-semibold text-foreground">
              {profile.guardian.lastCacheClearTs > 0 ? `${Math.round((Date.now() - profile.guardian.lastCacheClearTs) / 1000)}с назад` : "—"}
            </span>
          </div>
        </div>
      </div>
      }
    </div>
  );
}

export default function SystemMonitor() {
  const { token } = useAuth();
  const [data, setData] = useState<HealthData | null>(null);
  const [memData, setMemData] = useState<MemoryData | null>(null);
  const [perfData, setPerfData] = useState<PerfData | null>(null);
  const [procData, setProcData] = useState<ProcessData | null>(null);
  const [memProfile, setMemProfile] = useState<MemProfileData | null>(null);
  const [perfStats, setPerfStats] = useState<PerfStatsData | null>(null);
  const [queueData, setQueueData] = useState<{ queueSize: number; totalEnqueued: number; totalDequeued: number; avgWaitMs: number; skippedDrivers: number; avgAssignTimeMs: number; topDrivers: { driverId: number; skippedCount: number; waitMs: number }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [history, setHistory] = useState<{ cpu: number; mem: number; memGB: number; heap: number; time: number }[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchSeqRef = useRef(0);
  const prevUsedRef = useRef<number | null>(null);

  const fetchHealth = async () => {
    const seq = ++fetchSeqRef.current;
    try {
      const healthRes = await fetch(`${BASE_URL}/api/system/health`, { headers: { Authorization: `Bearer ${token}` } });
      if (!healthRes.ok) throw new Error("Failed to fetch");
      if (seq !== fetchSeqRef.current) return;
      const d: HealthData = await healthRes.json();
      setData(d);
      setError(null);
      setLastUpdate(new Date());

      let heapPct = 0;
      try {
        const [memRes, perfRes, procRes, profileRes, perfStatsRes, queueRes] = await Promise.all([
          fetch(`${BASE_URL}/api/system/memory`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
          fetch(`${BASE_URL}/api/system/performance`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
          fetch(`${BASE_URL}/api/system/processes`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
          fetch(`${BASE_URL}/api/debug/memory-profile`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
          fetch(`${BASE_URL}/api/system/perf-stats`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
          fetch(`${BASE_URL}/api/system/queue`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
        ]);
        if (memRes?.ok) {
          const m: MemoryData = await memRes.json();
          setMemData(m);
          heapPct = m.heapTotal > 0 ? Math.round((m.heapUsed / m.heapTotal) * 100) : 0;
        }
        if (perfRes?.ok) {
          const p: PerfData = await perfRes.json();
          setPerfData(p);
        }
        if (procRes?.ok) {
          const pr: ProcessData = await procRes.json();
          setProcData(pr);
        }
        if (profileRes?.ok) {
          const mp: MemProfileData = await profileRes.json();
          setMemProfile(mp);
        }
        if (perfStatsRes?.ok) {
          const ps: PerfStatsData = await perfStatsRes.json();
          setPerfStats(ps);
        }
        if (queueRes?.ok) {
          const q = await queueRes.json();
          setQueueData(q);
        }
      } catch {}

      setHistory(prev => {
        const memPctH = Math.round((d.memory.realUsed / d.memory.total) * 1000) / 10;
        const memGBH = Math.round((d.memory.realUsed / 1024 / 1024 / 1024) * 100) / 100;
        const next = [...prev, { cpu: d.cpu.load, mem: memPctH, memGB: memGBH, heap: heapPct, time: d.timestamp }];
        return next.slice(-60);
      });

      prevUsedRef.current = d.memory.realUsed;
    } catch {
      setError("Не удалось получить данные сервера");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    intervalRef.current = setInterval(fetchHealth, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [token]);

  const cpuPct = data?.cpu.load ?? 0;
  const memPct = data ? Math.round((data.memory.realUsed / data.memory.total) * 1000) / 10 : 0;
  const cachePct = data ? Math.round((data.memory.cache / data.memory.total) * 1000) / 10 : 0;
  const freePct = data ? Math.round((data.memory.free / data.memory.total) * 1000) / 10 : 0;
  const diskPct = data && data.disk.total > 0 ? Math.round((data.disk.used / data.disk.total) * 100) : 0;

  const usedGB = data ? Math.round((data.memory.realUsed / 1024 / 1024 / 1024) * 100) / 100 : 0;
  const totalGB = data ? Math.round((data.memory.total / 1024 / 1024 / 1024) * 10) / 10 : 0;
  const cacheGB = data ? Math.round((data.memory.cache / 1024 / 1024 / 1024) * 100) / 100 : 0;
  const freeGB = data ? Math.round((data.memory.free / 1024 / 1024 / 1024) * 100) / 100 : 0;

  const ramDeltaMB = (() => {
    if (history.length < 2) return 0;
    const prev = history[history.length - 2].memGB;
    const curr = history[history.length - 1].memGB;
    return Math.round((curr - prev) * 1024);
  })();

  const ramTrendColor = (() => {
    if (history.length < 4) return "text-muted-foreground";
    const recent = history.slice(-4);
    const deltas = recent.slice(1).map((h, i) => h.memGB - recent[i].memGB);
    const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const avgDeltaMB = avgDelta * 1024;
    if (avgDeltaMB > 50) return "text-red-500";
    if (avgDeltaMB > 5) return "text-amber-500";
    if (avgDeltaMB < -5) return "text-cyan-500";
    return "text-emerald-500";
  })();

  const cpuColor = getColor(cpuPct, 80, 95);
  const memColor = getColor(memPct, 85, 95);
  const diskColor = getColor(diskPct, 90, 95);

  const cpuAlert = cpuPct > 80;
  const memAlert = memPct > 85;
  const diskAlert = diskPct > 90;
  const heapAlert = memProfile ? memProfile.current.heapPct > 70 : false;
  const leakAlert = memProfile?.leak.suspected ?? false;
  const hasAlerts = cpuAlert || memAlert || diskAlert || heapAlert || leakAlert;

  const maxCpu = history.length > 0 ? Math.max(...history.map(h => h.cpu)) : 0;
  const maxMem = history.length > 0 ? Math.max(...history.map(h => h.mem)) : 0;

  return (
    <DispatcherLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <Activity className="w-5 h-5 text-violet-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Мониторинг сервера</h1>
              <p className="text-xs text-muted-foreground">
                {lastUpdate ? `Обновлено: ${lastUpdate.toLocaleTimeString()}` : "Загрузка..."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {leakAlert && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-100 text-red-700 text-xs font-bold animate-pulse">
                <ShieldAlert className="w-3.5 h-3.5" />
                Утечка памяти
              </div>
            )}
            {heapAlert && !leakAlert && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-100 text-red-700 text-xs font-bold animate-pulse">
                <AlertTriangle className="w-3.5 h-3.5" />
                Heap &gt; 80%
              </div>
            )}
            {hasAlerts && !leakAlert && !heapAlert && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-100 text-red-700 text-xs font-bold animate-pulse">
                <AlertTriangle className="w-3.5 h-3.5" />
                Высокая нагрузка
              </div>
            )}
            <button
              onClick={fetchHealth}
              className="p-2 rounded-lg hover:bg-muted transition-colors active:scale-95"
              title="Обновить"
            >
              <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
            </button>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Live — 5с
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-center gap-2">
            <WifiOff className="w-5 h-5 text-red-500" />
            <span className="text-sm text-red-600">{error}</span>
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                title="CPU"
                icon={Cpu}
                value={`${cpuPct}%`}
                percent={cpuPct}
                detail={`${data.cpu.cores} ядер · Load Avg: ${data.cpu.loadAvg.join(", ")}`}
                color={cpuColor}
                alert={cpuAlert}
              />
              <div className={`bg-card rounded-xl border ${colorMap[memColor].border} p-5 relative overflow-hidden transition-all hover:shadow-md`}>
                {memAlert && (
                  <div className="absolute top-3 right-3">
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold animate-pulse">
                      <AlertTriangle className="w-3 h-3" />
                      ВНИМАНИЕ
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl ${colorMap[memColor].bg} flex items-center justify-center`}>
                      <MemoryStick className={`w-5 h-5 ${colorMap[memColor].icon}`} />
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground">RAM</h3>
                      <p className={`text-2xl font-bold ${colorMap[memColor].text}`}>
                        {usedGB.toFixed(2)} <span className="text-base font-normal">GB</span>
                        <span className="text-sm font-normal text-muted-foreground ml-1">/ {totalGB} GB</span>
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-semibold text-muted-foreground">{memPct}%</span>
                    {ramDeltaMB !== 0 && (
                      <div className={`text-xs font-mono font-semibold ${ramTrendColor} flex items-center justify-end gap-0.5`}>
                        {ramDeltaMB > 0 ? `+${ramDeltaMB}` : ramDeltaMB} MB {ramDeltaMB > 0 ? "↑" : "↓"}
                      </div>
                    )}
                    {ramDeltaMB === 0 && history.length >= 2 && (
                      <div className="text-xs font-mono text-emerald-500">~ стабильно</div>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="w-full h-3 rounded-full bg-muted/40 overflow-hidden flex">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-700 ease-out"
                      style={{ width: `${memPct}%` }}
                      title={`Used: ${usedGB.toFixed(2)} GB (${memPct}%)`}
                    />
                    <div
                      className="h-full bg-amber-400 transition-all duration-700 ease-out"
                      style={{ width: `${cachePct}%` }}
                      title={`Cache: ${cacheGB.toFixed(2)} GB (${cachePct}%)`}
                    />
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
                      <span className="text-muted-foreground">Used:</span>
                      <span className="font-semibold text-foreground">{usedGB.toFixed(2)} GB</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                      <span className="text-muted-foreground">Cache:</span>
                      <span className="font-semibold text-foreground">{cacheGB.toFixed(2)} GB</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-muted inline-block" />
                      <span className="text-muted-foreground">Free:</span>
                      <span className="font-semibold text-foreground">{freeGB.toFixed(2)} GB</span>
                    </span>
                  </div>
                </div>
              </div>
              <MetricCard
                title="Диск"
                icon={HardDrive}
                value={`${diskPct}%`}
                percent={diskPct}
                detail={`${formatBytes(data.disk.used)} / ${formatBytes(data.disk.total)} (свободно: ${formatBytes(data.disk.free)})`}
                color={diskColor}
                alert={diskAlert}
              />
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground">Uptime</h3>
                    <p className="text-2xl font-bold text-blue-600">{formatUptime(data.uptime)}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Сервер работает непрерывно
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-violet-500" />
                  CPU — история (последние {history.length * 5}с)
                </h3>
                <MiniChart data={history.map(h => h.cpu)} maxVal={100} color="rgb(139,92,246)" label="CPU %" />
                <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                  <span>Текущий: {cpuPct}%</span>
                  <span>Макс: {maxCpu.toFixed(1)}%</span>
                </div>
              </div>
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                  <MemoryStick className="w-4 h-4 text-indigo-500" />
                  RAM — история (последние {history.length * 5}с)
                </h3>
                {(() => {
                  const gbData = history.map(h => h.memGB);
                  const minGB = gbData.length > 0 ? Math.floor(Math.min(...gbData) * 10) / 10 : 0;
                  const maxGB = gbData.length > 0 ? Math.ceil(Math.max(...gbData) * 10) / 10 : totalGB;
                  const range = Math.max(maxGB - minGB, 0.5);
                  const chartMin = Math.max(0, minGB - range * 0.15);
                  const chartMax = maxGB + range * 0.15;
                  return (
                    <>
                      <MiniChart data={gbData.map(v => v - chartMin)} maxVal={chartMax - chartMin} color="rgb(99,102,241)" label="RAM-GB" />
                      <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground font-mono">
                        <span>{chartMin.toFixed(1)} GB</span>
                        <span>{chartMax.toFixed(1)} GB</span>
                      </div>
                    </>
                  );
                })()}
                <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
                  <span>Текущий: <span className="font-semibold text-foreground">{usedGB.toFixed(2)} GB</span></span>
                  <span>Макс: <span className="font-semibold text-foreground">{history.length > 0 ? Math.max(...history.map(h => h.memGB)).toFixed(2) : "—"} GB</span></span>
                </div>
              </div>
            </div>

            {memProfile && (
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Layers className="w-5 h-5 text-violet-500" />
                  Memory Deep Analysis
                  {leakAlert && <span className="text-xs font-normal bg-red-100 text-red-700 px-2 py-0.5 rounded-full animate-pulse">LEAK DETECTED</span>}
                  {heapAlert && !leakAlert && <span className="text-xs font-normal bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">HIGH HEAP</span>}
                </h2>
                <MemoryDeepAnalysis profile={memProfile} token={token || ""} />
              </div>
            )}

            {perfStats && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Zap className="w-5 h-5 text-amber-500" />
                  Производительность API
                </h2>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-card rounded-xl border border-border p-4 text-center">
                    <p className="text-2xl font-bold text-amber-500">{perfStats.rps}</p>
                    <p className="text-xs text-muted-foreground">RPS</p>
                  </div>
                  <div className="bg-card rounded-xl border border-border p-4 text-center">
                    <p className="text-2xl font-bold text-foreground">{perfStats.totalRequests.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Всего запросов</p>
                  </div>
                  <div className="bg-card rounded-xl border border-border p-4 text-center">
                    <p className={`text-2xl font-bold ${perfStats.cache.hitRate > 50 ? "text-emerald-500" : "text-foreground"}`}>{perfStats.cache.hitRate}%</p>
                    <p className="text-xs text-muted-foreground">Cache Hit Rate</p>
                  </div>
                  <div className="bg-card rounded-xl border border-border p-4 text-center">
                    <p className={`text-2xl font-bold ${perfStats.slowQueries.count > 10 ? "text-red-500" : "text-foreground"}`}>{perfStats.slowQueries.count}</p>
                    <p className="text-xs text-muted-foreground">Медленных запросов</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-card rounded-xl border border-border p-4">
                    <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                      <Database className="w-4 h-4 text-blue-500" />
                      PostgreSQL
                    </h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Активных соединений</span>
                        <span className="font-semibold text-foreground">{perfStats.postgres.activeConnections}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Размер БД</span>
                        <span className="font-semibold text-foreground">{perfStats.postgres.dbSizeMB} MB</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Cache Hit Ratio</span>
                        <span className={`font-semibold ${perfStats.postgres.cacheHitRatio > 95 ? "text-emerald-500" : perfStats.postgres.cacheHitRatio > 80 ? "text-amber-500" : "text-red-500"}`}>{perfStats.postgres.cacheHitRatio}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Dead Tuples</span>
                        <span className={`font-semibold ${perfStats.postgres.deadTuples > 10000 ? "text-amber-500" : "text-foreground"}`}>{perfStats.postgres.deadTuples.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Пул: всего</span>
                        <span className="font-semibold text-foreground">{perfStats.dbPool.totalCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Пул: idle / waiting</span>
                        <span className="font-semibold text-foreground">{perfStats.dbPool.idleCount} / {perfStats.dbPool.waitingCount}</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-card rounded-xl border border-border p-4">
                    <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-violet-500" />
                      Топ эндпоинтов
                    </h4>
                    <div className="space-y-1.5 text-sm max-h-48 overflow-y-auto">
                      {perfStats.topEndpoints.length === 0 ? (
                        <p className="text-muted-foreground text-xs">Нет данных</p>
                      ) : (
                        perfStats.topEndpoints.map((ep, i) => (
                          <div key={i} className="flex justify-between items-center py-0.5">
                            <span className="text-muted-foreground font-mono text-xs truncate max-w-[70%]">{ep.path}</span>
                            <span className="font-semibold text-foreground text-xs">{ep.rps} rps</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {perfStats.slowQueries.recent.length > 0 && (
                  <div className="bg-card rounded-xl border border-amber-500/20 p-4">
                    <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      Медленные запросы ({">"}100ms)
                    </h4>
                    <div className="space-y-2 text-xs">
                      {perfStats.slowQueries.recent.map((sq, i) => (
                        <div key={i} className="flex justify-between items-center py-1 border-b border-border last:border-0">
                          <span className="font-mono text-muted-foreground truncate max-w-[75%]">{sq.query}</span>
                          <span className={`font-bold ${sq.durationMs > 500 ? "text-red-500" : "text-amber-500"}`}>{sq.durationMs}ms</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <Wifi className="w-4 h-4 text-emerald-500" />
                Статус сервисов
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <ServiceCard name="API Server" status={data.services.api} icon={Server} />
                <ServiceCard name="WebSocket" status={data.services.websocket} icon={Wifi} />
                <ServiceCard name="PostgreSQL" status={data.services.database} icon={Database} />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {data.websocket && (
                <div className="bg-card rounded-xl border border-border p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-blue-500" />
                    WebSocket
                  </h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Всего соединений</span>
                      <span className="font-semibold text-foreground">{data.websocket.totalClients}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Аутентифицированных</span>
                      <span className="font-semibold text-foreground">{data.websocket.authenticatedClients}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Пользователей онлайн</span>
                      <span className="font-semibold text-emerald-600">{data.websocket.onlineUsers}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Сессий водителей</span>
                      <span className="font-semibold text-foreground">{data.websocket.driverSessions}</span>
                    </div>
                  </div>
                </div>
              )}

              {data.dbPool && (
                <div className="bg-card rounded-xl border border-border p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Database className="w-4 h-4 text-orange-500" />
                    DB Pool
                  </h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Активных соединений</span>
                      <span className="font-semibold text-foreground">{data.dbPool.totalCount}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Свободных</span>
                      <span className="font-semibold text-emerald-600">{data.dbPool.idleCount}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">В ожидании</span>
                      <span className={`font-semibold ${data.dbPool.waitingCount > 0 ? "text-amber-600" : "text-foreground"}`}>
                        {data.dbPool.waitingCount}
                      </span>
                    </div>
                    <div className="mt-2">
                      <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-orange-500 transition-all duration-500"
                          style={{ width: `${Math.min(100, (data.dbPool.totalCount / 20) * 100)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">{data.dbPool.totalCount}/20 макс.</p>
                    </div>
                  </div>
                </div>
              )}

              {queueData && (
                <div className="bg-card rounded-xl border border-border p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-cyan-500" />
                    Очередь водителей
                  </h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">В очереди</span>
                      <span className="font-semibold text-cyan-600">{queueData.queueSize}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Добавлено всего</span>
                      <span className="font-semibold text-foreground">{queueData.totalEnqueued}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Назначено</span>
                      <span className="font-semibold text-foreground">{queueData.totalDequeued}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Ср. время ожидания</span>
                      <span className="font-semibold text-foreground">{queueData.avgWaitMs > 0 ? `${Math.round(queueData.avgWaitMs / 1000)}с` : "—"}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Пропущено</span>
                      <span className={`font-semibold ${queueData.skippedDrivers > 0 ? "text-amber-600" : "text-foreground"}`}>{queueData.skippedDrivers}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Ср. назначение</span>
                      <span className="font-semibold text-foreground">{queueData.avgAssignTimeMs > 0 ? `${Math.round(queueData.avgAssignTimeMs)}мс` : "—"}</span>
                    </div>
                  </div>
                </div>
              )}

              {memData && (
                <div className="bg-card rounded-xl border border-border p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Server className="w-4 h-4 text-purple-500" />
                    Node.js Heap
                  </h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Heap Used</span>
                      <span className="font-semibold text-foreground">{memData.heapUsedMB} MB</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Heap Total</span>
                      <span className="font-semibold text-foreground">{memData.heapTotalMB} MB</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">RSS</span>
                      <span className="font-semibold text-foreground">{memData.rssMB} MB</span>
                    </div>
                    <div className="mt-2">
                      <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            memData.heapTotal > 0 && memData.heapUsed / memData.heapTotal > 0.85 ? "bg-red-500" :
                            memData.heapTotal > 0 && memData.heapUsed / memData.heapTotal > 0.7 ? "bg-amber-500" : "bg-purple-500"
                          }`}
                          style={{ width: `${memData.heapTotal > 0 ? Math.min(100, (memData.heapUsed / memData.heapTotal) * 100) : 0}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Heap: {memData.heapTotal > 0 ? Math.round((memData.heapUsed / memData.heapTotal) * 100) : 0}% (лимит: 512 MB)
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {procData && (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {procData.groups.map(g => {
                    const memColor = g.memory > 30 ? "red" : g.memory > 15 ? "yellow" : "green";
                    const cpuColor = g.cpu > 50 ? "red" : g.cpu > 20 ? "yellow" : "green";
                    const groupLabels: Record<string, string> = { node: "Node.js (API)", postgres: "PostgreSQL (DB)", system: "System (other)" };
                    const groupIcons: Record<string, string> = { node: "text-emerald-500", postgres: "text-orange-500", system: "text-slate-500" };
                    return (
                      <div key={g.name} className="bg-card rounded-xl border border-border p-5">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Server className={`w-4 h-4 ${groupIcons[g.name] || "text-slate-500"}`} />
                            {groupLabels[g.name] || g.name}
                          </h3>
                          <span className="text-[10px] text-muted-foreground">{g.count} proc{g.rssMB ? ` · ${g.rssMB} MB` : ""}</span>
                        </div>
                        <div className="space-y-3">
                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-muted-foreground">CPU</span>
                              <span className={`font-semibold ${cpuColor === "red" ? "text-red-500" : cpuColor === "yellow" ? "text-amber-500" : "text-emerald-600"}`}>{g.cpu}%</span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden">
                              <div className={`h-full rounded-full transition-all duration-700 ${cpuColor === "red" ? "bg-red-500" : cpuColor === "yellow" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, g.cpu)}%` }} />
                            </div>
                          </div>
                          <div>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-muted-foreground">RAM</span>
                              <span className={`font-semibold ${memColor === "red" ? "text-red-500" : memColor === "yellow" ? "text-amber-500" : "text-emerald-600"}`}>{g.memory}%</span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden">
                              <div className={`h-full rounded-full transition-all duration-700 ${memColor === "red" ? "bg-red-500" : memColor === "yellow" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, g.memory)}%` }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="bg-card rounded-xl border border-border p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-violet-500" />
                    Top процессы
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 text-xs font-medium text-muted-foreground">PID</th>
                          <th className="text-left py-2 text-xs font-medium text-muted-foreground">Процесс</th>
                          <th className="text-left py-2 text-xs font-medium text-muted-foreground w-[25%]">CPU %</th>
                          <th className="text-left py-2 text-xs font-medium text-muted-foreground w-[25%]">RAM %</th>
                          <th className="text-right py-2 text-xs font-medium text-muted-foreground">RSS MB</th>
                        </tr>
                      </thead>
                      <tbody>
                        {procData.top.map(p => {
                          const cpuC = p.cpu > 30 ? "bg-red-500" : p.cpu > 10 ? "bg-amber-500" : "bg-emerald-500";
                          const memC = p.memory > 20 ? "bg-red-500" : p.memory > 10 ? "bg-amber-500" : "bg-emerald-500";
                          const cpuT = p.cpu > 30 ? "text-red-500" : p.cpu > 10 ? "text-amber-500" : "text-emerald-600";
                          const memT = p.memory > 20 ? "text-red-500" : p.memory > 10 ? "text-amber-500" : "text-emerald-600";
                          return (
                            <tr key={p.pid} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                              <td className="py-2 text-xs text-muted-foreground font-mono">{p.pid}</td>
                              <td className="py-2 font-medium text-foreground">{p.name}</td>
                              <td className="py-2">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                                    <div className={`h-full rounded-full ${cpuC} transition-all duration-500`} style={{ width: `${Math.min(100, p.cpu)}%` }} />
                                  </div>
                                  <span className={`text-xs font-semibold min-w-[3rem] text-right ${cpuT}`}>{p.cpu}%</span>
                                </div>
                              </td>
                              <td className="py-2">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                                    <div className={`h-full rounded-full ${memC} transition-all duration-500`} style={{ width: `${Math.min(100, p.memory)}%` }} />
                                  </div>
                                  <span className={`text-xs font-semibold min-w-[3rem] text-right ${memT}`}>{p.memory}%</span>
                                </div>
                              </td>
                              <td className="py-2 text-right">
                                <span className="text-xs font-semibold text-foreground">{p.rssMB ?? "—"}</span>
                                {p.heapUsedMB != null && (
                                  <span className="text-[10px] text-muted-foreground ml-1">(heap: {p.heapUsedMB})</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {procData.cache && (
                    <div className="mt-4 pt-3 border-t border-border flex flex-wrap gap-4 text-xs text-muted-foreground">
                      <span>Cached: <span className="font-semibold text-foreground">{formatBytes(procData.cache.cached)}</span></span>
                      <span>Buffers: <span className="font-semibold text-foreground">{formatBytes(procData.cache.buffers)}</span></span>
                      <span>SReclaimable: <span className="font-semibold text-foreground">{formatBytes(procData.cache.sReclaimable)}</span></span>
                      <span>Shmem: <span className="font-semibold text-foreground">{formatBytes(procData.cache.shmem)}</span></span>
                    </div>
                  )}
                </div>
              </>
            )}

            {perfData && (
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-500" />
                  Runtime Performance
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="text-center">
                    <p className={`text-lg font-bold ${perfData.eventLoopDelayMs > 50 ? "text-red-500" : perfData.eventLoopDelayMs > 10 ? "text-amber-500" : "text-emerald-600"}`}>
                      {perfData.eventLoopDelayMs} ms
                    </p>
                    <p className="text-[10px] text-muted-foreground">Event Loop Delay</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-foreground">{perfData.activeHandles}</p>
                    <p className="text-[10px] text-muted-foreground">Active Handles</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-foreground">{perfData.activeRequests}</p>
                    <p className="text-[10px] text-muted-foreground">Active Requests</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-foreground">{perfData.memory.externalMB} MB</p>
                    <p className="text-[10px] text-muted-foreground">External Memory</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 animate-spin text-violet-500" />
              <span className="text-sm text-muted-foreground">Загрузка данных...</span>
            </div>
          </div>
        )}
      </div>
    </DispatcherLayout>
  );
}

function MiniChart({ data, maxVal, color, label }: { data: number[]; maxVal: number; color: string; label: string }) {
  if (data.length < 2) {
    return (
      <div className="h-20 flex items-center justify-center text-xs text-muted-foreground">
        Сбор данных...
      </div>
    );
  }

  const w = 600;
  const h = 80;
  const padX = 0;
  const padY = 4;
  const chartW = w - padX * 2;
  const chartH = h - padY * 2;

  const points = data.map((val, i) => {
    const x = padX + (i / (data.length - 1)) * chartW;
    const y = padY + chartH - (val / maxVal) * chartH;
    return `${x},${y}`;
  });

  const linePath = `M${points.join(" L")}`;
  const areaPath = `${linePath} L${padX + chartW},${padY + chartH} L${padX},${padY + chartH} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#grad-${label})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
