import { Router, type IRouter } from "express";
import { db, usersTable, branchesTable } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { authMiddleware, requireRole, AuthRequest, invalidatePermCache, invalidateBranchCache } from "../middlewares/auth.js";
import { logActivity } from "../lib/activity.js";
import { hashPassword } from "./auth.js";

const router: IRouter = Router();

async function ensureBranchExists(branchId: number | null | undefined): Promise<boolean> {
  if (branchId === null || branchId === undefined) return true;
  const [b] = await db.select({ id: branchesTable.id }).from(branchesTable)
    .where(eq(branchesTable.id, branchId));
  return !!b;
}

router.get("/", authMiddleware, requireRole("admin", "dispatcher"), async (req: AuthRequest, res) => {
  try {
    const staff = await db.select().from(usersTable)
      .where(inArray(usersTable.role, ["dispatcher", "admin"]))
      .orderBy(desc(usersTable.createdAt));
    const safeStaff = staff.map(({ passwordHash, sipPassword, ...s }) => ({ ...s, hasSip: !!s.sipLogin }));
    res.json({ staff: safeStaff });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

// Staff creation is an admin-only operation: it can assign roles and custom
// RBAC roleIds, so dispatchers must never reach it (privilege-escalation guard).
router.post("/", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const { name, phone, password, role, login: loginName, sipServer, sipDomain, sipLogin, sipPassword, branchId, roleId } = req.body;
    if (!name?.trim() || !password) {
      res.status(400).json({ error: "validation_error", message: "Имя и пароль обязательны" });
      return;
    }
    if (!["dispatcher", "admin"].includes(role)) {
      res.status(400).json({ error: "validation_error", message: "Роль должна быть dispatcher или admin" });
      return;
    }
    if (role === "admin" && req.userRole !== "admin") {
      res.status(403).json({ error: "forbidden", message: "Только администратор может создавать администраторов" });
      return;
    }

    const branchIdVal = branchId === undefined || branchId === null || branchId === "" ? null : Number(branchId);
    if (branchIdVal !== null && Number.isNaN(branchIdVal)) {
      res.status(400).json({ error: "validation_error", message: "branchId должен быть числом" });
      return;
    }
    if (!(await ensureBranchExists(branchIdVal))) {
      res.status(400).json({ error: "validation_error", message: "Указанный филиал не существует" });
      return;
    }

    if (phone?.trim()) {
      const existing = await db.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.phone, phone.trim()), inArray(usersTable.role, ["admin","dispatcher"])));
      if (existing.length > 0) {
        res.status(409).json({ error: "duplicate", message: "Пользователь с таким телефоном уже существует" });
        return;
      }
    }

    const [user] = await db.insert(usersTable).values({
      name: name.trim(),
      phone: phone?.trim() || "",
      login: loginName?.trim() || null,
      passwordHash: await hashPassword(password),
      role: role as any,
      branchId: branchIdVal,
      ...(roleId ? { roleId: parseInt(roleId) } : {}),
      ...(sipServer ? { sipServer: sipServer.trim() } : {}),
      ...(sipDomain ? { sipDomain: sipDomain.trim() } : {}),
      ...(sipLogin ? { sipLogin: sipLogin.trim() } : {}),
      ...(sipPassword ? { sipPassword } : {}),
    }).returning();
    const { passwordHash: _, sipPassword: _sp, ...safe } = user;
    await logActivity(req.userId!, "", "create", "staff", user.id, `Создан сотрудник: ${user.name} (${role})`);
    res.status(201).json(safe);
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

// Admin-only: this route can reset passwords and reassign role/roleId of any
// staff member. Dispatchers must never reach it.
router.patch("/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, phone, password, role, roleId, login: loginName, sipServer, sipDomain, sipLogin, sipPassword, branchId } = req.body;
    const upd: any = { updatedAt: new Date() };
    if (name !== undefined) upd.name = name.trim();
    if (phone !== undefined) upd.phone = phone.trim();
    if (loginName !== undefined) upd.login = loginName?.trim() || null;
    if (password) upd.passwordHash = await hashPassword(password);
    if (sipServer !== undefined) upd.sipServer = sipServer?.trim() || null;
    if (sipDomain !== undefined) upd.sipDomain = sipDomain?.trim() || null;
    if (sipLogin !== undefined) upd.sipLogin = sipLogin?.trim() || null;
    if (sipPassword !== undefined) upd.sipPassword = sipPassword || null;
    if (role && ["dispatcher", "admin"].includes(role)) {
      if (role === "admin" && req.userRole !== "admin") {
        res.status(403).json({ error: "forbidden", message: "Только администратор может назначать роль администратора" });
        return;
      }
      upd.role = role;
    }
    if (roleId !== undefined) upd.roleId = roleId ? parseInt(roleId) : null;

    if (branchId !== undefined) {
      const branchIdVal = branchId === null || branchId === "" ? null : Number(branchId);
      if (branchIdVal !== null && Number.isNaN(branchIdVal)) {
        res.status(400).json({ error: "validation_error", message: "branchId должен быть числом" });
        return;
      }
      if (!(await ensureBranchExists(branchIdVal))) {
        res.status(400).json({ error: "validation_error", message: "Указанный филиал не существует" });
        return;
      }
      upd.branchId = branchIdVal;
    }

    const [user] = await db.update(usersTable).set(upd)
      .where(and(eq(usersTable.id, id), inArray(usersTable.role, ["dispatcher", "admin"])))
      .returning();
    if (!user) { res.status(404).json({ error: "not_found" }); return; }
    const { passwordHash, sipPassword: _sp, ...safe } = user;
    invalidatePermCache(id);
    invalidateBranchCache(id);
    await logActivity(req.userId!, "", "update", "staff", id, `Обновлён сотрудник: ${user.name}`);
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.patch("/:id/calls-setting", authMiddleware, requireRole("admin", "dispatcher"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const { acceptsCalls } = req.body;
    if (typeof acceptsCalls !== "boolean") {
      res.status(400).json({ error: "validation_error", message: "acceptsCalls must be boolean" });
      return;
    }
    // Dispatchers may toggle call settings, but must not touch admin rows.
    const targetRoles = req.userRole === "admin" ? ["dispatcher", "admin"] : ["dispatcher"];
    const [user] = await db.update(usersTable).set({ acceptsCalls, updatedAt: new Date() })
      .where(and(eq(usersTable.id, id), inArray(usersTable.role, targetRoles as any)))
      .returning();
    if (!user) { res.status(404).json({ error: "not_found" }); return; }
    await logActivity(req.userId!, "", "update", "staff", id, `${acceptsCalls ? "Включены" : "Отключены"} звонки: ${user.name}`);
    res.json({ ok: true, acceptsCalls });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

// Admin-only: deleting staff (including other admins) must not be reachable by dispatchers.
router.delete("/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (id === req.userId) {
      res.status(400).json({ error: "validation_error", message: "Нельзя удалить самого себя" });
      return;
    }
    const [user] = await db.delete(usersTable)
      .where(and(eq(usersTable.id, id), inArray(usersTable.role, ["dispatcher", "admin"])))
      .returning();
    if (!user) { res.status(404).json({ error: "not_found" }); return; }
    invalidateBranchCache(id);
    await logActivity(req.userId!, "", "delete", "staff", id, `Удалён сотрудник: ${user.name}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
