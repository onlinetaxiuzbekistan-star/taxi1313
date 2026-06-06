// @ts-nocheck
import https from "https";
import { clog } from "./logger.js";
import { config } from "./config.js";
import { makeBreaker } from "./circuit.js";
import { errorMessage } from "./errors.js";

// chat-id lookup is an idempotent GET → safe to retry.
const telegramBreaker = makeBreaker("telegram-gateway");
// Bot API sendMessage is NOT idempotent (retry → duplicate message) → breaker only.
const telegramApiBreaker = makeBreaker("telegram-api", { retries: 0 });

// Required in production (validated in config.ts); empty in dev/test.
const TELEGRAM_BOT_TOKEN = config.telegram.botToken;
const SMS_GATEWAY_URL = config.telegram.gatewayUrl;

// Raw call: rejects on transport error / timeout / non-ok response so the
// circuit breaker can observe failures.
function rawTelegramRequest(
  method: string,
  payload: object
): Promise<{ ok: boolean; description?: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${TELEGRAM_BOT_TOKEN}/${method}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.ok) resolve({ ok: true, description: json.description });
            else reject(new Error(json.description || "telegram api returned ok=false"));
          } catch {
            reject(new Error(data || "telegram api parse error"));
          }
        });
      }
    );
    req.on("error", (err: Error) => reject(err));
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

// Breaker-guarded wrapper. Preserves the original resolve-only contract:
// returns { ok:false, description } on any failure (including an open circuit).
function telegramRequest(
  method: string,
  payload: object
): Promise<{ ok: boolean; description?: string }> {
  return telegramApiBreaker
    .execute(() => rawTelegramRequest(method, payload))
    .catch((err) => ({ ok: false, description: errorMessage(err) }));
}

async function getChatIdFromSmsGateway(phone: string): Promise<string | null> {
  try {
    const normalized = phone.replace(/\D/g, "");
    const url = SMS_GATEWAY_URL + "/api/telegram/chat-id?phone=" + encodeURIComponent(normalized);
    const res = await telegramBreaker.execute(async () => {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`TG gateway HTTP ${r.status}`);
      return r;
    });
    const data = await res.json() as { chatId?: string };
    return data.chatId ?? null;
  } catch (err) {
    clog.error("[TG-DIRECT] Failed to get chat_id from SMS gateway:", err);
    return null;
  }
}

export async function sendTelegramVerification(phone: string, code: string): Promise<boolean> {
  try {
    const chatId = await getChatIdFromSmsGateway(phone);
    if (!chatId) {
      clog.log("[TG-DIRECT] No Telegram chat_id for " + phone + ", skipping");
      return false;
    }

    const text =
      "\u{1F510} <b>\u041A\u043E\u0434 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F</b>\n\n" +
      "\u0412\u0430\u0448 \u043A\u043E\u0434 \u0434\u043B\u044F \u0432\u0445\u043E\u0434\u0430 \u0432 \u0422\u0430\u043A\u0441\u0438 1313:\n\n" +
      "<code>" + code + "</code>\n\n" +
      "\u23F0 \u041A\u043E\u0434 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043B\u0435\u043D 5 \u043C\u0438\u043D\u0443\u0442";

    const result = await telegramRequest("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    });

    if (result.ok) {
      clog.log("[TG-DIRECT] Verification code sent to " + phone + " via Telegram (chat_id: " + chatId + ")");
      return true;
    } else {
      clog.error("[TG-DIRECT] Failed to send to " + phone + ": " + result.description);
      return false;
    }
  } catch (err) {
    clog.error("[TG-DIRECT] Error sending to " + phone + ":", err);
    return false;
  }
}
