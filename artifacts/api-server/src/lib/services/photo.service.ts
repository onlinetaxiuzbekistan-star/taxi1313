/**
 * Photo-control service — data-access for photo tasks, requests and history.
 * Keeps raw DB calls out of the route handlers; HTTP/business orchestration
 * (validation, websocket broadcasts, queue enqueue, file handling) stays in
 * the route. This is the data-access seam.
 */
import { db, photoTasksTable, photoRequestsTable, usersTable, driverGroupsTable } from "@workspace/db";
import { eq, and, desc, inArray, sql, or, ilike, type SQL } from "drizzle-orm";

// --- Tasks -----------------------------------------------------------------

export async function listTasks() {
  return db.select().from(photoTasksTable).orderBy(desc(photoTasksTable.createdAt));
}

export async function listDriverGroups() {
  return db.select().from(driverGroupsTable);
}

export async function createTask(values: typeof photoTasksTable.$inferInsert) {
  const [task] = await db.insert(photoTasksTable).values(values).returning();
  return task;
}

export async function updateTask(id: number, updates: Partial<typeof photoTasksTable.$inferInsert>) {
  const [updated] = await db.update(photoTasksTable).set(updates).where(eq(photoTasksTable.id, id)).returning();
  return updated;
}

export async function deleteTask(id: number) {
  const [deleted] = await db.delete(photoTasksTable).where(eq(photoTasksTable.id, id)).returning();
  return deleted;
}

export async function getTask(id: number) {
  const [task] = await db.select().from(photoTasksTable).where(eq(photoTasksTable.id, id));
  return task;
}

// --- Sending tasks to drivers ---------------------------------------------

export async function getDriverIdsByGroup(groupId: number) {
  return db.select({ id: usersTable.id }).from(usersTable)
    .where(and(eq(usersTable.role, "driver"), eq(usersTable.groupId, groupId)));
}

export async function getAllDriverIds() {
  return db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.role, "driver"));
}

export async function getActiveRequestDriverIds(driverIds: number[]) {
  return db.select({ driverId: photoRequestsTable.driverId })
    .from(photoRequestsTable)
    .where(and(
      inArray(photoRequestsTable.driverId, driverIds),
      inArray(photoRequestsTable.status, ["pending", "under_review"]),
    ));
}

export async function createPendingRequests(values: (typeof photoRequestsTable.$inferInsert)[]) {
  await db.insert(photoRequestsTable).values(values);
}

// --- Requests listing ------------------------------------------------------

export async function getMatchingDriverIds(opts: { search?: string; groupId?: string; city?: string }) {
  const driverConditions: (SQL | undefined)[] = [eq(usersTable.role, "driver")];
  if (opts.search) {
    const s = `%${opts.search}%`;
    driverConditions.push(or(
      ilike(usersTable.name, s),
      ilike(usersTable.phone, s),
      ilike(usersTable.carNumber, s),
      ilike(usersTable.city, s),
    ));
  }
  if (opts.groupId) driverConditions.push(eq(usersTable.groupId, parseInt(opts.groupId)));
  if (opts.city) driverConditions.push(ilike(usersTable.city, opts.city));

  const matchedDrivers = await db.select({ id: usersTable.id }).from(usersTable)
    .where(and(...driverConditions));
  return matchedDrivers.map(d => d.id);
}

export async function countLatestRequests(opts: {
  statusFilter: string | null;
  taskIdFilter: number | null;
  searchDriverIds: number[] | null;
}) {
  const latestSubquery = buildLatestRequestsSubquery(opts);
  const countResult = await db.execute(sql`SELECT count(*)::int AS total FROM (${latestSubquery}) sub`);
  return (countResult.rows[0] as any)?.total || 0;
}

export async function getLatestRequestsPage(opts: {
  statusFilter: string | null;
  taskIdFilter: number | null;
  searchDriverIds: number[] | null;
  perPage: number;
  offset: number;
}) {
  const latestSubquery = buildLatestRequestsSubquery(opts);
  const requestsResult = await db.execute(sql`
    SELECT * FROM (${latestSubquery}) sub
    ORDER BY sub.created_at DESC
    LIMIT ${opts.perPage} OFFSET ${opts.offset}
  `);
  return requestsResult.rows as any[];
}

function buildLatestRequestsSubquery(opts: {
  statusFilter: string | null;
  taskIdFilter: number | null;
  searchDriverIds: number[] | null;
}) {
  const { statusFilter, taskIdFilter, searchDriverIds } = opts;
  return sql`
    SELECT DISTINCT ON (driver_id) *
    FROM photo_requests
    WHERE TRUE
    ${statusFilter ? sql`AND status = ${statusFilter}` : sql``}
    ${taskIdFilter ? sql`AND task_id = ${taskIdFilter}` : sql``}
    ${searchDriverIds && searchDriverIds.length > 0
      ? sql`AND driver_id IN (${sql.join(searchDriverIds.map((id) => sql`${id}`), sql`, `)})`
      : sql``}
    AND status != 'unblocked'
    ORDER BY driver_id, created_at DESC
  `;
}

export async function getDriversByIds(driverIds: number[]) {
  return db.select({
    id: usersTable.id, name: usersTable.name, phone: usersTable.phone,
    carBrand: usersTable.carBrand, carModel: usersTable.carModel, carNumber: usersTable.carNumber,
    groupId: usersTable.groupId, city: usersTable.city,
    lastSelfieUrl: usersTable.lastSelfieUrl,
    lastCarFrontUrl: usersTable.lastCarFrontUrl,
    lastCarBackUrl: usersTable.lastCarBackUrl,
    lastInteriorUrl: usersTable.lastInteriorUrl,
  }).from(usersTable).where(inArray(usersTable.id, driverIds));
}

export async function getGroupsByIds(groupIds: number[]) {
  return db.select({ id: driverGroupsTable.id, label: driverGroupsTable.label })
    .from(driverGroupsTable).where(inArray(driverGroupsTable.id, groupIds));
}

// --- Single request review -------------------------------------------------

export async function getRequest(id: number) {
  const [request] = await db.select().from(photoRequestsTable).where(eq(photoRequestsTable.id, id));
  return request;
}

export async function approveRequest(id: number, comment: string | null, reviewedBy: number | null) {
  const [updated] = await db.update(photoRequestsTable).set({
    status: "approved",
    comment: comment || null,
    rejectReason: null,
    retryCount: 0,
    reviewedBy,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(photoRequestsTable.id, id)).returning();
  return updated;
}

export async function updateDriverLastPhotos(driverId: number, photoUpdates: Partial<typeof usersTable.$inferInsert>) {
  await db.update(usersTable).set(photoUpdates).where(eq(usersTable.id, driverId));
}

export async function rejectRequest(id: number, finalStatus: string, comment: string | null, newRetryCount: number, reviewedBy: number | null) {
  const [updated] = await db.update(photoRequestsTable).set({
    status: finalStatus as any,
    comment: comment || null,
    rejectReason: comment || null,
    retryCount: newRetryCount,
    reviewedBy,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(photoRequestsTable.id, id)).returning();
  return updated;
}

export async function createRetryRequest(values: typeof photoRequestsTable.$inferInsert) {
  const [newRequest] = await db.insert(photoRequestsTable).values(values).returning();
  return newRequest;
}

// --- Bulk review -----------------------------------------------------------

export async function getReviewableRequests(ids: number[]) {
  return db.select().from(photoRequestsTable)
    .where(and(
      inArray(photoRequestsTable.id, ids),
      inArray(photoRequestsTable.status, ["pending", "under_review"]),
    ));
}

export async function approveRequestById(id: number, comment: string | null, reviewedBy: number | null) {
  await db.update(photoRequestsTable).set({
    status: "approved",
    comment: comment || null,
    rejectReason: null,
    retryCount: 0,
    reviewedBy,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(photoRequestsTable.id, id));
}

export async function rejectRequestById(id: number, isFinalReject: boolean, comment: string | null, newRetryCount: number, reviewedBy: number | null) {
  await db.update(photoRequestsTable).set({
    status: isFinalReject ? "rejected_final" : "rejected",
    comment: comment || null,
    rejectReason: comment || null,
    retryCount: newRetryCount,
    reviewedBy,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(photoRequestsTable.id, id));
}

export async function insertRetryRequest(values: typeof photoRequestsTable.$inferInsert) {
  await db.insert(photoRequestsTable).values(values);
}

// --- Driver-facing pending request ----------------------------------------

export async function getLatestRequestForDriver(driverId: number) {
  const [latest] = await db.select().from(photoRequestsTable)
    .where(eq(photoRequestsTable.driverId, driverId))
    .orderBy(desc(photoRequestsTable.createdAt))
    .limit(1);
  return latest;
}

export async function getRequestForDriver(id: number, driverId: number) {
  const [request] = await db.select().from(photoRequestsTable)
    .where(and(eq(photoRequestsTable.id, id), eq(photoRequestsTable.driverId, driverId)));
  return request;
}

export async function submitPhotos(id: number, photos: {
  selfieUrl: string; carFrontUrl: string; carBackUrl: string; interiorUrl: string;
}) {
  await db.update(photoRequestsTable).set({
    selfieUrl: photos.selfieUrl,
    carFrontUrl: photos.carFrontUrl,
    carBackUrl: photos.carBackUrl,
    interiorUrl: photos.interiorUrl,
    aiStatus: "processing",
    updatedAt: new Date(),
  }).where(eq(photoRequestsTable.id, id));
}

// --- History & stats -------------------------------------------------------

export async function getDriverHistory(driverId: number, limit: number, excludeId: number | null) {
  const result = await db.execute(sql`
    SELECT id, driver_id AS "driverId", task_id AS "taskId", status,
           selfie_url AS "selfieUrl", car_front_url AS "carFrontUrl",
           car_back_url AS "carBackUrl", interior_url AS "interiorUrl",
           comment, reject_reason AS "rejectReason",
           retry_count AS "retryCount",
           ai_results AS "aiResults", ai_status AS "aiStatus",
           reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt",
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM photo_requests
    WHERE driver_id = ${driverId}
      AND status NOT IN ('pending', 'unblocked')
      AND (selfie_url IS NOT NULL OR car_front_url IS NOT NULL
           OR car_back_url IS NOT NULL OR interior_url IS NOT NULL)
      ${excludeId !== null ? sql`AND id <> ${excludeId}` : sql``}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  return result.rows;
}

export async function getStats() {
  const result = await db.execute(sql`
    SELECT
      count(*)::int AS total,
      count(*) filter (where status = 'pending')::int AS pending,
      count(*) filter (where status = 'under_review')::int AS "underReview",
      count(*) filter (where status = 'approved')::int AS approved,
      count(*) filter (where status = 'rejected')::int AS rejected,
      count(*) filter (where status = 'rejected_auto')::int AS "rejectedAuto",
      count(*) filter (where status = 'rejected_final')::int AS "rejectedFinal",
      count(*) filter (where selfie_url is not null)::int AS "withPhotos"
    FROM (
      SELECT DISTINCT ON (driver_id) status, selfie_url
      FROM photo_requests
      WHERE status != 'unblocked'
      ORDER BY driver_id, created_at DESC
    ) sub
  `);
  return result.rows[0] || {};
}

// --- Unblock (transactional) ----------------------------------------------

export async function unblockRequest(id: number, driverId: number, taskId: number | null) {
  await db.transaction(async (tx) => {
    await tx.update(photoRequestsTable)
      .set({ retryCount: 0, status: "unblocked", rejectReason: null, updatedAt: new Date() })
      .where(eq(photoRequestsTable.id, id));

    const [existingPending] = await tx.select({ id: photoRequestsTable.id })
      .from(photoRequestsTable)
      .where(and(
        eq(photoRequestsTable.driverId, driverId),
        eq(photoRequestsTable.status, "pending"),
      ))
      .limit(1);

    if (!existingPending) {
      await tx.insert(photoRequestsTable).values({
        driverId,
        taskId,
        status: "pending",
        retryCount: 0,
        previousRequestId: id,
      });
    }
  });
}

// --- Request a specific driver --------------------------------------------

export async function getDriverRole(driverId: number) {
  const [driver] = await db.select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, driverId));
  return driver;
}

export async function getActiveRequestForDriver(driverId: number) {
  const [existing] = await db.select({ id: photoRequestsTable.id, status: photoRequestsTable.status })
    .from(photoRequestsTable)
    .where(and(
      eq(photoRequestsTable.driverId, driverId),
      inArray(photoRequestsTable.status, ["pending", "under_review"]),
    ))
    .limit(1);
  return existing;
}

export async function createRequestForDriver(values: typeof photoRequestsTable.$inferInsert) {
  const [created] = await db.insert(photoRequestsTable).values(values).returning({ id: photoRequestsTable.id });
  return created;
}

export async function getLatestActiveRequestForDriver(driverId: number) {
  const [active] = await db.select({
    id: photoRequestsTable.id,
    status: photoRequestsTable.status,
    createdAt: photoRequestsTable.createdAt,
  }).from(photoRequestsTable)
    .where(and(
      eq(photoRequestsTable.driverId, driverId),
      inArray(photoRequestsTable.status, ["pending", "under_review"]),
    ))
    .orderBy(desc(photoRequestsTable.createdAt))
    .limit(1);
  return active;
}

export async function cancelPendingRequests(driverId: number) {
  return db.delete(photoRequestsTable)
    .where(and(
      eq(photoRequestsTable.driverId, driverId),
      eq(photoRequestsTable.status, "pending"),
    ))
    .returning({ id: photoRequestsTable.id });
}
