import express, { type Express } from "express";
import { clog } from "./lib/logger.js";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync, readFileSync } from "fs";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { rpsMiddleware, logSlowQuery } from "./lib/perf-cache.js";
import { onSlowQuery } from "@workspace/db";
import { Sentry } from "./lib/sentry.js";
import { config } from "./lib/config.js";
import { metricsMiddleware, metricsEndpoint } from "./lib/metrics.js";
import { apiRateLimit } from "./lib/login-rate-limit.js";

const UPLOADS_DIR = path.resolve(process.cwd(), "artifacts", "uploads");

const frontendCandidates = [
  path.resolve(process.cwd(), "artifacts", "taxi-app", "dist", "public"),
  path.resolve(process.cwd(), "..", "taxi-app", "dist", "public"),
];
const FRONTEND_DIR = frontendCandidates.find((d) => existsSync(d)) || frontendCandidates[0];

const BUILD_VERSION = new Date().toISOString();

const app: Express = express();

// Trust the X-Forwarded-* headers from the upstream TLS-terminating proxy so
// req.ip / req.protocol reflect the real client (correct rate-limit keys and
// HTTPS detection). Only enabled when a proxy is declared (config.trustProxy).
if (config.trustProxy) {
  app.set("trust proxy", 1);
}

// Security headers. CSP and cross-origin resource/embedder policies are disabled because this
// process also serves the SPA (inline scripts) and exposes an API consumed cross-origin by the
// Capacitor mobile app — enabling them with defaults would break those. Everything else stays on:
// HSTS, X-Content-Type-Options: nosniff, X-Frame-Options, Referrer-Policy, X-Powered-By removal, etc.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
function corsOriginDelegate(): boolean | string[] | ((origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void) {
  const raw = config.corsOrigins;
  if (!raw) {
    if (config.isProduction) {
      logger.warn("CORS_ORIGINS is not set; allowing any Origin (credentials enabled). Set CORS_ORIGINS to a comma-separated allowlist for production.");
    }
    return true;
  }
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || list.includes(origin)) {
      cb(null, true);
      return;
    }
    cb(null, false);
  };
}

app.use(cors({ origin: corsOriginDelegate(), credentials: true }));
app.use(rpsMiddleware);
app.use(metricsMiddleware);

// Prometheus scrape endpoint (RED metrics + business counters).
app.get("/metrics", metricsEndpoint);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

onSlowQuery(logSlowQuery);

app.use("/api/uploads", express.static(UPLOADS_DIR, { maxAge: 0, etag: false }));

app.get("/api/build-version", (_req, res) => {
  res.json({ version: BUILD_VERSION });
});

app.use("/api", apiRateLimit, router);

const noCacheHeaders = (_req: any, res: any, next: any) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
};

const indexHtml = path.resolve(FRONTEND_DIR, "index.html");
const isProduction = config.isProduction;
if (isProduction && existsSync(indexHtml)) {
  logger.info({ dir: FRONTEND_DIR, buildVersion: BUILD_VERSION }, "Serving frontend static files");

  // Read index.html fresh on every request so a frontend rebuild is picked up
  // without restarting the api-server (otherwise the HTML in memory keeps referencing
  // hashed JS filenames that no longer exist on disk → 404 for all users).
  // Cached for 5s by mtime so we don't hit the disk on every hit.
  let _htmlCache: { mtime: number; content: string } | null = null;
  function getIndexHtml(): string {
    try {
      const st = require("fs").statSync(indexHtml);
      const mtime = st.mtimeMs;
      if (_htmlCache && _htmlCache.mtime === mtime) return _htmlCache.content;
      let content = readFileSync(indexHtml, "utf-8");
      content = content.replace(
        "</head>",
        `<script>clog.log("FRONT VERSION: ${new Date().toISOString()} (built: ${new Date(mtime).toISOString()})");</script></head>`
      );
      _htmlCache = { mtime, content };
      logger.info({ mtime: new Date(mtime).toISOString() }, "index.html reloaded from disk");
      return content;
    } catch (err) {
      logger.error({ err }, "Failed to read index.html");
      return _htmlCache?.content || "<!DOCTYPE html><html><body>App unavailable</body></html>";
    }
  }

  app.use(noCacheHeaders, express.static(FRONTEND_DIR, {
    etag: false,
    lastModified: false,
    maxAge: 0,
    index: false,
  }));
  app.get("/{*splat}", (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.send(getIndexHtml());
  });
} else if (!isProduction) {
  logger.info("Dev mode — frontend static serving disabled (Vite dev server handles it)");
} else {
  logger.warn({ dir: FRONTEND_DIR }, "Frontend build not found — static serving disabled");
}

// ───────────────────────── Error handling ─────────────────────────
// Must be registered AFTER all routes. Sentry's handler captures unhandled
// errors (5xx) and attaches request context; the custom handler then logs a
// structured entry and returns a sanitized response. Capture happens once
// (in Sentry's handler) so we don't re-capture below and create duplicate events.
Sentry.setupExpressErrorHandler(app);

app.use((err: any, req: any, res: any, _next: any) => {
  logger.error(
    {
      err,
      reqId: req?.id,
      method: req?.method,
      url: typeof req?.url === "string" ? req.url.split("?")[0] : undefined,
      sentryId: res?.sentry,
    },
    "Unhandled request error",
  );

  // If the response already started, hand off to Express's default handler.
  if (res.headersSent) {
    return _next(err);
  }

  const status = typeof err?.status === "number" || typeof err?.statusCode === "number"
    ? (err.status ?? err.statusCode)
    : 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: "Internal server error" });
});

export default app;
