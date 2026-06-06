import { Router, type IRouter } from "express";
import os from "os";
import { authMiddleware, requireRole } from "../middlewares/auth.js";
import { getGuardianStatus } from "../lib/memory-guardian.js";

const router: IRouter = Router();

router.use(authMiddleware, requireRole("dispatcher", "admin"));

const MAX_SAMPLES = 60;
const SAMPLE_INTERVAL_MS = 10_000;

type MemSample = {
  ts: number;
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  arrayBuffers: number;
};

const memorySamples: MemSample[] = [];
let leakSuspected = false;
let leakDetail = "";

function collectSample() {
  const mem = process.memoryUsage();
  memorySamples.push({
    ts: Date.now(),
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    rss: mem.rss,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
  });
  if (memorySamples.length > MAX_SAMPLES) memorySamples.shift();
  detectLeak();
}

function detectLeak() {
  if (memorySamples.length < 6) {
    leakSuspected = false;
    leakDetail = "";
    return;
  }

  const recent = memorySamples.slice(-6);
  let heapGrowing = 0;
  let rssGrowing = 0;

  for (let i = 1; i < recent.length; i++) {
    if (recent[i].heapUsed > recent[i - 1].heapUsed) heapGrowing++;
    if (recent[i].rss > recent[i - 1].rss) rssGrowing++;
  }

  const heapDelta = recent[recent.length - 1].heapUsed - recent[0].heapUsed;
  const rssDelta = recent[recent.length - 1].rss - recent[0].rss;
  const heapPct = recent[recent.length - 1].heapTotal > 0
    ? (recent[recent.length - 1].heapUsed / recent[recent.length - 1].heapTotal) * 100
    : 0;

  const reasons: string[] = [];

  if (heapGrowing >= 5 && heapDelta > 5 * 1024 * 1024) {
    reasons.push(`heap growing continuously (+${Math.round(heapDelta / 1024 / 1024)}MB in ${recent.length * 10}s)`);
  }

  if (rssGrowing >= 5 && rssDelta > 10 * 1024 * 1024) {
    reasons.push(`RSS growing continuously (+${Math.round(rssDelta / 1024 / 1024)}MB in ${recent.length * 10}s)`);
  }

  leakSuspected = reasons.length > 0;
  leakDetail = reasons.join("; ");
}

setInterval(collectSample, SAMPLE_INTERVAL_MS);
collectSample();

router.get("/memory", async (_req, res) => {
  const mem = process.memoryUsage();
  const ru = process.resourceUsage();

  const heapPct = mem.heapTotal > 0 ? Math.round((mem.heapUsed / mem.heapTotal) * 1000) / 10 : 0;
  const maxOldSpace = 512;
  const heapOfMax = Math.round((mem.heapUsed / (maxOldSpace * 1024 * 1024)) * 1000) / 10;

  res.json({
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    rss: mem.rss,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
    rssMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
    externalMB: Math.round(mem.external / 1024 / 1024 * 10) / 10,
    arrayBuffersMB: Math.round(mem.arrayBuffers / 1024 / 1024 * 10) / 10,
    heapPct,
    heapOfMaxPct: heapOfMax,
    maxOldSpaceMB: maxOldSpace,
  });
});

router.get("/memory-profile", async (_req, res) => {
  const mem = process.memoryUsage();
  const ru = process.resourceUsage();

  const samples = memorySamples.map(s => ({
    ts: s.ts,
    heapUsedMB: Math.round(s.heapUsed / 1024 / 1024 * 10) / 10,
    heapTotalMB: Math.round(s.heapTotal / 1024 / 1024 * 10) / 10,
    rssMB: Math.round(s.rss / 1024 / 1024 * 10) / 10,
    externalMB: Math.round(s.external / 1024 / 1024 * 10) / 10,
    arrayBuffersMB: Math.round(s.arrayBuffers / 1024 / 1024 * 10) / 10,
  }));

  const heapPct = mem.heapTotal > 0 ? Math.round((mem.heapUsed / mem.heapTotal) * 1000) / 10 : 0;
  const maxOldSpace = 512;

  let heapTrend = 0;
  let rssTrend = 0;
  if (memorySamples.length >= 2) {
    const first = memorySamples[0];
    const last = memorySamples[memorySamples.length - 1];
    const timeDeltaSec = (last.ts - first.ts) / 1000;
    if (timeDeltaSec > 0) {
      heapTrend = Math.round(((last.heapUsed - first.heapUsed) / 1024 / 1024) / (timeDeltaSec / 60) * 100) / 100;
      rssTrend = Math.round(((last.rss - first.rss) / 1024 / 1024) / (timeDeltaSec / 60) * 100) / 100;
    }
  }

  res.json({
    current: {
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
      rssMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
      externalMB: Math.round(mem.external / 1024 / 1024 * 10) / 10,
      arrayBuffersMB: Math.round(mem.arrayBuffers / 1024 / 1024 * 10) / 10,
      heapPct,
      maxOldSpaceMB: maxOldSpace,
    },
    resourceUsage: {
      userCpuMs: Math.round(ru.userCPUTime / 1000),
      systemCpuMs: Math.round(ru.systemCPUTime / 1000),
      maxRssKB: ru.maxRSS,
      pageFaults: {
        minor: ru.minorPageFault,
        major: ru.majorPageFault,
      },
      fsOps: {
        reads: ru.fsRead,
        writes: ru.fsWrite,
      },
      ipc: {
        sent: ru.ipcSent,
        received: ru.ipcReceived,
      },
      voluntaryContextSwitches: ru.voluntaryContextSwitches,
      involuntaryContextSwitches: ru.involuntaryContextSwitches,
    },
    system: {
      totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
      freeMemMB: Math.round(os.freemem() / 1024 / 1024),
      cpuCores: os.cpus().length,
      loadAvg: os.loadavg().map(v => Math.round(v * 100) / 100),
      platform: os.platform(),
      nodeVersion: process.version,
      pid: process.pid,
      uptimeMin: Math.round(process.uptime() / 60 * 10) / 10,
    },
    leak: {
      suspected: leakSuspected,
      detail: leakDetail,
      heapTrendMBperMin: heapTrend,
      rssTrendMBperMin: rssTrend,
    },
    guardian: getGuardianStatus(),
    samples,
    sampleIntervalSec: SAMPLE_INTERVAL_MS / 1000,
    sampleCount: memorySamples.length,
    maxSamples: MAX_SAMPLES,
  });
});

export default router;
