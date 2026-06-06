// @ts-nocheck
import { Router, type IRouter } from "express";
import { clog } from "../lib/logger.js";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authMiddleware, requireRole, AuthRequest } from "../middlewares/auth.js";
import { logActivity } from "../lib/activity.js";
import { refreshCache } from "../lib/settingsCache.js";
import { broadcastToAll } from "../lib/websocket.js";
import { z } from "zod";
import { validateBody } from "../middlewares/validate.js";

const batchSettingsBodySchema = z.object({ settings: z.array(z.any()) }).passthrough();
const updateSettingBodySchema = z.object({}).passthrough();

const router: IRouter = Router();

const SECRET_SETTING_KEYS = new Set(["eskiz_password", "atmos_consumer_secret", "atmos_consumer_key", "payme_merchant_key"]);

function redactSecrets<T extends { key: string; value: string }>(settings: T[]): T[] {
  return settings.map(s =>
    SECRET_SETTING_KEYS.has(s.key) && s.value
      ? { ...s, value: s.value.length > 0 ? "••••••••" : "" }
      : s
  );
}

const DEFAULT_SETTINGS = [
  { key: "platform_name", value: "Такси 1313", label: "Название платформы", category: "general" },
  { key: "support_phone", value: "+998901234567", label: "Телефон поддержки", category: "general" },
  { key: "timezone", value: "Asia/Tashkent", label: "Часовой пояс", category: "general" },
  { key: "default_language", value: "ru", label: "Язык по умолчанию", category: "general" },

  { key: "auto_dispatch_enabled", value: "true", label: "Автоназначение водителей", category: "dispatch" },
  { key: "driver_search_radius_km", value: "50", label: "Радиус поиска водителей (км)", category: "dispatch" },
  { key: "offer_timeout_seconds", value: "15", label: "Таймаут предложения (сек)", category: "dispatch" },
  { key: "max_offers_per_round", value: "5", label: "Водителей за раунд", category: "dispatch" },
  { key: "max_consecutive_ignores", value: "5", label: "Игноров до бана", category: "dispatch" },
  { key: "ban_duration_minutes", value: "10", label: "Длительность бана (мин)", category: "dispatch" },
  { key: "queue_enabled", value: "true", label: "Очередь водителей", category: "dispatch" },
  { key: "queue_priority_mode", value: "fifo", label: "Режим приоритета очереди", category: "dispatch" },
  { key: "retry_on_reject", value: "true", label: "Повтор при отклонении", category: "dispatch" },
  { key: "max_retry_count", value: "3", label: "Макс. повторов", category: "dispatch" },
  { key: "auto_next_order_enabled", value: "true", label: "Авто-следующий заказ после завершения", category: "dispatch" },

  { key: "time_window_minutes", value: "60", label: "Окно попутчиков (мин)", category: "routing" },
  { key: "max_detour_minutes", value: "15", label: "Макс. крюк попутчика (мин)", category: "routing" },
  { key: "default_seats", value: "4", label: "Мест по умолчанию", category: "routing" },
  { key: "allow_multi_passenger", value: "true", label: "Попутчики (pool)", category: "routing" },
  { key: "waypoints_max", value: "3", label: "Макс. промежуточных точек", category: "routing" },
  { key: "route_optimization", value: "fastest", label: "Оптимизация маршрута", category: "routing" },

  { key: "surge_min", value: "1.0", label: "Мин. множитель", category: "pricing" },
  { key: "surge_max", value: "3.0", label: "Макс. множитель", category: "pricing" },
  { key: "demand_supply_multiplier", value: "1.0", label: "Базовый множитель спрос/предложение", category: "pricing" },
  { key: "demand_threshold", value: "1.5", label: "Порог спроса (ratio)", category: "pricing" },
  { key: "demand_surge_bonus", value: "0.3", label: "Бонус при высоком спросе", category: "pricing" },
  { key: "peak_morning_start", value: "07:00", label: "Утренний пик — начало", category: "pricing" },
  { key: "peak_morning_end", value: "10:00", label: "Утренний пик — конец", category: "pricing" },
  { key: "peak_morning_bonus", value: "0.2", label: "Утренний пик — бонус", category: "pricing" },
  { key: "peak_evening_start", value: "17:00", label: "Вечерний пик — начало", category: "pricing" },
  { key: "peak_evening_end", value: "20:00", label: "Вечерний пик — конец", category: "pricing" },
  { key: "peak_evening_bonus", value: "0.2", label: "Вечерний пик — бонус", category: "pricing" },
  { key: "night_start", value: "23:00", label: "Ночное время — начало", category: "pricing" },
  { key: "night_end", value: "06:00", label: "Ночное время — конец", category: "pricing" },
  { key: "night_bonus", value: "0.15", label: "Ночное время — бонус (×1.15)", category: "pricing" },
  { key: "urgent_multiplier", value: "1.2", label: "Срочный заказ — множитель (×1.2)", category: "pricing" },
  { key: "round_trip_discount_percent", value: "10", label: "Скидка туда-обратно (%)", category: "pricing" },

  { key: "commission_percent", value: "15", label: "Комиссия платформы (%)", category: "finance" },
  { key: "commission_fixed", value: "0", label: "Фикс. комиссия (сум)", category: "finance" },
  { key: "cancel_penalty_amount", value: "10000", label: "Штраф за отмену (сум)", category: "finance" },
  { key: "ignore_penalty_amount", value: "5000", label: "Штраф за игнор (сум)", category: "finance" },
  { key: "milestone_bonus_amount", value: "50000", label: "Бонус за веху (сум)", category: "finance" },
  { key: "milestone_interval", value: "10", label: "Интервал вехи (поездки)", category: "finance" },
  { key: "referral_bonus_inviter", value: "30000", label: "Реферал — пригласивший (сум)", category: "finance" },
  { key: "referral_bonus_invitee", value: "20000", label: "Реферал — приглашённый (сум)", category: "finance" },
  { key: "min_balance_online", value: "0", label: "Мин. баланс для онлайна (сум)", category: "finance" },
  { key: "payout_min_amount", value: "50000", label: "Мин. сумма вывода (сум)", category: "finance" },
  { key: "payout_auto", value: "false", label: "Автовыплаты", category: "finance" },

  { key: "driver_approval_required", value: "true", label: "Проверка водителей", category: "drivers" },
  { key: "driver_docs_required", value: "true", label: "Документы обязательны", category: "drivers" },
  { key: "driver_min_rating", value: "3.5", label: "Мин. рейтинг водителя", category: "drivers" },
  { key: "driver_max_idle_minutes", value: "30", label: "Авто-офлайн при простое (мин)", category: "drivers" },
  { key: "driver_location_interval_sec", value: "120", label: "Интервал GPS (сек)", category: "drivers" },
  { key: "driver_default_seats", value: "4", label: "Мест по умолчанию", category: "drivers" },
  { key: "min_driver_balance", value: "0", label: "Мин. баланс для работы (сум)", category: "drivers" },

  { key: "max_active_orders", value: "20", label: "Макс. активных заказов", category: "market" },
  { key: "max_orders_per_day", value: "30", label: "Макс. заказов в сутки", category: "market" },
  { key: "max_transfers", value: "1", label: "Макс. передач заказа", category: "market" },
  { key: "transfer_time_limit_minutes", value: "10", label: "Лимит на передачу (мин)", category: "market" },
  { key: "min_order_price", value: "10000", label: "Мин. цена заказа (сум)", category: "market" },
  { key: "max_order_price", value: "5000000", label: "Макс. цена заказа (сум)", category: "market" },
  { key: "market_enabled", value: "true", label: "Маркетплейс включён", category: "market" },
  { key: "market_bidding", value: "false", label: "Торг по цене", category: "market" },

  { key: "eskiz_email", value: "", label: "Eskiz Email", category: "sms" },
  { key: "eskiz_password", value: "", label: "Eskiz Пароль", category: "sms" },
  { key: "eskiz_sender", value: "4546", label: "Имя отправителя (from)", category: "sms" },
  { key: "sms_enabled", value: "false", label: "SMS включён", category: "sms" },

  { key: "sms_on_order_accepted", value: "true", label: "СМС: Заказ принят водителем", category: "notifications" },
  { key: "sms_on_order_in_progress", value: "true", label: "СМС: Водитель в пути", category: "notifications" },
  { key: "sms_on_order_completed", value: "true", label: "СМС: Заказ завершён", category: "notifications" },
  { key: "sms_on_order_cancelled", value: "true", label: "СМС: Заказ отменён", category: "notifications" },
  { key: "sms_on_verification_code", value: "true", label: "СМС: Код подтверждения (6 цифр)", category: "notifications" },
  { key: "order_auto_cancel_enabled", value: "true", label: "Авто-отмена просроченных заказов", category: "notifications" },
  { key: "order_auto_cancel_minutes", value: "120", label: "Время до авто-отмены (мин)", category: "notifications" },
  { key: "sms_text_accepted", value: "Такси 1313: Ваш заказ принят. Водитель: {driver}, тел: {driver_phone}, авто: {car}. Ожидайте!", category: "notifications" },
  { key: "sms_text_in_progress", value: "Такси 1313: Водитель выехал к вам. {driver}, тел: {driver_phone}.", category: "notifications" },
  { key: "sms_text_completed", value: "Такси 1313: Поездка завершена. Спасибо за выбор Такси 1313!", category: "notifications" },
  { key: "sms_text_cancelled", value: "Такси 1313: Ваш заказ отменён.", category: "notifications" },
  { key: "sms_text_auto_cancelled", value: "Такси 1313: К сожалению, мы не смогли найти машину для вашего заказа. Приносим извинения за неудобства.", category: "notifications" },
  { key: "sms_text_verification", value: "Такси 1313: Ваш код подтверждения: {code}", category: "notifications" },

  { key: "atmos_consumer_key", value: "", label: "Atmos Consumer Key", category: "payments" },
  { key: "atmos_consumer_secret", value: "", label: "Atmos Consumer Secret", category: "payments" },
  { key: "atmos_store_id", value: "", label: "Atmos Store ID", category: "payments" },
  { key: "atmos_terminal_id", value: "", label: "Atmos Terminal ID", category: "payments" },
  { key: "atmos_enabled", value: "false", label: "Atmos включён", category: "payments" },

  { key: "payme_enabled", value: "false", label: "Payme включён", category: "payments" },
  { key: "payme_merchant_id", value: "", label: "Payme Merchant ID", category: "payments" },
  { key: "payme_merchant_key", value: "", label: "Payme Merchant Key", category: "payments" },
  { key: "payme_min_amount", value: "100", label: "Payme мин. сумма (тийин)", category: "payments" },
  { key: "payme_max_amount", value: "1000000000", label: "Payme макс. сумма (тийин)", category: "payments" },
];

router.get("/", authMiddleware, requireRole("dispatcher", "admin"), async (req: AuthRequest, res) => {
  try {
    await db.update(settingsTable)
      .set({ category: "market" })
      .where(eq(settingsTable.category, "marketplace"));
    for (const s of DEFAULT_SETTINGS) {
      await db.insert(settingsTable).values(s).onConflictDoNothing();
    }
    const category = req.query.category as string | undefined;
    let query = db.select().from(settingsTable);
    if (category) {
      query = query.where(eq(settingsTable.category, category)) as any;
    }
    const settings = await query.orderBy(settingsTable.category, settingsTable.key);
    res.json({ settings: redactSecrets(settings) });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

const NUMERIC_SETTINGS = new Set([
  "commission_percent", "commission_fixed", "max_active_orders", "max_orders_per_day",
  "max_transfers", "transfer_time_limit_minutes", "min_order_price", "max_order_price",
  "cancel_penalty_amount", "ignore_penalty_amount", "milestone_bonus_amount", "milestone_interval",
  "referral_bonus_inviter", "referral_bonus_invitee", "min_balance_online", "max_offers_per_round",
  "driver_search_radius_km", "offer_timeout_seconds", "max_consecutive_ignores", "ban_duration_minutes",
  "surge_min", "surge_max", "demand_supply_multiplier", "demand_threshold", "demand_surge_bonus",
  "peak_morning_bonus", "peak_evening_bonus", "night_bonus", "urgent_multiplier",
  "max_retry_count", "time_window_minutes", "max_detour_minutes", "default_seats",
  "waypoints_max", "driver_min_rating", "driver_max_idle_minutes",
  "driver_location_interval_sec", "driver_default_seats", "min_driver_balance", "payout_min_amount",
  "payme_min_amount", "payme_max_amount",
]);

const TIME_SETTINGS = new Set([
  "peak_morning_start", "peak_morning_end", "peak_evening_start", "peak_evening_end",
  "night_start", "night_end",
]);

router.patch("/batch", authMiddleware, requireRole("admin", "dispatcher"), validateBody(batchSettingsBodySchema), async (req: AuthRequest, res) => {
  try {
    const { settings: items } = req.body as { settings: { key: string; value: string }[] };
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "validation_error", message: "Массив настроек обязателен" });
      return;
    }
    const results = [];
    for (const item of items) {
      const strVal = String(item.value);
      if (SECRET_SETTING_KEYS.has(item.key) && strVal === "••••••••") continue;
      if (NUMERIC_SETTINGS.has(item.key)) {
        const num = parseFloat(strVal);
        if (!Number.isFinite(num)) continue;
        if (item.key !== "min_driver_balance" && num < 0) continue;
      }
      if (TIME_SETTINGS.has(item.key) && !/^\d{1,2}:\d{2}$/.test(strVal)) continue;
      const [setting] = await db.update(settingsTable)
        .set({ value: strVal, updatedAt: new Date() })
        .where(eq(settingsTable.key, item.key))
        .returning();
      if (setting) {
        const logVal = SECRET_SETTING_KEYS.has(item.key) ? "***" : strVal;
        await logActivity(req.userId!, "", "update", "setting", setting.id, `Настройка "${setting.label}": ${logVal}`);
        results.push(setting);
      }
    }
    if (results.length > 0) {
      refreshCache(results.map(s => ({ key: s.key, value: s.value })));
      clog.log(`[SETTINGS] Batch update: ${results.length} settings refreshed in cache`);
      broadcastToAll({
        type: "settings_updated",
        keys: results.map(s => s.key),
        count: results.length,
      });
    }
    res.json({ updated: results.length, settings: redactSecrets(results) });
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.patch("/:key", authMiddleware, requireRole("admin", "dispatcher"), validateBody(updateSettingBodySchema), async (req: AuthRequest, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    if (value === undefined || value === null) {
      res.status(400).json({ error: "validation_error", message: "Значение обязательно" });
      return;
    }
    const strVal = String(value);

    if (SECRET_SETTING_KEYS.has(key) && strVal === "••••••••") {
      res.status(200).json({ message: "unchanged" });
      return;
    }

    if (NUMERIC_SETTINGS.has(key)) {
      const num = parseFloat(strVal);
      if (!Number.isFinite(num)) {
        res.status(400).json({ error: "validation_error", message: "Значение должно быть числом" });
        return;
      }
      if (key !== "min_driver_balance" && num < 0) {
        res.status(400).json({ error: "validation_error", message: "Значение должно быть неотрицательным числом" });
        return;
      }
    }

    if (TIME_SETTINGS.has(key) && !/^\d{1,2}:\d{2}$/.test(strVal)) {
      res.status(400).json({ error: "validation_error", message: "Формат времени: ЧЧ:ММ" });
      return;
    }

    const [setting] = await db.update(settingsTable)
      .set({ value: strVal, updatedAt: new Date() })
      .where(eq(settingsTable.key, key))
      .returning();
    if (!setting) { res.status(404).json({ error: "not_found" }); return; }
    refreshCache([{ key: setting.key, value: setting.value }]);
    clog.log(`[SETTINGS] Single update: ${setting.key} refreshed in cache`);
    const logValSingle = SECRET_SETTING_KEYS.has(key) ? "***" : strVal;
    await logActivity(req.userId!, "", "update", "setting", setting.id, `Настройка "${setting.label}": ${logValSingle}`);
    const [redacted] = redactSecrets([setting]);
    res.json(redacted);
  } catch (err) {
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
