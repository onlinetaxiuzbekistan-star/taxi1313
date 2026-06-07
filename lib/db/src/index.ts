import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Sized for peak combined load (2000+ drivers + operators). The 1500-driver
  // stress run starved at max=60 (53 requests queued for a connection, p99 hit
  // the 15s timeout). PostgreSQL max_connections raised 100→250, so a single app
  // instance can safely hold 150 with ~100 headroom for psql/admin.
  // NOTE: when moving to Node clustering, divide this across workers
  // (e.g. 250 / 16 ≈ 14 per worker) so the cluster stays under max_connections.
  max: Number(process.env.DB_POOL_MAX) || 150,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  allowExitOnIdle: false,
});

let slowQueryCallback: ((query: string, durationMs: number) => void) | null = null;

export function onSlowQuery(cb: (query: string, durationMs: number) => void) {
  slowQueryCallback = cb;
}

let poolErrorCallback: ((err: Error) => void) | null = null;

export function onPoolError(cb: (err: Error) => void) {
  poolErrorCallback = cb;
}

// Without this listener, an error on an idle pooled client (e.g. the DB dropping
// the connection) is emitted on the pool and, if unhandled, crashes the process
// via 'uncaughtException'. Handle it: log + forward to the registered callback.
pool.on("error", (err) => {
  console.error("[DB POOL] Unexpected idle client error:", err.message);
  try {
    poolErrorCallback?.(err);
  } catch {
    /* never let the error handler throw */
  }
});

const origQuery = pool.query.bind(pool);
(pool as any).query = function (...args: any[]) {
  const start = performance.now();
  const result = (origQuery as any)(...args);
  if (result && typeof result.then === "function") {
    result.then(() => {
      const dur = performance.now() - start;
      if (dur >= 100 && slowQueryCallback) {
        const queryText = typeof args[0] === "string" ? args[0] : args[0]?.text || "unknown";
        slowQueryCallback(queryText, dur);
      }
    }).catch(() => {});
  }
  return result;
};

export const db = drizzle(pool, { schema });

export * from "./schema";
