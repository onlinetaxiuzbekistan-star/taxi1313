import { Worker, type Job } from "bullmq";
import { bullConnection } from "./connection.js";
import { SMS_QUEUE_NAME, smsQueue, type SmsJobData } from "./sms.queue.js";
import { PUSH_QUEUE_NAME, pushQueue, type PushJobData } from "./push.queue.js";
import { PHOTO_QUEUE_NAME, photoQueue, type PhotoValidationJobData } from "./photo.queue.js";
import { sendSms } from "../sms.js";
import { deliverPushJob } from "../notifications.js";
import { processPhotoValidation } from "../photo-validation-job.js";
import { logger } from "../logger.js";

let smsWorker: Worker<SmsJobData> | undefined;
let pushWorker: Worker<PushJobData> | undefined;
let photoWorker: Worker<PhotoValidationJobData> | undefined;

export function startWorkers(): void {
  if (smsWorker) return;

  smsWorker = new Worker<SmsJobData>(
    SMS_QUEUE_NAME,
    async (job: Job<SmsJobData>) => {
      const { phone, message } = job.data;
      const res = await sendSms(phone, message);
      // SMS globally disabled is an intentional no-op, not a failure — don't retry.
      if (!res.success && res.error !== "sms_disabled") {
        throw new Error(res.error || "sms_send_failed");
      }
      return res;
    },
    {
      connection: bullConnection,
      concurrency: 5,
    },
  );

  smsWorker.on("completed", (job) => {
    logger.debug({ jobId: job.id }, "[BULLMQ] SMS job completed");
  });
  smsWorker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, attempts: job?.attemptsMade, err: err.message },
      "[BULLMQ] SMS job failed",
    );
  });
  smsWorker.on("error", (err) => {
    logger.error({ err: err.message }, "[BULLMQ] SMS worker error");
  });

  pushWorker = new Worker<PushJobData>(
    PUSH_QUEUE_NAME,
    async (job: Job<PushJobData>) => {
      await deliverPushJob(job.data);
    },
    {
      connection: bullConnection,
      concurrency: 5,
    },
  );

  pushWorker.on("completed", (job) => {
    logger.debug({ jobId: job.id }, "[BULLMQ] Push job completed");
  });
  pushWorker.on("failed", (job, err) => {
    // UnrecoverableError = subscription was 410/404 and already removed; not a real failure.
    if (err.name === "UnrecoverableError") {
      logger.debug({ jobId: job?.id, err: err.message }, "[BULLMQ] Push job stopped (expired subscription)");
      return;
    }
    logger.error(
      { jobId: job?.id, attempts: job?.attemptsMade, err: err.message },
      "[BULLMQ] Push job failed",
    );
  });
  pushWorker.on("error", (err) => {
    logger.error({ err: err.message }, "[BULLMQ] Push worker error");
  });

  // Concurrency 1: TensorFlow inference is CPU-bound and shares this process, so
  // serialize jobs to avoid saturating the event loop with parallel inferences.
  photoWorker = new Worker<PhotoValidationJobData>(
    PHOTO_QUEUE_NAME,
    async (job: Job<PhotoValidationJobData>) => {
      await processPhotoValidation(job.data);
    },
    {
      connection: bullConnection,
      concurrency: 1,
    },
  );

  photoWorker.on("completed", (job) => {
    logger.debug({ jobId: job.id }, "[BULLMQ] Photo validation job completed");
  });
  photoWorker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, attempts: job?.attemptsMade, err: err.message },
      "[BULLMQ] Photo validation job failed",
    );
  });
  photoWorker.on("error", (err) => {
    logger.error({ err: err.message }, "[BULLMQ] Photo worker error");
  });

  logger.info("[BULLMQ] Workers started (sms, push, photo)");
}

export async function stopWorkers(): Promise<void> {
  try {
    if (smsWorker) {
      await smsWorker.close();
      smsWorker = undefined;
    }
    if (pushWorker) {
      await pushWorker.close();
      pushWorker = undefined;
    }
    if (photoWorker) {
      await photoWorker.close();
      photoWorker = undefined;
    }
    await smsQueue.close();
    await pushQueue.close();
    await photoQueue.close();
    logger.info("[BULLMQ] Workers stopped");
  } catch (err) {
    logger.error({ err }, "[BULLMQ] Error stopping workers");
  }
}
