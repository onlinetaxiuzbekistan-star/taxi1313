import { Router, type IRouter } from "express";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { liveMetrics, liveAlerts, liveIncidents, recoveryActions, getRideIntervalMultiplier, getOptimizationState, rollbackToGeneration, getActionEffectiveness, getTrendAnalysis, getAIStatus, getMetaOptimizerStatus, getRevenueAIStatus, triggerManualRecovery, getDecisionSuggestions, getAutoExecState, setAutoExecEnabled, setAutoExecMode } from "../../tools/simulation/stress-ws-simulation.js";
import { getRevenueAIProdState, getRevenueAIProdLogs, enableRevenueAIProd, disableRevenueAIProd, isRevenueAIProdEnabled, getSafetyGuardState, toggleShadowMode } from "../lib/revenue-ai-prod.js";
import { authMiddleware, requireRole } from "../middlewares/auth.js";
import { config } from "../lib/config.js";
import { validateBody } from "../middlewares/validate.js";
import { z } from "zod";

const router: IRouter = Router();

// These are admin-only, SIMULATION_ENABLED-gated diagnostic endpoints. Validate
// that the body is a JSON object; the handlers enforce field-level rules
// (mode ∈ {safe,aggressive}, generation:number, action required, …).
const simBodySchema = z.object({}).passthrough();
router.use(authMiddleware, requireRole("admin"));

// Simulation/stress endpoints are dev/diagnostic tooling, not production features.
// Gate them behind SIMULATION_ENABLED (default OFF) so they're inert in prod —
// respond 404 to avoid disclosing their existence.
const SIMULATION_ENABLED = config.simulationEnabled;
router.use((_req, res, next) => {
  if (!SIMULATION_ENABLED) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
});

router.get("/stress", (_req, res) => {
  res.json(liveMetrics);
});

router.get("/stress/alerts", (req, res) => {
  const since = req.query.since as string | undefined;
  if (since) {
    const sinceNum = parseInt(since.replace("alert-", ""), 10) || 0;
    const filtered = liveAlerts.filter(a => {
      const num = parseInt(a.id.replace("alert-", ""), 10) || 0;
      return num > sinceNum;
    });
    res.json(filtered);
  } else {
    res.json(liveAlerts);
  }
});

router.post("/stress/alerts/:id/ack", validateBody(simBodySchema), (req, res) => {
  const alert = liveAlerts.find(a => a.id === req.params.id);
  if (alert) {
    alert.acknowledged = true;
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: "not_found" });
  }
});

router.post("/stress/alerts/ack-all", validateBody(simBodySchema), (_req, res) => {
  for (const a of liveAlerts) {
    a.acknowledged = true;
  }
  res.json({ ok: true, count: liveAlerts.length });
});

router.get("/stress/alerts/log", (_req, res) => {
  const logPath = join(process.cwd(), "stress-alerts.json");
  try {
    if (existsSync(logPath)) {
      const raw = readFileSync(logPath, "utf-8");
      res.json(JSON.parse(raw));
    } else {
      res.json([]);
    }
  } catch {
    res.json([]);
  }
});

router.get("/stress/incidents", (_req, res) => {
  res.json(liveIncidents);
});

router.get("/stress/incidents/active", (_req, res) => {
  res.json(liveIncidents.filter(i => i.active));
});

router.get("/stress/effectiveness", (_req, res) => {
  res.json(getActionEffectiveness());
});

router.get("/stress/recovery", (req, res) => {
  const since = req.query.since as string | undefined;
  if (since) {
    const sinceNum = parseInt(since.replace("recovery-", ""), 10) || 0;
    const filtered = recoveryActions.filter(a => {
      const num = parseInt(a.id.replace("recovery-", ""), 10) || 0;
      return num > sinceNum;
    });
    res.json({ actions: filtered, multiplier: getRideIntervalMultiplier() });
  } else {
    res.json({ actions: recoveryActions, multiplier: getRideIntervalMultiplier() });
  }
});

router.get("/stress/decision-suggestions", (req, res) => {
  const alertType = req.query.alert_type as string | undefined;
  res.json(getDecisionSuggestions(alertType));
});

router.get("/stress/auto-exec", (_req, res) => {
  res.json(getAutoExecState());
});

router.post("/stress/auto-exec/toggle", validateBody(simBodySchema), (req, res) => {
  const { enabled } = req.body;
  setAutoExecEnabled(!!enabled);
  res.json({ ok: true, enabled: !!enabled });
});

router.post("/stress/auto-exec/mode", validateBody(simBodySchema), (req, res) => {
  const { mode } = req.body;
  if (mode !== "safe" && mode !== "aggressive") {
    res.status(400).json({ ok: false, message: "mode must be 'safe' or 'aggressive'" });
    return;
  }
  setAutoExecMode(mode);
  res.json({ ok: true, mode });
});

router.post("/stress/recovery/apply", validateBody(simBodySchema), async (req, res) => {
  const { action } = req.body;
  if (!action) {
    res.status(400).json({ ok: false, message: "action is required" });
    return;
  }
  const result = await triggerManualRecovery(action);
  res.json(result);
});

router.get("/stress/optimizer", (_req, res) => {
  res.json(getOptimizationState());
});

router.post("/stress/optimizer/rollback", validateBody(simBodySchema), (req, res) => {
  const { generation } = req.body || {};
  if (typeof generation !== "number") {
    res.status(400).json({ error: "generation required" });
    return;
  }
  const result = rollbackToGeneration(generation);
  res.json(result);
});

router.get("/stress/trend", (_req, res) => {
  res.json(getTrendAnalysis());
});

router.get("/stress/ai-status", (_req, res) => {
  res.json(getAIStatus());
});

router.get("/stress/meta-optimizer", (_req, res) => {
  res.json(getMetaOptimizerStatus());
});

router.get("/stress/revenue-ai", (_req, res) => {
  res.json(getRevenueAIStatus());
});

router.get("/stress/revenue-ai-prod", (_req, res) => {
  res.json({
    ...getRevenueAIProdState(),
    logs: getRevenueAIProdLogs(),
    safety: getSafetyGuardState(),
  });
});

router.post("/stress/revenue-ai-prod/toggle", validateBody(simBodySchema), (req, res) => {
  const { enabled } = req.body || {};
  if (enabled === true) {
    enableRevenueAIProd();
  } else {
    disableRevenueAIProd();
  }
  res.json({ success: true, enabled: isRevenueAIProdEnabled() });
});

router.post("/stress/revenue-ai-prod/shadow", validateBody(simBodySchema), (req, res) => {
  const { enabled } = req.body || {};
  toggleShadowMode(enabled === true);
  res.json({ success: true, shadow_mode: enabled === true });
});

router.get("/stress/history", (_req, res) => {
  const histPath = join(process.cwd(), "stress-history.json");
  try {
    if (existsSync(histPath)) {
      const raw = readFileSync(histPath, "utf-8");
      const history = JSON.parse(raw);
      res.json(history);
    } else {
      res.json([]);
    }
  } catch {
    res.json([]);
  }
});

export default router;
