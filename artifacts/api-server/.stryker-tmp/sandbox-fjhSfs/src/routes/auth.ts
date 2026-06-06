// @ts-nocheck
import { Router, type IRouter, type Request, type Response } from "express";
import { clog } from "../lib/logger.js";

import { db, usersTable, driverLoginCodesTable, driverSessionsTable, loginAuditLogsTable, driverAuditLogsTable } from "@workspace/db";
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { generateReferralCode, applyReferralBonus } from "../lib/bonuses.js";
import { registerDeviceToken, registerPushSubscription, getVapidPublicKey } from "../lib/notifications.js";
import { JWT_SECRET } from "../lib/jwt-secret.js";
import { hashPassword, verifyPassword, hashOtp, register as registerUser } from "../lib/services/auth.service.js";
import { errorMessage } from "../lib/errors.js";
import { loginRateLimit, clearLoginRateLimit, codeOnlyRateLimit } from "../lib/login-rate-limit.js";
import { validateBody } from "../middlewares/validate.js";
import { loginBodySchema, registerBodySchema, emptyBodySchema, pushSubscribeBodySchema, deviceTokenBodySchema, driverCodeSendSmsBodySchema, driverCodeVerifyBodySchema, driverCodeVerifyCodeOnlyBodySchema } from "../middlewares/request-schemas.js";

const router: IRouter = Router();

const SESSION_EXPIRY_DAYS = 7;
const ALLOWED_REGISTER_ROLES = new Set(["driver", "client"]);

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("998") && digits.length >= 12) {
    return "+" + digits;
  }
  return raw.trim().replace(/\s+/g, "");
}

function generateToken(userId: number, role: string, sessionToken?: string): string {
  return jwt.sign({ userId, role, ...(sessionToken ? { sid: sessionToken } : {}) }, JWT_SECRET, { expiresIn: "30d" });
}

function generate6DigitCode(): string {
  return String(crypto.randomInt(100000, 999999));
}

function generateSessionToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  const xffStr = Array.isArray(xff) ? xff[0] : xff;
  return xffStr?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
}

const otpRateLimit = new Map<string, { count: number; resetAt: number }>();
const OTP_MAX_ATTEMPTS = 5;
const OTP_WINDOW_MS = 5 * 60 * 1000;

export function checkOtpRateLimit(phone: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const key = `otp:${phone}`;
  const entry = otpRateLimit.get(key);

  if (!entry || now >= entry.resetAt) {
    otpRateLimit.set(key, { count: 1, resetAt: now + OTP_WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= OTP_MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfterSeconds: retryAfter };
  }

  entry.count++;
  return { allowed: true };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of otpRateLimit.entries()) {
    if (now >= entry.resetAt) otpRateLimit.delete(key);
  }
}, 60_000);

async function createDriverSession(driverId: number, ip: string, deviceId?: string, deviceName?: string): Promise<{ token: string; sessionToken: string }> {
  await db.delete(driverSessionsTable).where(eq(driverSessionsTable.driverId, driverId));
  sessionCacheInvalidator?.(driverId);

  const sessionToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(driverSessionsTable).values({
    driverId,
    sessionToken,
    deviceId: deviceId || null,
    deviceName: deviceName || null,
    ipAddress: ip,
    lastActiveAt: new Date(),
    expiresAt,
  });

  const token = generateToken(driverId, "driver", sessionToken);
  return { token, sessionToken };
}

async function logAudit(driverId: number, loginType: string, ip: string, deviceId?: string, success: boolean = true, failReason?: string) {
  try {
    await db.insert(loginAuditLogsTable).values({
      driverId,
      loginType,
      ipAddress: ip,
      deviceId: deviceId || null,
      success: success ? 1 : 0,
      failReason: failReason || null,
    });
  } catch {}
}

let forceLogoutCallback: ((driverId: number, reason: string) => void) | null = null;
let sessionCacheInvalidator: ((driverId: number) => void) | null = null;

export function onForceLogout(cb: (driverId: number, reason: string) => void) {
  forceLogoutCallback = cb;
}

export function setSessionCacheInvalidator(cb: (driverId: number) => void) {
  sessionCacheInvalidator = cb;
}

router.post("/register", validateBody(registerBodySchema), async (req, res) => {
  try {
    const { phone: rawPhone, name, password, role, carModel, carNumber, carClass, referralCode: inviteCode } = req.body;

    if (!rawPhone || !name || !password || !role) {
      res.status(400).json({ error: "validation_error", message: "Phone, name, password and role are required" });
      return;
    }

    if (!ALLOWED_REGISTER_ROLES.has(String(role))) {
      res.status(400).json({ error: "validation_error", message: "Invalid role for self-registration" });
      return;
    }

    if (password.trim().length < 10) {
      res.status(400).json({ error: "validation_error", message: "Password must be at least 10 characters" });
      return;
    }

    const phone = normalizePhone(rawPhone);

    const existing = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    if (existing.length > 0) {
      res.status(400).json({ error: "phone_taken", message: "Phone number already registered" });
      return;
    }

    let invitedBy: number | undefined;
    if (inviteCode && role === "driver") {
      const [inviter] = await db.select({ id: usersTable.id })
        .from(usersTable).where(eq(usersTable.referralCode, inviteCode)).limit(1);
      if (inviter) invitedBy = inviter.id;
    }

    const passwordHash = await hashPassword(password);
    const user = await registerUser({
      phone,
      name,
      passwordHash,
      role,
      carModel: role === "driver" ? carModel : null,
      carNumber: role === "driver" ? carNumber : null,
      carClass: role === "driver" ? (carClass || "economy") : null,
      status: role === "driver" ? "offline" : null,
      referralCode: role === "driver" ? generateReferralCode() : null,
      invitedBy: invitedBy ?? null,
    });

    if (invitedBy && role === "driver") {
      applyReferralBonus(invitedBy, user.id).catch(err => {
        req.log.warn({ err, invitedBy, userId: user.id }, "Referral bonus failed (non-critical)");
      });
    }

    const ip = getClientIp(req);

    if (role === "driver") {
      const { token, sessionToken } = await createDriverSession(user.id, ip);
      const { passwordHash: _, ...userWithoutPassword } = user;
      res.status(201).json({ user: userWithoutPassword, token, sessionToken });
    } else {
      const token = generateToken(user.id, user.role);
      const { passwordHash: _, ...userWithoutPassword } = user;
      res.status(201).json({ user: userWithoutPassword, token });
    }
  } catch (err) {
    req.log.error({ err }, "Register error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/login", loginRateLimit, validateBody(loginBodySchema), async (req, res) => {
  try {
    const { phone: rawPhone, password, deviceId, deviceName, login: loginName } = req.body;

    if ((!rawPhone && !loginName) || !password) {
      res.status(400).json({ error: "validation_error", message: "Login/phone and password are required" });
      return;
    }

    const ip = getClientIp(req);
    let user: typeof usersTable.$inferSelect | undefined;

    if (loginName) {
      const trimmed = loginName.trim();
      if (!trimmed) {
        res.status(400).json({ error: "validation_error", message: "Login/phone and password are required" });
        return;
      }
      [user] = await db.select().from(usersTable).where(eq(usersTable.login, trimmed)).limit(1);
    } else {
      const phone = normalizePhone(rawPhone);
      [user] = await db.select().from(usersTable).where(and(eq(usersTable.phone, phone), inArray(usersTable.role, ["admin","dispatcher"]))).limit(1);
      if (!user) {
        const digits = rawPhone.replace(/\D/g, "");
        const altPhone = digits.startsWith("998") ? digits : "+" + digits;
        [user] = await db.select().from(usersTable).where(and(eq(usersTable.phone, altPhone), inArray(usersTable.role, ["admin","dispatcher"]))).limit(1);
      }
    }

    if (!user) {
      res.status(401).json({ error: "invalid_credentials", message: "Invalid phone or password" });
      return;
    }

    if (user.role === "driver") {
      res.status(403).json({ error: "driver_code_only", message: "Водители входят только по коду от диспетчера" });
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash || "");
    if (!valid) {
      const recheck = await bcrypt.compare(password.trim(), user.passwordHash || "");
      if (!recheck) {
        res.status(401).json({ error: "invalid_credentials", message: "Invalid phone or password" });
        return;
      }
    }

    const isBcrypt =
      user.passwordHash?.startsWith("$2a$") ||
      user.passwordHash?.startsWith("$2b$") ||
      user.passwordHash?.startsWith("$2y$");
    if (!isBcrypt) {
      const newHash = await hashPassword(password);
      await db.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.id, user.id));
    }

    const token = generateToken(user.id, user.role);
    const { passwordHash: _, ...userWithoutPassword } = user;
    clearLoginRateLimit(req).catch(() => {});
    res.json({ user: userWithoutPassword, token });
  } catch (err) {
    req.log.error({ err }, "Login error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "unauthorized", message: "No token provided" });
      return;
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; role: string; sid?: string };

    if (decoded.role === "driver" && !decoded.sid) {
      res.status(401).json({ error: "session_expired", message: "Driver token must include a session" });
      return;
    }

    if (decoded.role === "driver" && decoded.sid) {
      const [session] = await db.select()
        .from(driverSessionsTable)
        .where(and(
          eq(driverSessionsTable.driverId, decoded.userId),
          eq(driverSessionsTable.sessionToken, decoded.sid),
          gt(driverSessionsTable.expiresAt, new Date())
        ))
        .limit(1);

      if (!session) {
        res.status(401).json({ error: "session_expired", message: "Session expired or replaced" });
        return;
      }

      await db.update(driverSessionsTable)
        .set({ lastActiveAt: new Date() })
        .where(eq(driverSessionsTable.id, session.id));
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, decoded.userId)).limit(1);
    if (!user) {
      res.status(401).json({ error: "unauthorized", message: "User not found" });
      return;
    }

    const { passwordHash: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (err) {
    res.status(401).json({ error: "unauthorized", message: "Invalid token" });
  }
});

router.post("/logout", validateBody(emptyBodySchema), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET) as { userId: number; role: string; sid?: string };
      if (decoded.role === "driver" && decoded.sid) {
        await db.delete(driverSessionsTable).where(
          and(
            eq(driverSessionsTable.driverId, decoded.userId),
            eq(driverSessionsTable.sessionToken, decoded.sid)
          )
        );
      }
    }
  } catch {}
  res.json({ success: true, message: "Logged out" });
});

router.post("/refresh-token", validateBody(emptyBodySchema), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "unauthorized", message: "No token" });
      return;
    }
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: false }) as { userId: number; role: string; sid?: string; exp?: number };
    const now = Math.floor(Date.now() / 1000);
    const exp = decoded.exp || 0;
    const daysLeft = (exp - now) / 86400;
    if (daysLeft > 7) {
      res.json({ refreshed: false, message: "Token still valid", daysLeft: Math.round(daysLeft) });
      return;
    }
    const [user] = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, decoded.userId)).limit(1);
    if (!user) {
      res.status(401).json({ error: "unauthorized", message: "User not found" });
      return;
    }
    if (decoded.role === "driver" && decoded.sid) {
      const [session] = await db.select({ id: driverSessionsTable.id })
        .from(driverSessionsTable)
        .where(and(
          eq(driverSessionsTable.driverId, decoded.userId),
          eq(driverSessionsTable.sessionToken, decoded.sid),
          gt(driverSessionsTable.expiresAt, new Date())
        ))
        .limit(1);
      if (!session) {
        res.status(401).json({ error: "session_expired", message: "Session expired" });
        return;
      }
      await db.update(driverSessionsTable)
        .set({ expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) })
        .where(eq(driverSessionsTable.id, session.id));
    }
    const newToken = generateToken(decoded.userId, user.role, decoded.sid || undefined);
    res.json({ refreshed: true, token: newToken });
  } catch (err) {
    if (err instanceof Error && err.name === "TokenExpiredError") {
      res.status(401).json({ error: "token_expired", message: "Token expired, please login again" });
      return;
    }
    res.status(401).json({ error: "unauthorized", message: "Invalid token" });
  }
});


router.get("/vapid-key", (_req, res) => {
  const key = getVapidPublicKey();
  if (!key) {
    res.status(503).json({ error: "not_configured", message: "Push notifications not configured" });
    return;
  }
  res.json({ publicKey: key });
});

router.post("/push-subscribe", validateBody(pushSubscribeBodySchema), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET) as { userId: number; role: string };
    const { subscription } = req.body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      res.status(400).json({ error: "validation_error", message: "Valid push subscription required" });
      return;
    }
    await registerPushSubscription(decoded.userId, decoded.role, subscription);
    res.json({ success: true, message: "Push subscription registered" });
  } catch (err) {
    res.status(401).json({ error: "unauthorized" });
  }
});

router.post("/device-token", validateBody(deviceTokenBodySchema), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET) as { userId: number; role: string };
    const { token: fcmToken } = req.body;
    if (!fcmToken) {
      res.status(400).json({ error: "validation_error", message: "token is required" });
      return;
    }
    await registerDeviceToken(decoded.userId, decoded.role, fcmToken);
    res.json({ success: true });
  } catch (err) {
    res.status(401).json({ error: "unauthorized" });
  }
});

router.post("/driver-code/generate", validateBody(emptyBodySchema), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET) as { userId: number; role: string };
    if (decoded.role !== "dispatcher" && decoded.role !== "admin") {
      res.status(403).json({ error: "forbidden", message: "Only dispatchers can generate codes" });
      return;
    }

    const { driverId } = req.body;
    if (!driverId) {
      res.status(400).json({ error: "validation_error", message: "driverId is required" });
      return;
    }

    const [driver] = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, driverId)).limit(1);
    if (!driver || driver.role !== "driver") {
      res.status(404).json({ error: "not_found", message: "Driver not found" });
      return;
    }

    await db.update(driverLoginCodesTable)
      .set({ isUsed: true })
      .where(and(
        eq(driverLoginCodesTable.driverId, driverId),
        eq(driverLoginCodesTable.isUsed, false)
      ));

    const code = generate6DigitCode();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000);

    await db.insert(driverLoginCodesTable).values({
      driverId,
      codeHash: hashOtp(code),
      type: "operator",
      expiresAt,
      isUsed: false,
    });

    await db.insert(driverAuditLogsTable).values({
      driverId, actorId: decoded.userId, action: "generate_code",
      details: `Код входа сгенерирован`,
    }).catch(() => {});

    res.json({
      code,
      driverName: driver.name,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: 120,
    });
  } catch (err) {
    req.log.error({ err }, "Generate driver code error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/driver-code/send-sms", validateBody(driverCodeSendSmsBodySchema), async (req, res) => {
  try {
    const { phone: rawPhone } = req.body;
    if (!rawPhone) {
      res.status(400).json({ error: "validation_error", message: "phone is required" });
      return;
    }

    const phone = normalizePhone(rawPhone);

    const rateCheck = checkOtpRateLimit(phone);
    if (!rateCheck.allowed) {
      res.status(429).json({
        error: "rate_limited",
        message: `Слишком много попыток. Повторите через ${rateCheck.retryAfterSeconds} сек.`,
        retryAfterSeconds: rateCheck.retryAfterSeconds,
      });
      return;
    }

    const [user] = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
      .from(usersTable).where(and(eq(usersTable.phone, phone), eq(usersTable.role, "driver"))).limit(1);

    if (!user || user.role !== "driver") {
      res.json({ success: true, message: "Код отправлен, если аккаунт существует", expiresInSeconds: 300 });
      return;
    }

    await db.update(driverLoginCodesTable)
      .set({ isUsed: true })
      .where(and(
        eq(driverLoginCodesTable.driverId, user.id),
        eq(driverLoginCodesTable.isUsed, false)
      ));

    const code = generate6DigitCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await db.insert(driverLoginCodesTable).values({
      driverId: user.id,
      codeHash: hashOtp(code),
      type: "sms",
      expiresAt,
      isUsed: false,
    });

    const { sendVerificationSms } = await import("../lib/sms-notifications.js");
    sendVerificationSms(phone, code).catch(err => {
      clog.error(`[SMS OTP] Failed to send SMS to ${phone}:`, err);
    });

    clog.log(`[SMS OTP] Code sent to ${phone} for driver ${user.id}`);

    res.json({
      success: true,
      message: "Код отправлен, если аккаунт существует",
      expiresInSeconds: 300,
    });
  } catch (err) {
    req.log.error({ err }, "Send SMS code error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/driver-code/verify", loginRateLimit, validateBody(driverCodeVerifyBodySchema), async (req, res) => {
  try {
    const { phone: rawPhone, code, deviceId, deviceName } = req.body;
    if (!rawPhone || !code) {
      res.status(400).json({ error: "validation_error", message: "phone and code are required" });
      return;
    }

    const phone = normalizePhone(rawPhone);
    const ip = getClientIp(req);

    const rateCheck = checkOtpRateLimit(phone);
    if (!rateCheck.allowed) {
      res.status(429).json({
        error: "rate_limited",
        message: `Слишком много попыток. Повторите через ${rateCheck.retryAfterSeconds} сек.`,
        retryAfterSeconds: rateCheck.retryAfterSeconds,
      });
      return;
    }

    const [user] = await db.select().from(usersTable).where(and(eq(usersTable.phone, phone), eq(usersTable.role, "driver"))).limit(1);

    if (!user || user.role !== "driver") {
      res.status(401).json({ error: "invalid_credentials", message: "Неверный номер или код" });
      return;
    }

    const codeHashInput = hashOtp(String(code).trim());

    const [loginCode] = await db.select()
      .from(driverLoginCodesTable)
      .where(and(
        eq(driverLoginCodesTable.driverId, user.id),
        eq(driverLoginCodesTable.codeHash, codeHashInput),
        eq(driverLoginCodesTable.isUsed, false),
        gt(driverLoginCodesTable.expiresAt, new Date())
      ))
      .orderBy(desc(driverLoginCodesTable.createdAt))
      .limit(1);

    if (!loginCode) {
      await logAudit(user.id, "otp", ip, deviceId, false, "invalid_code");
      res.status(401).json({ error: "invalid_code", message: "Неверный, просроченный или использованный код" });
      return;
    }

    await db.update(driverLoginCodesTable)
      .set({ isUsed: true })
      .where(and(
        eq(driverLoginCodesTable.driverId, user.id),
        eq(driverLoginCodesTable.isUsed, false)
      ));

    forceLogoutCallback?.(user.id, "New login from another device");

    const { token, sessionToken } = await createDriverSession(user.id, ip, deviceId, deviceName);

    await logAudit(user.id, loginCode.type, ip, deviceId);

    const { passwordHash: _, ...userWithoutPassword } = user;

    clog.log(`[LOGIN CODE] Driver ${user.id} logged in via ${loginCode.type} code`);

    res.json({ user: userWithoutPassword, token, sessionToken });
  } catch (err) {
    req.log.error({ err }, "Verify driver code error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/driver-code/verify-code-only", codeOnlyRateLimit, validateBody(driverCodeVerifyCodeOnlyBodySchema), async (req, res) => {
  try {
    const { code, deviceId, deviceName } = req.body;
    if (!code) {
      res.status(400).json({ error: "validation_error", message: "code is required" });
      return;
    }

    const codeHashInput = hashOtp(String(code).trim());
    const ip = getClientIp(req);

    const [loginCode] = await db.select()
      .from(driverLoginCodesTable)
      .where(and(
        eq(driverLoginCodesTable.codeHash, codeHashInput),
        eq(driverLoginCodesTable.isUsed, false),
        gt(driverLoginCodesTable.expiresAt, new Date())
      ))
      .orderBy(desc(driverLoginCodesTable.createdAt))
      .limit(1);

    if (!loginCode) {
      // Surface failed code-only attempts for brute-force monitoring (no user to attribute yet).
      req.log.warn({ ip, deviceId }, "Failed code-only login attempt (invalid/expired/used code)");
      res.status(401).json({ error: "invalid_code", message: "Неверный, просроченный или использованный код" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, loginCode.driverId)).limit(1);
    if (!user || user.role !== "driver") {
      res.status(401).json({ error: "invalid_credentials", message: "Водитель не найден" });
      return;
    }

    await db.update(driverLoginCodesTable)
      .set({ isUsed: true })
      .where(and(
        eq(driverLoginCodesTable.driverId, user.id),
        eq(driverLoginCodesTable.isUsed, false)
      ));

    forceLogoutCallback?.(user.id, "New login from another device");

    const { token, sessionToken } = await createDriverSession(user.id, ip, deviceId, deviceName);
    await logAudit(user.id, loginCode.type, ip, deviceId);

    const { passwordHash: _, ...userWithoutPassword } = user;
    clog.log(`[LOGIN CODE-ONLY] Driver ${user.id} logged in via code-only`);

    res.json({ user: userWithoutPassword, token, sessionToken });
  } catch (err) {
    req.log.error({ err }, "Verify code-only error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.get("/driver-session", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET) as { userId: number; role: string; sid?: string };

    if (decoded.role !== "driver") {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    const [session] = await db.select({
      id: driverSessionsTable.id,
      deviceId: driverSessionsTable.deviceId,
      deviceName: driverSessionsTable.deviceName,
      ipAddress: driverSessionsTable.ipAddress,
      lastActiveAt: driverSessionsTable.lastActiveAt,
      createdAt: driverSessionsTable.createdAt,
      expiresAt: driverSessionsTable.expiresAt,
    })
      .from(driverSessionsTable)
      .where(eq(driverSessionsTable.driverId, decoded.userId))
      .orderBy(desc(driverSessionsTable.createdAt))
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "no_session" });
      return;
    }

    res.json(session);
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
});

router.get("/login-history", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET) as { userId: number; role: string };

    if (decoded.role !== "dispatcher" && decoded.role !== "admin") {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    const driverId = Number(req.query.driverId);
    if (!driverId) {
      res.status(400).json({ error: "validation_error", message: "driverId is required" });
      return;
    }

    const logs = await db.select()
      .from(loginAuditLogsTable)
      .where(eq(loginAuditLogsTable.driverId, driverId))
      .orderBy(desc(loginAuditLogsTable.createdAt))
      .limit(20);

    res.json(logs);
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
});

setInterval(async () => {
  try {
    await db.delete(driverSessionsTable).where(lt(driverSessionsTable.expiresAt, new Date()));
    await db.delete(driverLoginCodesTable).where(lt(driverLoginCodesTable.expiresAt, new Date()));
  } catch {}
}, 60 * 60 * 1000);


router.get("/sip-config", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET) as { userId: number };
    const [user] = await db.select({
      sipServer: usersTable.sipServer,
      sipDomain: usersTable.sipDomain,
      sipLogin: usersTable.sipLogin,
      sipPassword: usersTable.sipPassword,
    }).from(usersTable).where(eq(usersTable.id, decoded.userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!user.sipServer && !user.sipLogin) {
      res.json({ config: null });
      return;
    }
    res.json({ config: { server: user.sipServer || "", domain: user.sipDomain || user.sipServer || "", login: user.sipLogin || "", password: user.sipPassword || "" } });
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
});

router.post("/sip-config", validateBody(emptyBodySchema), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET) as { userId: number };
    const { server, domain, login, password } = req.body;
    if (!server || !login || !password) {
      res.status(400).json({ error: "missing_fields" });
      return;
    }
    await db.update(usersTable).set({
      sipServer: server,
      sipDomain: domain || server,
      sipLogin: login,
      sipPassword: password,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, decoded.userId));
    res.json({ success: true });
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
});


router.get("/preferences", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET) as { userId: number };
    const rows = await db.execute(sql`SELECT preferences FROM users WHERE id = ${decoded.userId} LIMIT 1`);
    const row = rows.rows[0] as { preferences: unknown } | undefined;
    res.json({ preferences: (row?.preferences as object) || {} });
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
});

router.put("/preferences", validateBody(emptyBodySchema), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET) as { userId: number };
    const prefs = req.body;
    if (!prefs || typeof prefs !== "object") {
      res.status(400).json({ error: "invalid_data" });
      return;
    }
    const prefsJson = JSON.stringify(prefs);
    await db.execute(
      sql`UPDATE users SET preferences = ${prefsJson}::jsonb, updated_at = NOW() WHERE id = ${decoded.userId}`,
    );
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: errorMessage(err) || "error" });
  }
});

export default router;
export { JWT_SECRET, hashPassword, verifyPassword, hashOtp };
