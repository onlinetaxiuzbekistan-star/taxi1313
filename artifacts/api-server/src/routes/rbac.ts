import { Router, type IRouter } from "express";
import { db, rolesTable, permissionsTable, rolePermissionsTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { authMiddleware, requireRole, AuthRequest, invalidatePermCache } from "../middlewares/auth.js";
import { logActivity } from "../lib/activity.js";

const router: IRouter = Router();

router.get("/permissions", authMiddleware, requireRole("admin", "dispatcher"), async (_req, res) => {
  try {
    const perms = await db.select().from(permissionsTable);
    res.json({ permissions: perms });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/roles", authMiddleware, requireRole("admin", "dispatcher"), async (_req, res) => {
  try {
    const roles = await db.select().from(rolesTable);
    const rp = await db.select().from(rolePermissionsTable);
    const result = roles.map(r => ({
      ...r,
      permissionIds: rp.filter(x => x.roleId === r.id).map(x => x.permissionId),
    }));
    res.json({ roles: result });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

async function validatePermissionIds(ids: number[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const existing = await db.select({ id: permissionsTable.id }).from(permissionsTable).where(inArray(permissionsTable.id, ids));
  return existing.length === ids.length;
}

router.post("/roles", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const { name, description, permissionIds } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ error: "validation_error", message: "Название роли обязательно" });
      return;
    }

    const pids: number[] = Array.isArray(permissionIds) ? permissionIds.map(Number).filter(n => !isNaN(n)) : [];
    if (pids.length > 0 && !(await validatePermissionIds(pids))) {
      res.status(400).json({ error: "validation_error", message: "Некоторые права не найдены" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [role] = await tx.insert(rolesTable).values({
        name: name.trim(),
        description: description?.trim() || null,
      }).returning();

      if (pids.length > 0) {
        await tx.insert(rolePermissionsTable).values(
          pids.map(pid => ({ roleId: role.id, permissionId: pid }))
        );
      }
      return role;
    });

    await logActivity(req.userId!, "", "create", "role", result.id, `Создана роль: ${result.name}`);
    invalidatePermCache();

    const rp = await db.select().from(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, result.id));
    res.status(201).json({ ...result, permissionIds: rp.map(x => x.permissionId) });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

router.patch("/roles/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "validation_error", message: "Неверный ID роли" }); return; }

    const [existing] = await db.select().from(rolesTable).where(eq(rolesTable.id, id));
    if (!existing) { res.status(404).json({ error: "not_found" }); return; }

    const { name, description, permissionIds } = req.body;
    const pids: number[] | null = Array.isArray(permissionIds) ? permissionIds.map(Number).filter(n => !isNaN(n)) : null;

    if (pids && pids.length > 0 && !(await validatePermissionIds(pids))) {
      res.status(400).json({ error: "validation_error", message: "Некоторые права не найдены" });
      return;
    }

    await db.transaction(async (tx) => {
      const upd: any = {};
      if (name !== undefined) upd.name = name.trim();
      if (description !== undefined) upd.description = description?.trim() || null;

      if (Object.keys(upd).length > 0) {
        await tx.update(rolesTable).set(upd).where(eq(rolesTable.id, id));
      }

      if (pids !== null) {
        await tx.delete(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, id));
        if (pids.length > 0) {
          await tx.insert(rolePermissionsTable).values(
            pids.map(pid => ({ roleId: id, permissionId: pid }))
          );
        }
      }
    });

    invalidatePermCache();
    await logActivity(req.userId!, "", "update", "role", id, `Обновлена роль (id=${id})`);

    const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, id));
    const rp = await db.select().from(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, id));
    res.json({ ...role, permissionIds: rp.map(x => x.permissionId) });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/roles/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "validation_error" }); return; }

    const usersWithRole = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.roleId, id));
    if (usersWithRole.length > 0) {
      res.status(400).json({ error: "validation_error", message: `Роль назначена ${usersWithRole.length} сотрудникам. Сначала переназначьте их.` });
      return;
    }
    const [role] = await db.delete(rolesTable).where(eq(rolesTable.id, id)).returning();
    if (!role) { res.status(404).json({ error: "not_found" }); return; }
    invalidatePermCache();
    await logActivity(req.userId!, "", "delete", "role", id, `Удалена роль: ${role.name}`);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/my-permissions", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.userRole === "admin") {
      const all = await db.select({ key: permissionsTable.key }).from(permissionsTable);
      res.json({ permissions: all.map(p => p.key) });
      return;
    }

    const [user] = await db.select({ roleId: usersTable.roleId }).from(usersTable).where(eq(usersTable.id, req.userId!));
    if (!user?.roleId) {
      res.json({ permissions: [] });
      return;
    }

    const rows = await db
      .select({ key: permissionsTable.key })
      .from(rolePermissionsTable)
      .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
      .where(eq(rolePermissionsTable.roleId, user.roleId));

    res.json({ permissions: rows.map(r => r.key) });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
