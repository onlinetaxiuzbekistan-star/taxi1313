import crypto from "crypto";

/**
 * Constant-time string comparison for secrets (webhook keys, tokens).
 * Avoids the early-exit timing side-channel of `a === b`. A length mismatch
 * returns false immediately (the only leak is secret length, which is standard
 * and acceptable for these credentials).
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf-8");
  const bb = Buffer.from(b, "utf-8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
