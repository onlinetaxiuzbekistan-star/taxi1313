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
  // Sized for the 1000-concurrent-driver workload validated by stress-rampup.
  // At N=1000 the previous max=30 was pinned at 100% utilization the entire
  // run — never starved (queries are fast), but a single slow dispatch query
  // holding a connection while bursts contend would have been a cliff.
  // PostgreSQL max_connections=100 on this host; one app instance + headroom
  // for psql/admin → 60 is the sweet spot. Bump max_connections too before
  // running multiple Node workers.
  max: 60,
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
