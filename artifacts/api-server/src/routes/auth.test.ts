import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

// auth.ts imports the DB, redis-backed rate limiters, the push/bullmq
// notifications chain and bonuses at module load. Stub them so importing the
// pure helpers under test has no external side effects.
vi.mock("@workspace/db", () => ({
  db: {},
  usersTable: {},
  driverLoginCodesTable: {},
  driverSessionsTable: {},
  loginAuditLogsTable: {},
  driverAuditLogsTable: {},
}));
vi.mock("../lib/redis.js", () => ({ redis: {} }));
vi.mock("../lib/notifications.js", () => ({
  registerDeviceToken: vi.fn(),
  registerPushSubscription: vi.fn(),
  getVapidPublicKey: vi.fn(() => ""),
}));
vi.mock("../lib/bonuses.js", () => ({
  generateReferralCode: vi.fn(),
  applyReferralBonus: vi.fn(),
}));

import { hashPassword, verifyPassword, hashOtp, checkOtpRateLimit } from "./auth.js";

const legacySha256 = (password: string) =>
  crypto.createHash("sha256").update(password + "buxtaxi-salt").digest("hex");

describe("verifyPassword (bcrypt path)", () => {
  it("returns true for a matching bcrypt hash", async () => {
    const hash = await hashPassword("s3cret");
    expect(hash.startsWith("$2")).toBe(true); // sanity: bcrypt hash
    await expect(verifyPassword("s3cret", hash)).resolves.toBe(true);
  });

  it("returns false for a wrong password", async () => {
    const hash = await hashPassword("s3cret");
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });

  it("trims surrounding whitespace on both hash and verify", async () => {
    const hash = await hashPassword("  spaced  "); // hashPassword trims before hashing
    await expect(verifyPassword("spaced", hash)).resolves.toBe(true);
    await expect(verifyPassword("   spaced   ", hash)).resolves.toBe(true);
  });
});

describe("verifyPassword (legacy SHA-256 fallback)", () => {
  it("accepts a correct legacy sha256 hash", async () => {
    const legacy = legacySha256("oldpass");
    expect(legacy.startsWith("$2")).toBe(false);
    await expect(verifyPassword("oldpass", legacy)).resolves.toBe(true);
  });

  it("rejects a wrong password against a legacy hash", async () => {
    const legacy = legacySha256("oldpass");
    await expect(verifyPassword("nope", legacy)).resolves.toBe(false);
  });

  it("trims input before legacy comparison", async () => {
    const legacy = legacySha256("oldpass");
    await expect(verifyPassword("  oldpass  ", legacy)).resolves.toBe(true);
  });
});

describe("hashOtp", () => {
  it("is deterministic for the same code", () => {
    expect(hashOtp("123456")).toBe(hashOtp("123456"));
  });

  it("produces different hashes for different codes", () => {
    expect(hashOtp("123456")).not.toBe(hashOtp("654321"));
  });

  it("matches the salted sha256 contract", () => {
    const expected = crypto.createHash("sha256").update("123456" + "buxtaxi-otp-salt").digest("hex");
    expect(hashOtp("123456")).toBe(expected);
  });
});

describe("checkOtpRateLimit", () => {
  it("allows the first 5 attempts and blocks the 6th", () => {
    const phone = "+998900000001"; // unique per test to avoid shared-state bleed
    for (let i = 1; i <= 5; i++) {
      expect(checkOtpRateLimit(phone).allowed).toBe(true);
    }
    const blocked = checkOtpRateLimit(phone);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(300);
  });

  it("tracks separate phones independently", () => {
    const a = "+998900000002";
    const b = "+998900000003";
    for (let i = 0; i < 5; i++) checkOtpRateLimit(a);
    expect(checkOtpRateLimit(a).allowed).toBe(false); // a is exhausted
    expect(checkOtpRateLimit(b).allowed).toBe(true); // b is fresh
  });

  describe("window reset", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("allows again after the 5-minute window elapses", () => {
      const phone = "+998900000004";
      for (let i = 0; i < 5; i++) checkOtpRateLimit(phone);
      expect(checkOtpRateLimit(phone).allowed).toBe(false);

      vi.advanceTimersByTime(5 * 60 * 1000 + 1); // window expires
      expect(checkOtpRateLimit(phone).allowed).toBe(true);
    });
  });
});
