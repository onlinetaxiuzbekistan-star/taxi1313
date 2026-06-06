// @ts-nocheck
import { db, photoTasksTable, photoRequestsTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "./logger.js";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startPhotoScheduler() {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(runScheduler, 60 * 60 * 1000);
  setTimeout(runScheduler, 5000);
  logger.info("[PHOTO SCHEDULER] Started (hourly check)");
}

async function runScheduler() {
  try {
    const activeTasks = await db.select().from(photoTasksTable)
      .where(and(eq(photoTasksTable.isActive, true)));

    const now = new Date();
    const dayOfWeek = now.getDay();
    const hour = now.getHours();

    for (const task of activeTasks) {
      let shouldCreate = false;

      if (task.scheduleType === "daily" && hour >= 6 && hour < 7) {
        shouldCreate = true;
      } else if (task.scheduleType === "weekly" && dayOfWeek === 1 && hour >= 6 && hour < 7) {
        shouldCreate = true;
      }

      if (!shouldCreate) continue;

      let drivers;
      if (task.groupId) {
        drivers = await db.select({ id: usersTable.id }).from(usersTable)
          .where(and(eq(usersTable.role, "driver"), eq(usersTable.groupId, task.groupId)));
      } else {
        drivers = await db.select({ id: usersTable.id }).from(usersTable)
          .where(eq(usersTable.role, "driver"));
      }

      if (drivers.length === 0) continue;

      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      const existing = await db.select({ driverId: photoRequestsTable.driverId })
        .from(photoRequestsTable)
        .where(and(
          eq(photoRequestsTable.taskId, task.id),
          eq(photoRequestsTable.status, "pending"),
          sql`${photoRequestsTable.createdAt} >= ${todayStart}`,
        ));
      const existingSet = new Set(existing.map(e => e.driverId));

      const toCreate = drivers.filter(d => !existingSet.has(d.id));
      if (toCreate.length === 0) continue;

      await db.insert(photoRequestsTable).values(
        toCreate.map(d => ({
          driverId: d.id,
          taskId: task.id,
          status: "pending",
        }))
      );

      logger.info({ taskId: task.id, taskName: task.name, created: toCreate.length },
        "[PHOTO SCHEDULER] Auto-created photo requests");
    }
  } catch (err) {
    logger.error({ err }, "[PHOTO SCHEDULER] Error running scheduler");
  }
}

export function stopPhotoScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
