import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, usersTable, rolePermissionsTable, permissionsTable, driverSessionsTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { JWT_SECRET } from "../lib/jwt-secret.js";

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
  sessionId?: string;
  /**
   * Branch scope of the authenticated user.
   * NULL/undefined = global (admin or legacy dispatcher with no branch).
   * Number       = strict branch scope (only sees own-branch data).
   */
  userBranchId?: number | null;
}

const sessionValidCache = new Map<string, { valid: boolean; ts: number }>();
const SESSION_CHECK_TTL = 10_000;

// Branch-id cache, keyed by userId. 60s TTL — same convention as permCache below.
const branchCache = new Map<number, { branchId: number | null; ts: number }>();
const BRANCH_CACHE_TTL = 60_000;

async function loadUserBranchId(userId: number): Promise<number | null> {
  const cached = branchCache.get(userId);
  if (cached && Date.now() - cached.ts < BRANCH_CACHE_TTL) return cached.branchId;
  try {
    const [u] = await db.select({ branchId: usersTable.branchId })
      .from(usersTable).where(eq(usersTable.id, userId));
    const v = u?.branchId ?? null;
    branchCache.set(userId, { branchId: v, ts: Date.now() });
    return v;
  } catch {
    return null;
  }
}

export function invalidateBranchCache(userId?: number) {
  if (userId) branchCache.delete(userId);
  else branchCache.clear();
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized", message: "No token provided" });
    return;
  }

  try {
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; role: string; sid?: string };
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    req.sessionId = decoded.sid;

    if (decoded.role === "driver" && !decoded.sid) {
      res.status(401).json({ error: "session_expired", message: "Driver token must include a session" });
      return;
    }

    if (decoded.role === "driver" && decoded.sid) {
      const cacheKey = `${decoded.userId}:${decoded.sid}`;
      const cached = sessionValidCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < SESSION_CHECK_TTL) {
        if (!cached.valid) {
          res.status(401).json({ error: "session_expired", message: "Session expired or replaced" });
          return;
        }
        // Drivers also get branchId loaded so completion/match flows can use it later.
        req.userBranchId = await loadUserBranchId(decoded.userId);
        next();
        return;
      }

      const [session] = await db.select({ id: driverSessionsTable.id })
        .from(driverSessionsTable)
        .where(and(
          eq(driverSessionsTable.driverId, decoded.userId),
          eq(driverSessionsTable.sessionToken, decoded.sid),
          gt(driverSessionsTable.expiresAt, new Date())
        ))
        .limit(1);

      if (!session) {
        sessionValidCache.set(cacheKey, { valid: false, ts: Date.now() });
        res.status(401).json({ error: "session_expired", message: "Session expired or replaced" });
        return;
      }

      sessionValidCache.set(cacheKey, { valid: true, ts: Date.now() });
      db.update(driverSessionsTable)
        .set({ lastActiveAt: new Date() })
        .where(eq(driverSessionsTable.id, session.id))
        .catch(() => {});
    }

    // Load branchId for staff/admin/dispatcher (and drivers above already handled).
    if (decoded.role !== "driver") {
      req.userBranchId = await loadUserBranchId(decoded.userId);
    }

    next();
  } catch {
    res.status(401).json({ error: "unauthorized", message: "Invalid token" });
  }
}

export function invalidateSessionCache(driverId: number) {
  for (const [key] of sessionValidCache) {
    if (key.startsWith(`${driverId}:`)) {
      sessionValidCache.delete(key);
    }
  }
}

export function requireRole(...roles: (string | string[])[]) {
  const flat = roles.flat();
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole || !flat.includes(req.userRole)) {
      res.status(403).json({ error: "forbidden", message: "Insufficient permissions" });
      return;
    }
    next();
  };
}

const permCache = new Map<number, { keys: Set<string>; ts: number }>();
const CACHE_TTL = 60_000;

async function loadPermissions(userId: number): Promise<Set<string>> {
  const cached = permCache.get(userId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.keys;

  const [user] = await db.select({ roleId: usersTable.roleId, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return new Set();

  if (user.role === "admin") {
    const all = await db.select({ key: permissionsTable.key }).from(permissionsTable);
    const keys = new Set(all.map(p => p.key));
    permCache.set(userId, { keys, ts: Date.now() });
    return keys;
  }

  if (!user.roleId) return new Set();

  const rows = await db
    .select({ key: permissionsTable.key })
    .from(rolePermissionsTable)
    .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
    .where(eq(rolePermissionsTable.roleId, user.roleId));

  const keys = new Set(rows.map(r => r.key));
  permCache.set(userId, { keys, ts: Date.now() });
  return keys;
}

import { registerCache } from "../lib/memory-guardian.js";
registerCache(() => {
  const before = permCache.size;
  permCache.clear();
  return { name: "permCache", cleared: before };
});
registerCache(() => {
  const before = sessionValidCache.size;
  sessionValidCache.clear();
  return { name: "sessionValidCache", cleared: before };
});
registerCache(() => {
  const before = branchCache.size;
  branchCache.clear();
  return { name: "branchCache", cleared: before };
});

export function invalidatePermCache(userId?: number) {
  if (userId) permCache.delete(userId);
  else permCache.clear();
}

export function requirePermission(...permKeys: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (req.userRole === "admin") {
      next();
      return;
    }
    try {
      const perms = await loadPermissions(req.userId);
      const hasAll = permKeys.every(k => perms.has(k));
      if (!hasAll) {
        res.status(403).json({ error: "forbidden", message: "Insufficient permissions" });
        return;
      }
      next();
    } catch {
      res.status(500).json({ error: "server_error" });
    }
  };
}
