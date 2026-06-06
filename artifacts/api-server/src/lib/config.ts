/**
 * Centralized, validated application configuration.
 *
 * All app env vars are read and validated here once, at import time. Required
 * vars throw at startup *in production* (dev/test fall back to safe defaults so
 * local runs and the test suite don't need a full env). This is the single
 * source of truth — modules import `config`, not process.env.
 *
 * Exceptions (intentionally still read process.env directly):
 *  - lib/logger.ts: the bootstrap logger must work before/without config (and
 *    config imports it), so it reads NODE_ENV/LOG_LEVEL itself.
 *  - lib/db (separate package): validates DATABASE_URL independently.
 *  - routes/apk.ts: toolchain/subprocess env (JAVA_HOME, PATH, ANDROID_*…)
 *    passed through to the gradle child process, not application config.
 */
import { logger } from "./logger.js";

const isProduction = process.env.NODE_ENV === "production";
const KNOWN_WEAK_SECRET = "buxtaxi-secret-key-2024";
const SENTRY_DSN_DEFAULT =
  "https://f491698960188ffb1428099d9e32525b@o4511219755057152.ingest.de.sentry.io/4511219763511376";

function requiredInProd(name: string, value: string | undefined): string {
  const v = value?.trim();
  if (!v) {
    if (isProduction) throw new Error(`Required environment variable ${name} is not set.`);
    return "";
  }
  return v;
}

function resolvePort(): number {
  const raw = process.env.PORT;
  if (!raw) {
    if (isProduction) throw new Error("PORT environment variable is required.");
    return 0; // dev/test: caller may not listen
  }
  const p = Number(raw);
  if (Number.isNaN(p) || p <= 0) throw new Error(`Invalid PORT value: "${raw}"`);
  return p;
}

/**
 * HTTPS awareness. This process terminates plain HTTP and is expected to sit
 * behind a TLS-terminating reverse proxy (nginx/Caddy) in production. We can't
 * force TLS from inside the app, but we can (a) detect whether an HTTPS proxy
 * is declared and warn loudly if not, and (b) return whether Express should
 * trust X-Forwarded-* headers (needed for correct client IPs in rate limiting
 * and secure-cookie/redirect logic).
 */
function resolveTrustProxy(): boolean {
  const behindProxy =
    process.env.TRUST_PROXY === "true" || process.env.BEHIND_HTTPS_PROXY === "true";
  if (isProduction && !behindProxy) {
    logger.warn(
      "[config] Running in production but no HTTPS reverse proxy is declared " +
        "(TRUST_PROXY / BEHIND_HTTPS_PROXY unset). Terminate TLS upstream and set " +
        "TRUST_PROXY=true so client IPs and secure-cookie handling are correct. " +
        "Serving plain HTTP directly to clients is insecure.",
    );
  }
  return behindProxy;
}

function resolveSessionSecret(): string {
  const s = process.env.SESSION_SECRET?.trim();
  if (isProduction) {
    if (!s || s.length < 32) {
      throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters in production.");
    }
    if (s === KNOWN_WEAK_SECRET) {
      throw new Error("SESSION_SECRET must not equal the built-in development default in production.");
    }
    return s;
  }
  if (!s) {
    logger.warn("[config] SESSION_SECRET is not set; using a development-only default.");
    return KNOWN_WEAK_SECRET;
  }
  return s;
}

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction,
  isDevelopment: process.env.NODE_ENV === "development",
  port: resolvePort(),
  appVersion: process.env.APP_VERSION || "1.0.0",
  logLevel: process.env.LOG_LEVEL ?? "info",

  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",

  sessionSecret: resolveSessionSecret(),
  trustProxy: resolveTrustProxy(),
  corsOrigins: process.env.CORS_ORIGINS?.trim() || "",
  internalHealthToken: process.env.INTERNAL_HEALTH_TOKEN?.trim() || "",
  simulationEnabled: process.env.SIMULATION_ENABLED === "true",

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
    privateKey: process.env.VAPID_PRIVATE_KEY || "",
    subject: process.env.VAPID_SUBJECT || "mailto:admin@buxtaxi.uz",
  },

  telegram: {
    botToken: requiredInProd("TELEGRAM_BOT_TOKEN", process.env.TELEGRAM_BOT_TOKEN),
    gatewayUrl: process.env.TELEGRAM_GATEWAY_URL || "http://192.168.1.107:3000",
  },

  sentry: {
    dsn: process.env.SENTRY_DSN || SENTRY_DSN_DEFAULT,
  },
} as const;
