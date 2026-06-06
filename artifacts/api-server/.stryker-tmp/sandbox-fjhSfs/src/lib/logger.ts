// @ts-nocheck
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

/**
 * console-compatible adapter that routes through pino (structured JSON, level
 * filtering, redaction) instead of writing raw to stdout/stderr. String args
 * become the message; non-string args (errors/objects) are captured as
 * structured context so nothing is dropped. Used to migrate legacy console.*
 * calls in bulk; call sites can be refined to idiomatic logger.x({ctx}, msg).
 */
function toEntry(args: unknown[]): [Record<string, unknown>, string] {
  const message = args.filter((a) => typeof a === "string").join(" ");
  const extras = args.filter((a) => typeof a !== "string");
  return [extras.length ? { args: extras } : {}, message];
}

export const clog = {
  log: (...a: unknown[]) => logger.info(...toEntry(a)),
  info: (...a: unknown[]) => logger.info(...toEntry(a)),
  warn: (...a: unknown[]) => logger.warn(...toEntry(a)),
  error: (...a: unknown[]) => logger.error(...toEntry(a)),
  debug: (...a: unknown[]) => logger.debug(...toEntry(a)),
};
