// @ts-nocheck
import { Queue } from "bullmq";
import { bullConnection } from "./connection.js";

export const PHOTO_QUEUE_NAME = "photo-validation";

export interface PhotoValidationJobData {
  requestId: number;
  driverId: number;
  taskId: number | null;
  selfieUrl: string;
  carFrontUrl: string;
  carBackUrl: string;
  interiorUrl: string;
  retryCount: number;
}

export const photoQueue = new Queue<PhotoValidationJobData>(PHOTO_QUEUE_NAME, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: { age: 3600, count: 500 },
    removeOnFail: { age: 24 * 3600 },
  },
});

export async function enqueuePhotoValidation(data: PhotoValidationJobData) {
  return photoQueue.add("validate", data);
}
