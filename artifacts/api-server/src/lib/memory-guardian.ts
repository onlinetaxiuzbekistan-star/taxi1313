import os from "os";

const RSS_LIMIT_MB = 400;
const HEAP_WARN_PCT = 70;
const GC_INTERVAL_MS = 2 * 60 * 1000;
const LOG_INTERVAL_MS = 30_000;
const LEAK_WINDOW = 10;

type MemSnapshot = { ts: number; heapUsed: number; rss: number };
const snapshots: MemSnapshot[] = [];

let gcCount = 0;
let lastGcTs = 0;
let lastCacheClearTs = 0;
let leakWarningActive = false;
let rssWarningActive = false;

type CacheClearFn = () => { name: string; cleared: number };
const registeredCaches: CacheClearFn[] = [];

export function registerCache(fn: CacheClearFn) {
  registeredCaches.push(fn);
}

function tryGC(reason: string): boolean {
  if (typeof global.gc === "function") {
    global.gc();
    gcCount++;
    lastGcTs = Date.now();
    console.log(`[MEM GUARDIAN] GC triggered: ${reason} (total GC calls: ${gcCount})`);
    return true;
  }
  return false;
}

function clearAllCaches(reason: string) {
  lastCacheClearTs = Date.now();
  let totalCleared = 0;
  const results: string[] = [];
  for (const fn of registeredCaches) {
    try {
      const r = fn();
      totalCleared += r.cleared;
      if (r.cleared > 0) results.push(`${r.name}:${r.cleared}`);
    } catch (err) {
      console.warn(`[MEM GUARDIAN] cache clear error:`, (err as Error).message);
    }
  }
  if (totalCleared > 0) {
    console.log(`[MEM GUARDIAN] Caches cleared (${reason}): ${results.join(", ")} (total: ${totalCleared} entries)`);
  }
}

function checkMemory() {
  const mem = process.memoryUsage();
  const heapUsedMB = mem.heapUsed / 1024 / 1024;
  const rssMB = mem.rss / 1024 / 1024;
  const heapPct = mem.heapTotal > 0 ? (mem.heapUsed / mem.heapTotal) * 100 : 0;

  snapshots.push({ ts: Date.now(), heapUsed: mem.heapUsed, rss: mem.rss });
  if (snapshots.length > LEAK_WINDOW + 2) snapshots.splice(0, snapshots.length - LEAK_WINDOW - 2);

  if (rssMB > RSS_LIMIT_MB) {
    if (!rssWarningActive) {
      console.warn(`[MEM GUARDIAN] RSS ${Math.round(rssMB)}MB exceeds ${RSS_LIMIT_MB}MB limit!`);
      rssWarningActive = true;
    }
    tryGC(`RSS ${Math.round(rssMB)}MB > ${RSS_LIMIT_MB}MB`);
    clearAllCaches(`RSS pressure (${Math.round(rssMB)}MB)`);
  } else {
    rssWarningActive = false;
  }

  if (heapPct > HEAP_WARN_PCT) {
    tryGC(`heap at ${Math.round(heapPct)}%`);
  }

  if (snapshots.length >= LEAK_WINDOW) {
    const window = snapshots.slice(-LEAK_WINDOW);
    let heapGrowing = 0;
    let rssGrowing = 0;
    for (let i = 1; i < window.length; i++) {
      if (window[i].heapUsed > window[i - 1].heapUsed) heapGrowing++;
      if (window[i].rss > window[i - 1].rss) rssGrowing++;
    }
    const heapDelta = window[window.length - 1].heapUsed - window[0].heapUsed;
    const rssDelta = window[window.length - 1].rss - window[0].rss;

    if (heapGrowing >= LEAK_WINDOW - 1 && heapDelta > 5 * 1024 * 1024) {
      if (!leakWarningActive) {
        console.warn(`[MEM GUARDIAN] Possible memory leak detected! Heap grew +${Math.round(heapDelta / 1024 / 1024)}MB over ${LEAK_WINDOW} cycles`);
        leakWarningActive = true;
      }
      tryGC("leak detected");
      clearAllCaches("suspected leak");
    } else if (rssGrowing >= LEAK_WINDOW - 1 && rssDelta > 10 * 1024 * 1024) {
      if (!leakWarningActive) {
        console.warn(`[MEM GUARDIAN] RSS growing continuously! +${Math.round(rssDelta / 1024 / 1024)}MB over ${LEAK_WINDOW} cycles`);
        leakWarningActive = true;
      }
      tryGC("RSS growth");
      clearAllCaches("RSS growth");
    } else {
      leakWarningActive = false;
    }
  }
}

function logMemory() {
  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10;
  const rssMB = Math.round(mem.rss / 1024 / 1024 * 10) / 10;
  const extMB = Math.round(mem.external / 1024 / 1024 * 10) / 10;
  const heapPct = mem.heapTotal > 0 ? Math.round((mem.heapUsed / mem.heapTotal) * 10) / 10 : 0;
  console.log(`[MEM] heap=${heapMB}MB (${heapPct}%) rss=${rssMB}MB ext=${extMB}MB gc=${gcCount}`);
}

function autoGC() {
  tryGC("scheduled (2min)");
}

export function getGuardianStatus() {
  const mem = process.memoryUsage();
  return {
    gcAvailable: typeof global.gc === "function",
    gcCount,
    lastGcTs,
    lastCacheClearTs,
    leakWarningActive,
    rssWarningActive,
    rssLimitMB: RSS_LIMIT_MB,
    heapWarnPct: HEAP_WARN_PCT,
    registeredCaches: registeredCaches.length,
    snapshotCount: snapshots.length,
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
    rssMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
  };
}

export function startMemoryGuardian() {
  const gcTimer = setInterval(autoGC, GC_INTERVAL_MS);
  gcTimer.unref();

  const checkTimer = setInterval(checkMemory, 10_000);
  checkTimer.unref();

  const logTimer = setInterval(logMemory, LOG_INTERVAL_MS);
  logTimer.unref();

  checkMemory();
  logMemory();

  const gcStatus = typeof global.gc === "function" ? "enabled" : "unavailable (add --expose-gc)";
  console.log(`[MEM GUARDIAN] Started: GC=${gcStatus}, RSS limit=${RSS_LIMIT_MB}MB, heap warn=${HEAP_WARN_PCT}%, log every 30s, check every 10s, auto-GC every 2min`);
}
