// @ts-nocheck
import { Router, type Response } from "express";
import { clog } from "../lib/logger.js";
import { type AuthRequest, authMiddleware, requireRole } from "../middlewares/auth.js";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { validateBody } from "../middlewares/validate.js";
import { z } from "zod";

const apkBuildBodySchema = z.object({}).passthrough();

const execAsync = promisify(exec);
const router = Router();

const MAX_HISTORY = 5;
const APK_DIR = path.resolve(process.cwd(), "artifacts", "api-server", "public", "apk");
const TWA_DIR = path.resolve(process.cwd(), "artifacts", "api-server", "android-twa");
const APK_BUILD_LOG_DIR = process.env.APK_BUILD_LOG_DIR || "/var/log/taxi1313/apk-builds";
try { fs.mkdirSync(APK_BUILD_LOG_DIR, { recursive: true }); } catch {}
const ANDROID_HOME = process.env.ANDROID_HOME || "/home/runner/.android-sdk";
const GRADLE_HOME = process.env.GRADLE_HOME || "/home/runner/.gradle-dist/gradle-8.5";

function findJavaHome(): string | null {
  if (process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, "bin", "java"))) {
    return process.env.JAVA_HOME;
  }
  try {
    const javaBin = require("child_process").execSync("which java 2>/dev/null", { encoding: "utf-8" }).trim();
    if (javaBin) {
      const real = fs.realpathSync(javaBin);
      const javaHome = path.dirname(path.dirname(real));
      if (javaHome.endsWith("/lib/openjdk")) return javaHome;
      if (fs.existsSync(path.join(javaHome, "lib"))) return javaHome;
      const parentHome = path.dirname(javaHome);
      if (fs.existsSync(path.join(parentHome, "lib"))) return parentHome;
      return javaHome;
    }
  } catch {}
  try {
    const nixEntries = fs.readdirSync("/nix/store").filter(f => f.includes("openjdk") && !f.endsWith(".drv"));
    for (const entry of nixEntries) {
      const candidate = `/nix/store/${entry}`;
      if (fs.existsSync(path.join(candidate, "bin", "java"))) {
        return path.dirname(path.dirname(fs.realpathSync(path.join(candidate, "bin", "java"))));
      }
    }
  } catch {}
  return null;
}

interface BuildRecord {
  buildId: string;
  status: "building" | "ready" | "error";
  version: string;
  startTime: string;
  endTime: string | null;
  downloadUrl: string | null;
  fileName: string | null;
  error: string | null;
  log: string[];
}

function copyDirRecursive(src: string, dest: string) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

let currentBuild: BuildRecord | null = null;
const buildHistory: BuildRecord[] = [];

function generateBuildId(): string {
  return `build-${Date.now().toString(36)}`;
}

function generateVersion(): string {
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}.${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}`;
  return `1.0.${ts}`;
}

function checkToolsInstalled(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  try {
    if (!fs.existsSync(path.join(ANDROID_HOME, "build-tools", "34.0.0", "aapt2"))) {
      missing.push("Android SDK build-tools");
    }
    if (!fs.existsSync(path.join(ANDROID_HOME, "platforms", "android-34", "android.jar"))) {
      missing.push("Android SDK platform-34");
    }
    if (!fs.existsSync(path.join(GRADLE_HOME, "bin", "gradle"))) {
      missing.push("Gradle");
    }
  } catch {
    missing.push("Android SDK");
  }
  try {
    const javaPath = findJavaHome();
    if (!javaPath) {
      missing.push("JDK");
    }
  } catch {
    missing.push("JDK");
  }
  return { ok: missing.length === 0, missing };
}

function getApkFiles(): { name: string; size: number; date: string }[] {
  try {
    if (!fs.existsSync(APK_DIR)) return [];
    return fs.readdirSync(APK_DIR)
      .filter(f => f.endsWith(".apk"))
      .map(f => {
        const stat = fs.statSync(path.join(APK_DIR, f));
        return { name: f, size: stat.size, date: stat.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch { return []; }
}

router.get("/apk/status", authMiddleware, requireRole("admin", "dispatcher"), (_req: AuthRequest, res: Response) => {
  const tools = checkToolsInstalled();
  const apkFiles = getApkFiles();
  res.json({
    current: currentBuild ? {
      buildId: currentBuild.buildId,
      status: currentBuild.status,
      version: currentBuild.version,
      startTime: currentBuild.startTime,
      endTime: currentBuild.endTime,
      downloadUrl: currentBuild.downloadUrl,
      fileName: currentBuild.fileName,
      error: currentBuild.error,
    } : null,
    history: buildHistory.map(b => ({
      buildId: b.buildId,
      status: b.status,
      version: b.version,
      startTime: b.startTime,
      endTime: b.endTime,
      downloadUrl: b.downloadUrl,
      fileName: b.fileName,
      error: b.error,
    })),
    configured: tools.ok,
    missingTools: tools.missing,
    apkFiles,
  });
});

router.get("/apk/logs", authMiddleware, requireRole("admin", "dispatcher"), (_req: AuthRequest, res: Response) => {
  res.json({ log: currentBuild?.log || [] });
});

router.get("/apk/download/:filename", authMiddleware, requireRole("admin", "dispatcher"), (req: AuthRequest, res: Response) => {
  const filename = req.params.filename;
  if (!filename || !filename.endsWith(".apk") || filename.includes("..")) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const filePath = path.join(APK_DIR, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "APK not found" });
    return;
  }
  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

router.post("/apk/build", authMiddleware, requireRole("admin", "dispatcher"), validateBody(apkBuildBodySchema), async (req: AuthRequest, res: Response) => {
  const tools = checkToolsInstalled();
  if (!tools.ok) {
    res.status(400).json({
      error: "Build tools not installed",
      message: `Missing: ${tools.missing.join(", ")}`,
      missingTools: tools.missing,
    });
    return;
  }

  if (currentBuild?.status === "building") {
    res.status(409).json({ error: "Build already in progress", buildId: currentBuild.buildId });
    return;
  }

  const { serverUrl } = req.body as { serverUrl?: string };
  const targetUrl = serverUrl || "https://nil.taxi1313.ru";

  const buildId = generateBuildId();
  const version = generateVersion();

  if (currentBuild && (currentBuild.status as string) !== "building") {
    buildHistory.unshift(currentBuild);
    if (buildHistory.length > MAX_HISTORY) buildHistory.pop();
  }

  currentBuild = {
    buildId,
    status: "building",
    version,
    startTime: new Date().toISOString(),
    endTime: null,
    downloadUrl: null,
    fileName: null,
    error: null,
    log: [`[${new Date().toISOString()}] Build v${version} started by user #${req.userId}`],
  };

  res.json({ status: "building", buildId, version });

  runBuild(targetUrl, buildId, version).catch(err => {
    clog.error("[APK] Build failed:", err);
  });
});

async function runBuild(serverUrl: string, buildId: string, version: string) {
  if (!currentBuild || currentBuild.buildId !== buildId) return;

  const buildLogPath = path.join(APK_BUILD_LOG_DIR, `apk-build-${Date.now()}-${buildId}.log`);
  const fullLogParts: string[] = [];
  const safeEnv: Record<string, string | undefined> = {
    GRADLE_USER_HOME: process.env.GRADLE_USER_HOME,
    ANDROID_USER_HOME: process.env.ANDROID_USER_HOME,
    ANDROID_SDK_HOME: process.env.ANDROID_SDK_HOME,
    ANDROID_HOME, GRADLE_HOME,
    JAVA_HOME: process.env.JAVA_HOME,
    HOME: process.env.HOME,
    PATH: process.env.PATH,
  };
  fullLogParts.push(`=== APK BUILD ${buildId} v${version} @ ${new Date().toISOString()} ===`);
  fullLogParts.push(`Target URL: ${serverUrl}`);
  fullLogParts.push(`Env (sanitized): ${JSON.stringify(safeEnv, null, 2)}`);
  fullLogParts.push("");
  const writeFullLog = (extra?: string) => {
    try {
      const content = fullLogParts.join("\n") + (extra ? "\n\n=== TAIL ===\n" + extra : "");
      fs.writeFileSync(buildLogPath, content);
    } catch (e) { clog.error("[APK] writeFullLog failed:", e); }
  };

  const addLog = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    if (currentBuild && currentBuild.buildId === buildId) {
      currentBuild.log.push(line);
    }
    fullLogParts.push(line);
    clog.log(`[APK] ${msg}`);
  };

  const captureExec = async (label: string, cmd: string, opts: any) => {
    fullLogParts.push(`\n--- ${label} CMD: ${cmd}`);
    try {
      const result = await execAsync(cmd, opts);
      fullLogParts.push(`--- ${label} STDOUT (${result.stdout.length} bytes) ---`);
      fullLogParts.push(result.stdout.toString());
      if (result.stderr) {
        fullLogParts.push(`--- ${label} STDERR ---`);
        fullLogParts.push(result.stderr.toString());
      }
      writeFullLog();
      return result;
    } catch (e: any) {
      fullLogParts.push(`--- ${label} FAILED: ${e.message} ---`);
      if (e.stdout) { fullLogParts.push(`--- ${label} STDOUT ---`); fullLogParts.push(e.stdout); }
      if (e.stderr) { fullLogParts.push(`--- ${label} STDERR ---`); fullLogParts.push(e.stderr); }
      if (typeof e.code !== "undefined") fullLogParts.push(`--- ${label} EXIT CODE: ${e.code} ---`);
      writeFullLog();
      throw e;
    }
  };

  try {
    addLog(`Target URL: ${serverUrl}`);

    addLog("Building frontend (Vite)...");
    const taxiAppDir = path.resolve(process.cwd(), "artifacts", "taxi-app");
    const javaHome = findJavaHome();
    if (!javaHome) throw new Error("JDK not found — cannot build APK");

    try {
      const { stdout: buildOut } = await captureExec(
        "vite-build",
        `cd "${taxiAppDir}" && PORT=5000 BASE_PATH="/" NODE_ENV=production npx vite build 2>&1`,
        { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
      );
      const lastLines = buildOut.toString().split("\n").filter((l: string) => l.trim()).slice(-3);
      for (const l of lastLines) addLog(`vite: ${l.trim()}`);
    } catch (viteErr: any) {
      throw new Error(`Frontend build failed (full log: ${buildLogPath}): ${viteErr.message}`);
    }

    const distDir = path.join(taxiAppDir, "dist/public");
    const assetsDir = path.join(TWA_DIR, "app/src/main/assets/www");
    addLog("Copying web assets into APK...");
    fs.rmSync(assetsDir, { recursive: true, force: true });
    fs.mkdirSync(assetsDir, { recursive: true });
    copyDirRecursive(distDir, assetsDir);
    addLog("Web assets embedded into Android project");

    addLog("Preparing Android project...");
    const stringsFile = path.join(TWA_DIR, "app/src/main/res/values/strings.xml");
    let stringsContent = fs.readFileSync(stringsFile, "utf-8");
    const originalStrings = stringsContent;
    stringsContent = stringsContent.replace(/https:\/\/PLACEHOLDER_URL\/driver/g, `${serverUrl}/driver`);
    stringsContent = stringsContent.replace(/https:\/\/PLACEHOLDER_URL/g, serverUrl);
    fs.writeFileSync(stringsFile, stringsContent);
    addLog("Updated strings.xml with server URL");

    const keystoreDir = path.join(TWA_DIR, "keystore");
    const keystorePath = path.join(keystoreDir, "buxtaxi.keystore");
    if (!fs.existsSync(keystorePath)) {
      const keystorePass = process.env.APK_KEYSTORE_PASS;
      if (!keystorePass) {
        throw new Error("APK_KEYSTORE_PASS is not set — refusing to generate signing keystore with a hardcoded password");
      }
      fs.mkdirSync(keystoreDir, { recursive: true });
      addLog("Generating signing keystore...");
      await captureExec(
        "keytool",
        `keytool -genkeypair -alias buxtaxi -keyalg RSA -keysize 2048 -validity 10000 ` +
        `-keystore "${keystorePath}" -storepass "${keystorePass}" -keypass "${keystorePass}" ` +
        `-dname "CN=BuxTaxi, OU=Development, O=BuxTaxi, L=Bukhara, ST=Bukhara, C=UZ"`,
        { timeout: 30000 }
      );
      addLog("Keystore generated");
    }

    addLog("Running Gradle assembleRelease...");

    const gradleBin = path.join(GRADLE_HOME, "bin", "gradle");
    const buildCmd = `cd "${TWA_DIR}" && ANDROID_HOME="${ANDROID_HOME}" JAVA_HOME="${javaHome}" "${gradleBin}" assembleRelease --no-daemon -Pandroid.sdk.dir="${ANDROID_HOME}" 2>&1`;

    const { stdout } = await captureExec("gradle-assembleRelease", buildCmd, {
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        ANDROID_HOME,
        JAVA_HOME: javaHome,
        GRADLE_HOME,
        PATH: `${GRADLE_HOME}/bin:${ANDROID_HOME}/build-tools/34.0.0:${ANDROID_HOME}/cmdline-tools/latest/bin:${process.env.PATH}`,
      },
    });

    const buildLines = stdout.toString().split("\n").filter((l: string) => l.trim());
    for (const line of buildLines.slice(-10)) {
      addLog(`gradle: ${line.trim()}`);
    }

    const apkPath = path.join(TWA_DIR, "app/build/outputs/apk/release/app-release.apk");
    let finalApkPath = apkPath;
    if (!fs.existsSync(apkPath)) {
      const releaseDir = path.join(TWA_DIR, "app/build/outputs/apk/release");
      if (fs.existsSync(releaseDir)) {
        const apks = fs.readdirSync(releaseDir).filter(f => f.endsWith(".apk"));
        if (apks.length > 0) {
          finalApkPath = path.join(releaseDir, apks[0]);
        } else {
          throw new Error("No APK found in release output directory");
        }
      } else {
        throw new Error("Release output directory not found");
      }
    }

    const fileName = `buxtaxi-driver-v${version}.apk`;
    fs.mkdirSync(APK_DIR, { recursive: true });
    fs.copyFileSync(finalApkPath, path.join(APK_DIR, fileName));

    const size = fs.statSync(path.join(APK_DIR, fileName)).size;
    const sizeMB = (size / (1024 * 1024)).toFixed(1);
    addLog(`APK built successfully: ${fileName} (${sizeMB} MB)`);

    const downloadUrl = `/api/apk/download/${fileName}`;

    if (currentBuild && currentBuild.buildId === buildId) {
      currentBuild.status = "ready";
      currentBuild.downloadUrl = downloadUrl;
      currentBuild.fileName = fileName;
      currentBuild.endTime = new Date().toISOString();
      currentBuild.version = version;
    }

    addLog(`BUILD SUCCESS! Full log: ${buildLogPath}`);
    writeFullLog();

    fs.writeFileSync(stringsFile, originalStrings);
  } catch (err: any) {
    addLog(`ERROR: ${err.message}`);
    if (err.stdout) {
      const errorLines = err.stdout.split("\n").filter((l: string) => /ERROR|error|FAILURE|Exception|Caused by/.test(l)).slice(-20);
      for (const line of errorLines) {
        addLog(`gradle-error: ${line.trim()}`);
      }
    }
    addLog(`Full build log saved to: ${buildLogPath}`);
    writeFullLog();
    if (currentBuild && currentBuild.buildId === buildId) {
      currentBuild.status = "error";
      currentBuild.error = `${err.message} (полный лог: ${buildLogPath})`;
      currentBuild.endTime = new Date().toISOString();
    }

    try {
      const stringsFile = path.join(TWA_DIR, "app/src/main/res/values/strings.xml");
      let content = fs.readFileSync(stringsFile, "utf-8");
      content = content.replace(new RegExp(serverUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "/driver", "g"), "https://PLACEHOLDER_URL/driver");
      content = content.replace(new RegExp(serverUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g"), "https://PLACEHOLDER_URL");
      fs.writeFileSync(stringsFile, content);
    } catch {}
  }
}

router.delete("/apk/:filename", authMiddleware, requireRole("admin"), (req: AuthRequest, res: Response) => {
  const filename = req.params.filename;
  if (!filename || !filename.endsWith(".apk") || filename.includes("..")) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const filePath = path.join(APK_DIR, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.json({ deleted: true });
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

export default router;
