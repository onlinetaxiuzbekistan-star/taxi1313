// @ts-nocheck
import { Queue, type JobsOptions } from "bullmq";
import { bullConnection } from "./connection.js";

export const SMS_QUEUE_NAME = "sms";

export interface SmsJobData {
  phone: string;
  message: string;
}

export const smsQueue = new Queue<SmsJobData>(SMS_QUEUE_NAME, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600 },
  },
});

export async function enqueueSms(phone: string, message: string, opts?: JobsOptions) {
  return smsQueue.add("send", { phone, message }, opts);
}
