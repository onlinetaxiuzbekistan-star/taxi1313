// Minimal static server for screenshots: serves the exported web app (dist/) at
// "/" with SPA fallback, and the comparison files at "/compare/*".
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist");
const compareDir = __dirname;
const PORT = Number(process.argv[2] || 8088);

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

function send(res, file) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);

  if (urlPath.startsWith("/compare/")) {
    const file = path.join(compareDir, urlPath.replace("/compare/", ""));
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return send(res, file);
    res.writeHead(404); return res.end("not found");
  }

  if (urlPath === "/") urlPath = "/index.html";
  const file = path.join(distDir, urlPath);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return send(res, file);

  // SPA fallback for client-side routes (no file extension).
  if (!path.extname(urlPath)) return send(res, path.join(distDir, "index.html"));

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => console.log(`serving on http://localhost:${PORT}`));
