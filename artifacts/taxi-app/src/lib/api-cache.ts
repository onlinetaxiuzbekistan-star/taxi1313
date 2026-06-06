const CACHE_PREFIX = "buxtaxi_cache_";
const CACHE_META_KEY = "buxtaxi_cache_meta";
const MAX_CACHE_ENTRIES = 100;
const DEFAULT_TTL = 5 * 60 * 1000;

interface CacheMeta {
  key: string;
  ts: number;
  ttl: number;
}

function readMeta(): CacheMeta[] {
  try {
    return JSON.parse(localStorage.getItem(CACHE_META_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeMeta(meta: CacheMeta[]) {
  try {
    localStorage.setItem(CACHE_META_KEY, JSON.stringify(meta.slice(-MAX_CACHE_ENTRIES)));
  } catch {}
}

export function setCached(key: string, data: any, ttl = DEFAULT_TTL) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data));
    const meta = readMeta().filter(m => m.key !== key);
    meta.push({ key, ts: Date.now(), ttl });
    if (meta.length > MAX_CACHE_ENTRIES) {
      const oldest = meta.shift();
      if (oldest) localStorage.removeItem(CACHE_PREFIX + oldest.key);
    }
    writeMeta(meta);
  } catch {}
}

export function getCached<T = any>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getCachedIfFresh<T = any>(key: string): T | null {
  const meta = readMeta().find(m => m.key === key);
  if (!meta) return getCached<T>(key);
  if (Date.now() - meta.ts > meta.ttl) return null;
  return getCached<T>(key);
}

export function clearExpiredCache() {
  const meta = readMeta();
  const now = Date.now();
  const valid = meta.filter(m => {
    if (now - m.ts > m.ttl * 3) {
      localStorage.removeItem(CACHE_PREFIX + m.key);
      return false;
    }
    return true;
  });
  writeMeta(valid);
}

const BASE = (import.meta.env.BASE_URL || "").replace(/\/$/, "");

export async function cachedFetch<T = any>(
  path: string,
  token: string | null,
  opts: { ttl?: number; forceRefresh?: boolean; fallbackToStale?: boolean } = {}
): Promise<T> {
  const { ttl = DEFAULT_TTL, forceRefresh = false, fallbackToStale = true } = opts;
  const cacheKey = path.replace(/^\//, "");

  if (!forceRefresh) {
    const fresh = getCachedIfFresh<T>(cacheKey);
    if (fresh !== null) return fresh;
  }

  try {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${BASE}${path}`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    setCached(cacheKey, data, ttl);
    return data as T;
  } catch (err) {
    if (fallbackToStale) {
      const stale = getCached<T>(cacheKey);
      if (stale !== null) return stale;
    }
    throw err;
  }
}

export async function cachedPost<T = any>(
  path: string,
  body: any,
  token: string | null
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}
