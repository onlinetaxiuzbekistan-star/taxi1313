/**
 * Photo-AI validation job processor.
 *
 * The TensorFlow inference in validatePhotos() is CPU-heavy; running it on the
 * request thread blocked event-loop latency for every concurrent request. This
 * runs it from a BullMQ worker instead — the submit endpoint returns 202 and the
 * result is written here, then pushed to the driver over WebSocket. The inference
 * itself is further offloaded to a worker_threads Worker (photo-ai-runner) so TF
 * never blocks this process's event loop either.
 */
import { db, photoRequestsTable, photoHistoryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { validatePhotosInWorker } from "./photo-ai-runner.js";
import { broadcastToUser } from "./websocket.js";
import { logger } from "./logger.js";
import type { PhotoValidationJobData } from "./queues/photo.queue.js";

export async function processPhotoValidation(data: PhotoValidationJobData): Promise<void> {
  const { requestId: id, driverId, taskId, selfieUrl, carFrontUrl, carBackUrl, interiorUrl, retryCount } = data;

  const aiResult = await validatePhotosInWorker({ selfieUrl, carFrontUrl, carBackUrl, interiorUrl });

  const historyEntries = [
    { driverId, requestId: id, photoType: "selfie", url: selfieUrl },
    { driverId, requestId: id, photoType: "car_front", url: carFrontUrl },
    { driverId, requestId: id, photoType: "car_back", url: carBackUrl },
    { driverId, requestId: id, photoType: "interior", url: interiorUrl },
  ];

  if (aiResult.overallStatus === "fail") {
    const failReasons = aiResult.photos
      .filter((p) => p.aiStatus === "fail")
      .map((p) => p.aiComment)
      .join("; ");

    const newRetryAfterAI = retryCount + 1;
    const isFinalAfterAI = newRetryAfterAI >= 2;

    const txResult = await db.transaction(async (tx) => {
      const [updated] = await tx.update(photoRequestsTable).set({
        selfieUrl, carFrontUrl, carBackUrl, interiorUrl,
        status: isFinalAfterAI ? "rejected_final" : "rejected_auto",
        aiResults: aiResult,
        aiStatus: aiResult.overallStatus,
        retryCount: newRetryAfterAI,
        rejectReason: failReasons || "Фото не прошли автоматическую проверку",
        updatedAt: new Date(),
      }).where(eq(photoRequestsTable.id, id)).returning();

      await tx.insert(photoHistoryTable).values(historyEntries);

      let newRequestId: number | null = null;
      if (!isFinalAfterAI) {
        const [newReq] = await tx.insert(photoRequestsTable).values({
          driverId,
          taskId,
          status: "pending",
          retryCount: newRetryAfterAI,
          rejectReason: failReasons || "Исправьте фото и отправьте заново",
          previousRequestId: id,
        }).returning();
        newRequestId = newReq.id;
      }

      return { updated, newRequestId };
    });

    if (!isFinalAfterAI && txResult.newRequestId) {
      broadcastToUser(driverId, {
        type: "photo_control_rejected",
        reason: failReasons || "Фото не прошли автоматическую проверку",
        blocked: false,
        retryCount: newRetryAfterAI,
        aiResults: aiResult,
        newRequestId: txResult.newRequestId,
      });
    } else {
      broadcastToUser(driverId, {
        type: "photo_control_rejected",
        reason: "Доступ временно ограничен до одобрения фотоконтроля",
        blocked: true,
        retryCount: newRetryAfterAI,
        aiResults: aiResult,
      });
    }

    logger.info({ requestId: id, driverId, status: isFinalAfterAI ? "rejected_final" : "rejected_auto" }, "[PHOTO-AI] validation failed");
    return;
  }

  await db.update(photoRequestsTable).set({
    selfieUrl, carFrontUrl, carBackUrl, interiorUrl,
    status: "under_review",
    aiResults: aiResult,
    aiStatus: aiResult.overallStatus,
    updatedAt: new Date(),
  }).where(eq(photoRequestsTable.id, id));

  await db.insert(photoHistoryTable).values(historyEntries);

  broadcastToUser(driverId, {
    type: "photo_control_under_review",
    requestId: id,
    aiResults: aiResult,
  });

  logger.info({ requestId: id, driverId }, "[PHOTO-AI] validation passed → under_review");
}
