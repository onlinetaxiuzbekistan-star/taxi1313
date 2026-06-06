import Dexie from "dexie";

const DB_NAME = "buxtaxi_offline";
const DB_VERSION = 1;
const LEGACY_QUEUE_KEY = "buxtaxi_offline_queue";
const LEGACY_APPLIED_KEY = "buxtaxi_offline_applied";
const MAX_QUEUE = 200;
const MAX_ACTION_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 дня

export interface OfflineAction {
  id: string;
  type: "pickup" | "dropoff" | "start" | "complete" | "cancel";
  endpoint: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
  timestamp: number;
  rideId?: number;
  passengerId?: number;
  retries: number;
  localLabel: string;
}

class OfflineDB extends Dexie {
  actions!: Dexie.Table<OfflineAction, string>;
  applied!: Dexie.Table<{ id: string; ts: number }, string>;

  constructor() {
    super(DB_NAME);
    this.version(DB_VERSION).stores({
      actions: "id, type, timestamp, rideId",
      applied: "id, ts",
    });
  }
}

let db: OfflineDB;
let dbReady = false;
let dbFailed = false;

function getDB(): OfflineDB | null {
  if (dbFailed) return null;
  if (!db) {
    try {
      db = new OfflineDB();
      db.open()
        .then(() => { dbReady = true; })
        .catch((err) => {
          console.warn("[offline-queue] IndexedDB open failed, falling back to localStorage", err);
          dbFailed = true;
        });
    } catch (err) {
      console.warn("[offline-queue] Dexie constructor failed, falling back to localStorage", err);
      dbFailed = true;
      return null;
    }
  }
  return db;
}

getDB();

function emitChange(count: number) {
  window.dispatchEvent(new CustomEvent("offline-queue-change", { detail: { count } }));
}

function legacyReadQueue(): OfflineAction[] {
  try { return JSON.parse(localStorage.getItem(LEGACY_QUEUE_KEY) || "[]"); } catch { return []; }
}
function legacyWriteQueue(q: OfflineAction[]) {
  try { localStorage.setItem(LEGACY_QUEUE_KEY, JSON.stringify(q)); } catch {}
}
function legacyReadApplied(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LEGACY_APPLIED_KEY) || "[]")); } catch { return new Set(); }
}
function legacyWriteApplied(s: Set<string>) {
  try { localStorage.setItem(LEGACY_APPLIED_KEY, JSON.stringify([...s].slice(-200))); } catch {}
}

async function migrateFromLocalStorage() {
  if (dbFailed || !dbReady) return;
  const legacy = legacyReadQueue();
  if (legacy.length === 0) return;
  try {
    await db.actions.bulkPut(legacy);
    const appliedSet = legacyReadApplied();
    if (appliedSet.size > 0) {
      const now = Date.now();
      await db.applied.bulkPut([...appliedSet].map(id => ({ id, ts: now })));
    }
    localStorage.removeItem(LEGACY_QUEUE_KEY);
    localStorage.removeItem(LEGACY_APPLIED_KEY);
    console.log(`[offline-queue] Migrated ${legacy.length} actions from localStorage to IndexedDB`);
  } catch (e) {
    console.warn("[offline-queue] Migration from localStorage failed", e);
  }
}

let migrationDone = false;
async function ensureMigrated() {
  if (migrationDone) return;
  migrationDone = true;
  if (dbReady) await migrateFromLocalStorage();
}

export function enqueueAction(action: Omit<OfflineAction, "id" | "timestamp" | "retries">): OfflineAction {
  const full: OfflineAction = {
    ...action,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    retries: 0,
  };

  if (dbFailed || !dbReady) {
    const q = legacyReadQueue();
    q.push(full);
    const trimmed = q.slice(-MAX_QUEUE);
    legacyWriteQueue(trimmed);
    emitChange(trimmed.length);
    return full;
  }

  db.actions.put(full)
    .then(() => db.actions.count())
    .then(c => emitChange(c))
    .catch(() => {
      const q = legacyReadQueue();
      q.push(full);
      const trimmed = q.slice(-MAX_QUEUE);
      legacyWriteQueue(trimmed);
      emitChange(trimmed.length);
    });

  // Periodic cleanup: удаляем старые (>3 дн) и переполнение очереди
  db.actions.orderBy("timestamp").toArray().then((all) => {
    const cutoff = Date.now() - MAX_ACTION_AGE_MS;
    const toDelete = all.filter(a => a.timestamp < cutoff).map(a => a.id);
    const overflow = all.length - MAX_QUEUE;
    const overflowIds = overflow > 0 ? all.slice(0, overflow).map(a => a.id) : [];
    const ids = Array.from(new Set([...toDelete, ...overflowIds]));
    if (ids.length) db.actions.bulkDelete(ids).catch(() => {});
  }).catch(() => {});

  return full;
}

export async function getQueuedActions(): Promise<OfflineAction[]> {
  await ensureMigrated();
  if (dbFailed || !dbReady) return legacyReadQueue();
  try {
    return await db.actions.orderBy("timestamp").toArray();
  } catch {
    return legacyReadQueue();
  }
}

export async function getQueueCount(): Promise<number> {
  if (dbFailed || !dbReady) return legacyReadQueue().length;
  try {
    return await db.actions.count();
  } catch {
    return legacyReadQueue().length;
  }
}

export function getQueueCountSync(): number {
  return legacyReadQueue().length;
}

export async function removeAction(id: string) {
  if (dbFailed || !dbReady) {
    const q = legacyReadQueue().filter(a => a.id !== id);
    legacyWriteQueue(q);
    emitChange(q.length);
    return;
  }
  try {
    await db.actions.delete(id);
    const c = await db.actions.count();
    emitChange(c);
  } catch {
    const q = legacyReadQueue().filter(a => a.id !== id);
    legacyWriteQueue(q);
    emitChange(q.length);
  }
}

export async function markApplied(actionId: string) {
  if (dbFailed || !dbReady) {
    const s = legacyReadApplied();
    s.add(actionId);
    legacyWriteApplied(s);
    return;
  }
  try {
    await db.applied.put({ id: actionId, ts: Date.now() });
  } catch {
    const s = legacyReadApplied();
    s.add(actionId);
    legacyWriteApplied(s);
  }
}

export async function isAlreadyApplied(actionId: string): Promise<boolean> {
  if (dbFailed || !dbReady) return legacyReadApplied().has(actionId);
  try {
    const entry = await db.applied.get(actionId);
    return !!entry;
  } catch {
    return legacyReadApplied().has(actionId);
  }
}

export async function clearQueue() {
  if (dbFailed || !dbReady) {
    legacyWriteQueue([]);
    emitChange(0);
    return;
  }
  try {
    await db.actions.clear();
    emitChange(0);
  } catch {
    legacyWriteQueue([]);
    emitChange(0);
  }
}

export async function cleanupOldApplied(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  if (dbFailed || !dbReady) return;
  try {
    const cutoff = Date.now() - maxAgeMs;
    await db.applied.where("ts").below(cutoff).delete();
  } catch {}
}

let isSyncing = false;

function getFreshAuthHeader(): string | null {
  try {
    return localStorage.getItem("authToken") || localStorage.getItem("sessionToken") || null;
  } catch {
    return null;
  }
}

export async function syncQueue(
  onSuccess?: (action: OfflineAction) => void,
  onError?: (action: OfflineAction, err: string) => void
): Promise<number> {
  if (isSyncing) return 0;
  isSyncing = true;
  let synced = 0;

  try {
    await ensureMigrated();
    const queue = await getQueuedActions();
    if (queue.length === 0) return 0;

    for (const action of queue) {
      if (await isAlreadyApplied(action.id)) {
        await removeAction(action.id);
        synced++;
        continue;
      }

      try {
        const headers = { ...action.headers, "X-Action-Id": action.id, "X-Offline-Sync": "true" };
        const freshToken = getFreshAuthHeader();
        if (freshToken && headers["Authorization"]) {
          headers["Authorization"] = `Bearer ${freshToken}`;
        }

        const res = await fetch(action.endpoint, {
          method: action.method,
          headers,
          body: action.body || undefined,
        });

        if (res.ok) {
          await markApplied(action.id);
          await removeAction(action.id);
          synced++;
          onSuccess?.(action);
        } else {
          const data = await res.json().catch(() => ({}));
          if (res.status === 409 || data.error === "already_done" || data._replayed) {
            await markApplied(action.id);
            await removeAction(action.id);
            synced++;
          } else if (action.retries >= 3) {
            await removeAction(action.id);
            onError?.(action, data.message || "Ошибка после 3 попыток");
          } else {
            if (dbFailed || !dbReady) {
              const q = legacyReadQueue().map(a => a.id === action.id ? { ...a, retries: a.retries + 1 } : a);
              legacyWriteQueue(q);
            } else {
              try {
                await db.actions.update(action.id, { retries: action.retries + 1 });
              } catch {}
            }
            onError?.(action, data.message || "Ошибка сервера");
          }
        }
      } catch {
        break;
      }
    }
  } finally {
    isSyncing = false;
    const count = await getQueueCount();
    emitChange(count);
  }

  return synced;
}

export function isOnline(): boolean {
  return navigator.onLine;
}

if (typeof window !== "undefined") {
  const initTimer = setInterval(() => {
    if (dbReady) {
      clearInterval(initTimer);
      migrateFromLocalStorage();
      cleanupOldApplied();
    }
    if (dbFailed) clearInterval(initTimer);
  }, 200);
  setTimeout(() => clearInterval(initTimer), 10000);
}
