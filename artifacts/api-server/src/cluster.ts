/**
 * Cluster entry point. Forks CLUSTER_WORKERS workers (default = CPU count); each worker
 * runs the normal server (./index.js) and they share the listening port via the Node
 * cluster module. Exactly one worker is marked WORKER_PRIMARY=1 so singleton services
 * (dispatch sweep, schedulers, queue consumers, DB seed) run once cluster-wide; if the
 * primary dies, its respawn inherits the primary role (failover).
 *
 * Live production keeps starting `node dist/index.mjs` directly (single process), so
 * this file is inert until the systemd ExecStart is switched to `dist/cluster.mjs` at
 * cutover — making rollback a one-line revert.
 */
import cluster from "node:cluster";
import os from "node:os";
import { logger } from "./lib/logger.js";

const WORKERS = Number(process.env.CLUSTER_WORKERS) || os.cpus().length;
// Safety switch for off-prod testing against the shared DB/Redis: when set, NO worker
// becomes primary, so singleton services (dispatch sweep, queue consumers, schedulers,
// seed) never run — the test instance only serves WS/HTTP and can't touch live data.
const NO_PRIMARY = process.env.CLUSTER_NO_PRIMARY === "1";
let primaryWorkerId: number | null = null;

function fork(isPrimary: boolean) {
  const worker = cluster.fork({ WORKER_PRIMARY: isPrimary ? "1" : "0" });
  if (isPrimary) primaryWorkerId = worker.id;
  logger.info({ pid: worker.process.pid, id: worker.id, primary: isPrimary }, "[CLUSTER] worker forked");
  return worker;
}

if (cluster.isPrimary) {
  logger.info({ workers: WORKERS, noPrimary: NO_PRIMARY }, "[CLUSTER] primary starting workers");
  for (let i = 0; i < WORKERS; i++) fork(!NO_PRIMARY && i === 0);

  cluster.on("exit", (worker, code, signal) => {
    const wasPrimary = worker.id === primaryWorkerId;
    logger.warn({ pid: worker.process.pid, id: worker.id, code, signal, wasPrimary }, "[CLUSTER] worker died → respawning");
    // If the primary died, the respawn takes over the primary role (failover).
    fork(wasPrimary && !NO_PRIMARY);
  });
} else {
  // Worker process: run the full server bootstrap (listen + WebSocket + gated services).
  import("./index.js");
}
