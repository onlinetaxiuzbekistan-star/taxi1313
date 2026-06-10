import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { redis } from "./redis.js";

const WINDOW_SEC = 15 * 60;
const MAX_ATTEMPTS_PER_IP = 20;
const MAX_ATTEMPTS_PER_LOGIN = 8;

function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0]!.trim();
  }
  return (req.socket?.remoteAddress as string) || "unknown";
}

function getLoginKeyPart(req: Request): string {
  const body = (req.body || {}) as { phone?: string; login?: string };
  const value = (body.login || body.phone || "").toString().trim().toLowerCase();
  return value || "_anon_";
}

async function bumpAndCheck(key: string, limit: number, windowSec: number = WINDOW_SEC): Promise<{ allowed: boolean; retryAfter: number; count: number }> {
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSec);
    }
    if (count > limit) {
      const ttl = await redis.ttl(key);
      return { allowed: false, retryAfter: ttl > 0 ? ttl : windowSec, count };
    }
    return { allowed: true, retryAfter: 0, count };
  } catch {
    return { allowed: true, retryAfter: 0, count: 0 };
  }
}

export async function loginRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ip = getClientIp(req);
  const loginPart = getLoginKeyPart(req);
  const ipKey = `rl:login:ip:${ip}`;
  const loginKey = `rl:login:user:${loginPart}`;

  const ipCheck = await bumpAndCheck(ipKey, MAX_ATTEMPTS_PER_IP);
  if (!ipCheck.allowed) {
    res.setHeader("Retry-After", String(ipCheck.retryAfter));
    res.status(429).json({
      error: "rate_limited",
      message: "Too many login attempts from this IP. Try again later.",
      retryAfterSeconds: ipCheck.retryAfter,
    });
    return;
  }

  const loginCheck = await bumpAndCheck(loginKey, MAX_ATTEMPTS_PER_LOGIN);
  if (!loginCheck.allowed) {
    res.setHeader("Retry-After", String(loginCheck.retryAfter));
    res.status(429).json({
      error: "rate_limited",
      message: "Too many login attempts for this account. Try again later.",
      retryAfterSeconds: loginCheck.retryAfter,
    });
    return;
  }

  next();
}

// Dedicated limiter for the phone-less "code-only" driver login. That flow carries no phone, so the
// per-login bucket above would collapse to one shared key and lock out legit drivers — here we limit
// strictly per-IP. Main defense against brute-forcing the global pool of active 6-digit login codes.
const MAX_CODEONLY_PER_IP = 12;

export async function codeOnlyRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ip = getClientIp(req);
  const check = await bumpAndCheck(`rl:codeonly:ip:${ip}`, MAX_CODEONLY_PER_IP);
  if (!check.allowed) {
    res.setHeader("Retry-After", String(check.retryAfter));
    res.status(429).json({
      error: "rate_limited",
      message: "Слишком много попыток ввода кода. Попробуйте позже.",
      retryAfterSeconds: check.retryAfter,
    });
    return;
  }
  next();
}

export async function clearLoginRateLimit(req: Request): Promise<void> {
  try {
    const ip = getClientIp(req);
    const loginPart = getLoginKeyPart(req);
    await redis.del(`rl:login:ip:${ip}`, `rl:login:user:${loginPart}`);
  } catch {}
}

// ── Global API rate limit (per authenticated user, else per IP) ────────────
// Coarse abuse/scraping/DoS backstop on every /api route. CRITICAL: mobile
// carriers in UZ use CGNAT, so MANY drivers share ONE public IP — a pure per-IP
// limit makes them collectively trip it and each gets 429 (e.g. the Online
// toggle failing with "Too many requests"). So for AUTHENTICATED requests we key
// the bucket by the JWT subject (userId) — each driver/operator gets their own
// generous bucket regardless of shared IP. Only unauthenticated traffic falls
// back to per-IP. Token is DECODED (not verified) purely for bucketing; real
// auth is still enforced downstream, so a forged token only buckets itself.
// Fails open (allows) if Redis is unavailable.
const API_WINDOW_SEC = 60;
const API_MAX_PER_IP = Number(process.env.API_RATE_LIMIT_PER_MIN) || 4000;
// Generous per-user ceiling. A driver's legitimate polling is well under this even
// with every screen open; the higher headroom matters because several app poll
// loops retry WITHOUT backoff, so once the limit is hit the 429s CASCADE (each
// rejected poll instantly re-fires) into a self-sustaining storm. Keeping the
// ceiling above any legitimate burst means the limit is never hit in normal use,
// so the cascade never triggers. A true runaway loop would still be capped here.
const API_MAX_PER_USER = Number(process.env.API_RATE_LIMIT_PER_USER_PER_MIN) || 3000;

function getApiRateSubject(req: Request): { key: string; limit: number } {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    try {
      const decoded = jwt.decode(auth.slice(7)) as { userId?: number } | null;
      if (decoded && decoded.userId != null) {
        return { key: `rl:api:user:${decoded.userId}`, limit: API_MAX_PER_USER };
      }
    } catch {
      /* fall through to per-IP */
    }
  }
  return { key: `rl:api:ip:${getClientIp(req)}`, limit: API_MAX_PER_IP };
}

export async function apiRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { key, limit } = getApiRateSubject(req);
  const check = await bumpAndCheck(key, limit, API_WINDOW_SEC);
  if (!check.allowed) {
    res.setHeader("Retry-After", String(check.retryAfter));
    res.status(429).json({
      error: "rate_limited",
      message: "Too many requests. Slow down and try again shortly.",
      retryAfterSeconds: check.retryAfter,
    });
    return;
  }
  next();
}
