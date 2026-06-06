/**
 * Auth service — canonical home for the auth primitives and the core
 * login/register/OTP data-access. Route handlers (routes/auth.ts) own the HTTP
 * concerns (rate limiting, sessions, JWT issuance) and delegate here.
 */
// @ts-nocheck

import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, usersTable, driverLoginCodesTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";

const LEGACY_PASSWORD_SALT = "buxtaxi-salt";
const OTP_SALT = "buxtaxi-otp-salt";

export function legacySha256(password: string): string {
  return crypto.createHash("sha256").update(password + LEGACY_PASSWORD_SALT).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password.trim(), 10);
}

export async function verifyPassword(inputPassword: string, storedHash: string): Promise<boolean> {
  const input = inputPassword.trim();
  if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$")) {
    return bcrypt.compare(input, storedHash);
  }
  return legacySha256(input) === storedHash;
}

export function hashOtp(code: string): string {
  return crypto.createHash("sha256").update(code + OTP_SALT).digest("hex");
}

export async function getUserByPhone(phone: string) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  return u;
}

export async function getUserByLogin(login: string) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.login, login)).limit(1);
  return u;
}

/**
 * Resolve a user by login-name or phone and verify the password.
 * Returns the user on success, or null on unknown user / bad password.
 */
export async function login(
  identifier: { phone?: string; login?: string },
  password: string,
): Promise<typeof usersTable.$inferSelect | null> {
  const user = identifier.login
    ? await getUserByLogin(identifier.login.trim())
    : identifier.phone
      ? await getUserByPhone(identifier.phone)
      : undefined;
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash || "");
  return ok ? user : null;
}

export async function register(values: typeof usersTable.$inferInsert) {
  const [user] = await db.insert(usersTable).values(values).returning();
  return user;
}

/**
 * Look up an unexpired driver login code by its plaintext value.
 * Returns the code row (incl. driverId) or null.
 */
export async function verifyOtp(code: string) {
  const codeHash = hashOtp(String(code).trim());
  const [row] = await db
    .select()
    .from(driverLoginCodesTable)
    .where(and(eq(driverLoginCodesTable.codeHash, codeHash), gt(driverLoginCodesTable.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}
