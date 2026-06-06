import { db, activityLogsTable } from "@workspace/db";

export async function logActivity(
  userId: number,
  userName: string,
  action: string,
  entity: string,
  entityId?: number,
  details?: string,
) {
  try {
    await db.insert(activityLogsTable).values({
      userId, userName: userName || null,
      action, entity, entityId: entityId || null,
      details: details || null,
    });
  } catch {}
}
