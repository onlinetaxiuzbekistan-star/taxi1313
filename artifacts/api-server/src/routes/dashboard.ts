import { Router } from "express";
import os from "os";
import { execSync } from "child_process";
import { rawDb, getSetting } from "../db/index";
import { getAllModems } from "../services/modem-manager";
import { getQueueDepth, getSmppQueueDepth, getHttpQueueDepth } from "../services/sms-queue";
import { getSmppConnectionCount, getSmppSubmittedToday } from "../smpp-server";
import { getHttpRequestsToday } from "../http-gateway";

const router = Router();

router.get("/dashboard", (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const sentToday = (rawDb.prepare(
    "SELECT COUNT(*) as cnt FROM message_logs WHERE status = 'sent' AND sent_at LIKE ?"
  ).get(today + "%") as { cnt: number }).cnt;

  const failedToday = (rawDb.prepare(
    "SELECT COUNT(*) as cnt FROM message_logs WHERE status = 'failed' AND sent_at LIKE ?"
  ).get(today + "%") as { cnt: number }).cnt;

  const activeCampaigns = (rawDb.prepare(
    "SELECT COUNT(*) as cnt FROM campaigns WHERE status = 'running'"
  ).get() as { cnt: number }).cnt;

  const liveModems = getAllModems();
  const activeModems = liveModems.filter((m) => m.status === "online").length;
  const totalModems = liveModems.length;

  const recentCampaigns = (rawDb.prepare(
    "SELECT * FROM campaigns ORDER BY updated_at DESC LIMIT 5"
  ).all() as Record<string, unknown>[]).map((r) => ({
    id: r["id"], name: r["name"], text: r["text"],
    templateId: r["template_id"] ?? null, contactListId: r["contact_list_id"] ?? null,
    status: r["status"], scheduledAt: r["scheduled_at"] ?? null,
    startedAt: r["started_at"] ?? null, completedAt: r["completed_at"] ?? null,
    total: r["total"], sent: r["sent"], failed: r["failed"],
    createdAt: r["created_at"], updatedAt: r["updated_at"],
  }));

  const recentMessages = (rawDb.prepare(
    "SELECT * FROM message_logs ORDER BY sent_at DESC LIMIT 10"
  ).all() as Record<string, unknown>[]).map((r) => ({
    id: r["id"], queueId: r["queue_id"] ?? null, campaignId: r["campaign_id"] ?? null,
    phone: r["phone"], text: r["text"], source: r["source"], status: r["status"],
    modemPort: r["modem_port"] ?? null, errorMessage: r["error_message"] ?? null,
    messageId: r["message_id"] ?? null, sentAt: r["sent_at"],
  }));

  res.json({
    activeModems,
    totalModems,
    sentToday,
    failedToday,
    queueDepth: getQueueDepth(),
    smppQueueDepth: getSmppQueueDepth(),
    httpQueueDepth: getHttpQueueDepth(),
    activeCampaigns,
    smppConnections: getSmppConnectionCount(),
    httpRequestsToday: getHttpRequestsToday(),
    recentCampaigns,
    recentMessages,
  });
});

router.post("/dashboard/reset-today", (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  rawDb.prepare("DELETE FROM message_logs WHERE sent_at LIKE ?").run(today + "%");
  rawDb.prepare("UPDATE modems SET sent_today = 0, updated_at = CURRENT_TIMESTAMP").run();
  res.json({ success: true });
});

router.post("/dashboard/clear-queue", (_req, res) => {
  const pending = rawDb.prepare("DELETE FROM message_queue WHERE status = 'pending'").run();
  const failed = rawDb.prepare("DELETE FROM message_queue WHERE status = 'failed'").run();
  const stuck = rawDb.prepare(
    "DELETE FROM message_queue WHERE status = 'sending' AND updated_at < datetime('now', '-5 minutes')"
  ).run();
  res.json({
    success: true,
    deleted: {
      pending: pending.changes,
      failed: failed.changes,
      stuckSending: stuck.changes,
      total: pending.changes + failed.changes + stuck.changes,
    },
  });
});

router.get("/smpp-stats", (_req, res) => {
  const smppPort = parseInt(getSetting("smpp_port") || "2775", 10);
  res.json({
    running: true,
    port: smppPort,
    connections: getSmppConnectionCount(),
    submittedToday: getSmppSubmittedToday(),
  });
});

function getDiskUsage(): { total: number; used: number; free: number; percent: number } {
  try {
    const output = execSync("df -B1 / | tail -1", { timeout: 3000, encoding: "utf8" });
    const parts = output.trim().split(/\s+/);
    const total = parseInt(parts[1]!, 10);
    const used = parseInt(parts[2]!, 10);
    const free = parseInt(parts[3]!, 10);
    return { total, used, free, percent: total > 0 ? Math.round((used / total) * 100) : 0 };
  } catch {
    return { total: 0, used: 0, free: 0, percent: 0 };
  }
}

function getDbSize(): number {
  try {
    const output = execSync("stat -c%s /var/lib/sms-gateway/sms-data.db 2>/dev/null || echo 0", { timeout: 3000, encoding: "utf8" });
    return parseInt(output.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function getServiceUptime(): number {
  try {
    const output = execSync(
      "systemctl show sms-gateway --property=ActiveEnterTimestamp --value 2>/dev/null || echo ''",
      { timeout: 3000, encoding: "utf8" }
    ).trim();
    if (!output) return 0;
    const start = new Date(output).getTime();
    return isNaN(start) ? 0 : Math.floor((Date.now() - start) / 1000);
  } catch {
    return 0;
  }
}

router.get("/server-monitor", (_req, res) => {
  const cpus = os.cpus();
  const cpuCount = cpus.length;

  const loadAvg = os.loadavg();

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const disk = getDiskUsage();
  const dbSize = getDbSize();

  const uptime = os.uptime();
  const serviceUptime = getServiceUptime();

  const nodeMemUsage = process.memoryUsage();

  res.json({
    cpu: {
      count: cpuCount,
      model: cpus[0]?.model ?? "unknown",
      loadAvg1: Math.round(loadAvg[0]! * 100) / 100,
      loadAvg5: Math.round(loadAvg[1]! * 100) / 100,
      loadAvg15: Math.round(loadAvg[2]! * 100) / 100,
      usagePercent: Math.round((loadAvg[0]! / cpuCount) * 100),
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      percent: Math.round((usedMem / totalMem) * 100),
    },
    disk: {
      total: disk.total,
      used: disk.used,
      free: disk.free,
      percent: disk.percent,
    },
    process: {
      rss: nodeMemUsage.rss,
      heapUsed: nodeMemUsage.heapUsed,
      heapTotal: nodeMemUsage.heapTotal,
      external: nodeMemUsage.external,
    },
    dbSizeBytes: dbSize,
    uptimeSeconds: uptime,
    serviceUptimeSeconds: serviceUptime,
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    nodeVersion: process.version,
  });
});

export default router;
