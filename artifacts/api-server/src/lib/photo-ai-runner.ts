/**
 * Main-thread client for the photo-AI worker thread.
 *
 * Lazily spawns a single long-lived worker_threads Worker that owns the
 * TensorFlow/Tesseract models, and proxies validation requests to it over the
 * message channel. Keeping the worker resident avoids re-loading the models per
 * request; running it off-thread keeps TF inference from blocking the event loop.
 */
import { Worker } from "node:worker_threads";
import { clog } from "./logger.js";
import { errorMessage } from "./errors.js";
import type { AIValidationResult } from "./photo-ai-validator.js";

export interface PhotoUrls {
  selfieUrl: string;
  carFrontUrl: string;
  carBackUrl: string;
  interiorUrl: string;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: AIValidationResult;
  error?: string;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;

  // Bundled as a sibling of the entry (dist/photo-ai-worker.mjs); resolve
  // relative to this module's location so it works regardless of cwd.
  const workerUrl = new URL("./photo-ai-worker.mjs", import.meta.url);
  const w = new Worker(workerUrl);

  w.on("message", (msg: WorkerResponse) => {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error || "photo worker error"));
  });

  const failAll = (err: Error) => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker = null;
  };

  w.on("error", (err) => {
    clog.error("[PHOTO-WORKER] worker error:", errorMessage(err));
    failAll(err instanceof Error ? err : new Error(String(err)));
  });
  w.on("exit", (code) => {
    if (code !== 0) clog.error(`[PHOTO-WORKER] exited with code ${code}`);
    failAll(new Error(`photo worker exited (code ${code})`));
  });

  worker = w;
  return w;
}

function send<T>(type: "validate" | "warmup", payload: Record<string, unknown>): Promise<T> {
  const w = getWorker();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, type, ...payload });
  });
}

export function validatePhotosInWorker(urls: PhotoUrls): Promise<AIValidationResult> {
  return send<AIValidationResult>("validate", { urls });
}

export async function warmupPhotoWorker(): Promise<void> {
  try {
    await send<void>("warmup", {});
    clog.log("[PHOTO-WORKER] models warmed up in worker thread");
  } catch (err) {
    clog.error("[PHOTO-WORKER] warmup failed:", errorMessage(err));
  }
}
