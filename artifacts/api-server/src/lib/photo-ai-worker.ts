/**
 * worker_threads entry for photo-AI validation.
 *
 * TensorFlow (BlazeFace) inference and Tesseract OCR are CPU-bound and
 * synchronous enough to stall the event loop of whatever process runs them.
 * This module runs them off the main thread: the main thread posts a photo
 * set, this worker runs validatePhotos() and posts the result back.
 *
 * Built as a standalone bundle (dist/photo-ai-worker.mjs) by build.mjs.
 */
import { parentPort } from "node:worker_threads";
import { validatePhotos, warmupModels } from "./photo-ai-validator.js";
import { errorMessage } from "./errors.js";

if (!parentPort) {
  throw new Error("photo-ai-worker must be run as a worker thread");
}
const port = parentPort;

interface WorkerRequest {
  id: number;
  type: "validate" | "warmup";
  urls?: { selfieUrl: string; carFrontUrl: string; carBackUrl: string; interiorUrl: string };
}

port.on("message", async (msg: WorkerRequest) => {
  try {
    if (msg.type === "validate") {
      if (!msg.urls) throw new Error("validate request missing urls");
      const result = await validatePhotos(msg.urls);
      port.postMessage({ id: msg.id, ok: true, result });
    } else if (msg.type === "warmup") {
      await warmupModels();
      port.postMessage({ id: msg.id, ok: true });
    } else {
      port.postMessage({ id: msg.id, ok: false, error: `unknown message type: ${(msg as { type: string }).type}` });
    }
  } catch (err) {
    port.postMessage({ id: msg.id, ok: false, error: errorMessage(err) });
  }
});
