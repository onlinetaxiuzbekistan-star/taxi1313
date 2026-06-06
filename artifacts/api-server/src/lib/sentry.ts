import * as Sentry from "@sentry/node";

export function initSentry() {
  Sentry.init({
    dsn: "https://f491698960188ffb1428099d9e32525b@o4511219755057152.ingest.de.sentry.io/4511219763511376",
    environment: process.env.NODE_ENV || "production",
    release: `taxi-api@${process.env.APP_VERSION || "1.0.0"}`,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      if (event.exception?.values?.some(v => v.value?.includes("ECONNRESET"))) return null;
      if (event.exception?.values?.some(v => v.value?.includes("EPIPE"))) return null;
      return event;
    },
    ignoreErrors: [
      "ECONNRESET",
      "EPIPE",
      "ECONNREFUSED",
      "socket hang up",
    ],
  });
}

export function setSentryUser(user: { id: number; name: string; role: string }) {
  Sentry.setUser({ id: String(user.id), username: user.name, segment: user.role });
}

export function clearSentryUser() {
  Sentry.setUser(null);
}

export function captureError(error: unknown, context?: Record<string, any>) {
  Sentry.captureException(error, { extra: context });
}

export function captureMessage(msg: string, level: "info" | "warning" | "error" = "info") {
  Sentry.captureMessage(msg, level);
}

export { Sentry };
