import { Router } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authMiddleware, requireRole } from "../middlewares/auth.js";
import type { AuthRequest } from "../middlewares/auth.js";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";

const router = Router();

const UPLOADS_DIR = path.resolve(process.cwd(), "artifacts", "uploads", "audio");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/aac"];
const ALLOWED_EXT = [".mp3", ".wav", ".ogg", ".webm", ".m4a", ".aac"];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || ".mp3").toLowerCase();
    cb(null, `audio_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIME.includes(file.mimetype) || ALLOWED_EXT.includes(ext)) cb(null, true);
    else cb(new Error("Допустимы только аудио файлы (mp3, wav, ogg, m4a)"));
  },
});

const KINDS: Record<string, { urlKey: string; nameKey: string; label: string }> = {
  "trip-started": { urlKey: "audio_trip_started_url", nameKey: "audio_trip_started_name", label: "Аудио: начало поездки" },
  "cancel":       { urlKey: "audio_cancel_url",        nameKey: "audio_cancel_name",        label: "Аудио: отмена заказа" },
  "unassign":     { urlKey: "audio_unassign_url",      nameKey: "audio_unassign_name",      label: "Аудио: снятие заказа" },
  "seat-changed": { urlKey: "audio_seat_changed_url", nameKey: "audio_seat_changed_name", label: "Аудио: смена места" },
};

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

async function setSetting(key: string, value: string, label: string, category = "audio") {
  await db.insert(settingsTable).values({ key, value, label, category, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

async function deleteSetting(key: string) {
  await db.delete(settingsTable).where(eq(settingsTable.key, key));
}

router.get("/", async (_req, res) => {
  const out: Record<string, { url: string | null; name: string | null }> = {};
  for (const [kind, k] of Object.entries(KINDS)) {
    out[kind] = { url: await getSetting(k.urlKey), name: await getSetting(k.nameKey) };
  }
  res.json(out);
});

router.get("/:kind", async (req, res) => {
  const k = KINDS[req.params.kind];
  if (!k) { res.status(404).json({ error: "unknown_kind" }); return; }
  res.json({ url: await getSetting(k.urlKey), name: await getSetting(k.nameKey) });
});

// multipart upload — body validated post-multer in handler
router.post("/:kind", authMiddleware, requireRole("dispatcher", "admin"), (req: AuthRequest, res, _next) => {
  const k = KINDS[req.params.kind];
  if (!k) { res.status(404).json({ error: "unknown_kind" }); return; }
  upload.single("audio")(req, res, async (err: any) => {
    if (err) { res.status(400).json({ error: "upload_error", message: err.message || "Ошибка загрузки" }); return; }
    if (!req.file) { res.status(400).json({ error: "no_file", message: "Файл не получен" }); return; }
    try {
      const old = await getSetting(k.urlKey);
      if (old) {
        const oldPath = path.join(UPLOADS_DIR, path.basename(old));
        if (fs.existsSync(oldPath)) { try { fs.unlinkSync(oldPath); } catch {} }
      }
      const url = `/api/uploads/audio/${req.file.filename}`;
      await setSetting(k.urlKey, url, k.label);
      await setSetting(k.nameKey, req.file.originalname, k.label + " (имя файла)");
      res.json({ ok: true, url, name: req.file.originalname });
    } catch (e) {
      req.log?.error({ err: e }, "audio upload save failed");
      res.status(500).json({ error: "server_error", message: "Не удалось сохранить" });
    }
  });
});

router.delete("/:kind", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  const k = KINDS[req.params.kind];
  if (!k) { res.status(404).json({ error: "unknown_kind" }); return; }
  const url = await getSetting(k.urlKey);
  if (url) {
    const p = path.join(UPLOADS_DIR, path.basename(url));
    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
  }
  await deleteSetting(k.urlKey);
  await deleteSetting(k.nameKey);
  res.json({ ok: true });
});

export default router;
