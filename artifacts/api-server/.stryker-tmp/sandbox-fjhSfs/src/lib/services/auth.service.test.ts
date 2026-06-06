// @ts-nocheck
import { describe, it, expect, vi } from "vitest";

// auth.service imports the DB at module load; stub it so we can unit-test the
// pure crypto primitives without a database.
vi.mock("@workspace/db", () => ({
  db: {},
  usersTable: {},
  driverLoginCodesTable: {},
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn(), gt: vi.fn() }));

import { legacySha256, hashPassword, verifyPassword, hashOtp } from "./auth.service.js";

describe("auth.service crypto primitives", () => {
  it("legacySha256 is deterministic and hex-encoded", () => {
    const a = legacySha256("password123");
    const b = legacySha256("password123");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(legacySha256("password123")).not.toBe(legacySha256("password124"));
  });

  it("hashPassword produces a bcrypt hash that verifies", async () => {
    const hash = await hashPassword("  secret-pass  ");
    expect(hash.startsWith("$2")).toBe(true);
    // trims before hashing, so the trimmed form verifies
    expect(await verifyPassword("secret-pass", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("verifyPassword falls back to legacy sha256 for non-bcrypt stored hashes", async () => {
    const legacy = legacySha256("legacy-pw");
    expect(await verifyPassword("legacy-pw", legacy)).toBe(true);
    expect(await verifyPassword("nope", legacy)).toBe(false);
  });

  it("hashOtp is deterministic and distinct per code", () => {
    expect(hashOtp("1234")).toBe(hashOtp("1234"));
    expect(hashOtp("1234")).not.toBe(hashOtp("5678"));
    expect(hashOtp("1234")).toMatch(/^[0-9a-f]{64}$/);
  });
});
