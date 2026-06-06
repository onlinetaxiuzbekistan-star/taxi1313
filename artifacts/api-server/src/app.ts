import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync, readFileSync } from "fs";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { rpsMiddleware, logSlowQuery } from "./lib/perf-cache.js";
import { onSlowQuery } from "@workspace/db";

const UPLOADS_DIR = path.resolve(process.cwd(), "artifacts", "uploads");

const frontendCandidates = [
  path.resolve(process.cwd(), "artifacts", "taxi-app", "dist", "public"),
  path.resolve(process.cwd(), "..", "taxi-app", "dist", "public"),
];
const FRONTEND_DIR = frontendCandidates.find((d) => existsSync(d)) || frontendCandidates[0];

const BUILD_VERSION = new Date().toISOString();

const app: Express = express();

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
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
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
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

onSlowQuery(logSlowQuery);

app.use("/api/uploads", express.static(UPLOADS_DIR, { maxAge: 0, etag: false }));

app.get("/api/build-version", (_req, res) => {
  res.json({ version: BUILD_VERSION });
});

app.use("/api", router);

const noCacheHeaders = (_req: any, res: any, next: any) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
};

const indexHtml = path.resolve(FRONTEND_DIR, "index.html");
const isProduction = process.env.NODE_ENV === "production";
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
        `<script>console.log("FRONT VERSION: ${new Date().toISOString()} (built: ${new Date(mtime).toISOString()})");</script></head>`
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

export default app;
