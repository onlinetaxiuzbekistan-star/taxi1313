import * as Sentry from "@sentry/react";

const isSecure = typeof window !== "undefined" && window.isSecureContext === true;

if (isSecure) {
  const hasBroadcastChannel = typeof BroadcastChannel !== "undefined";
  const hasPerformanceObserver = typeof PerformanceObserver !== "undefined";

  const integrations: any[] = [];
  if (hasPerformanceObserver) {
    integrations.push(Sentry.browserTracingIntegration());
  }
  if (hasBroadcastChannel) {
    integrations.push(Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }));
  }

  Sentry.init({
    dsn: "https://8195de38e08fa343a1755caea5cc99e2@o4511219755057152.ingest.de.sentry.io/4511219760693328",
    environment: import.meta.env.MODE || "production",
    release: `taxi-frontend@${import.meta.env.VITE_APP_VERSION || "1.0.0"}`,
    integrations,
    tracesSampleRate: 0.2,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: hasBroadcastChannel ? 0.5 : 0,
    beforeSend(event) {
      if (event.exception?.values?.some(v => v.value?.includes("ResizeObserver"))) return null;
      if (event.exception?.values?.some(v => v.value?.includes("Network request failed"))) return null;
      return event;
    },
    ignoreErrors: [
      "ResizeObserver loop",
      "AbortError",
      "Failed to fetch",
      "Load failed",
      "NetworkError",
      "ChunkLoadError",
      "Illegal constructor",
    ],
  });
}

export function setSentryUser(user: { id: number; name: string; role: string }) {
  if (!isSecure) return;
  Sentry.setUser({ id: String(user.id), username: user.name, segment: user.role });
}

export function clearSentryUser() {
  if (!isSecure) return;
  Sentry.setUser(null);
}

export function captureError(error: unknown, context?: Record<string, any>) {
  if (!isSecure) return;
  Sentry.captureException(error, { extra: context });
}

export { Sentry };
