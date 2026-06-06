import { Queue } from "bullmq";
import { bullConnection } from "./connection.js";

export const PUSH_QUEUE_NAME = "push";

// One job per subscription: 410/404 handling and retries are per-endpoint, so
// fanning a user out into subscription-sized jobs keeps retries from
// re-delivering to healthy endpoints.
export interface PushJobData {
  userId: number;
  subId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  payload: {
    title: string;
    body: string;
    icon?: string;
    badge?: string;
    data?: Record<string, string>;
  };
}

export const pushQueue = new Queue<PushJobData>(PUSH_QUEUE_NAME, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600 },
  },
});

export async function enqueuePushJob(data: PushJobData) {
  return pushQueue.add("send", data);
}
