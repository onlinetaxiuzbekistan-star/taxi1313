import https from "https";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
  throw new Error(
    "TELEGRAM_BOT_TOKEN environment variable is required but was not set. " +
      "Configure it in /opt/taxi1313/.env (see systemd EnvironmentFile).",
  );
}

// Internal chat-id lookup gateway — overridable, with the previous value as default.
const SMS_GATEWAY_URL = process.env.TELEGRAM_GATEWAY_URL || "http://192.168.1.107:3000";

function telegramRequest(
  method: string,
  payload: object
): Promise<{ ok: boolean; description?: string }> {
  return new Promise((resolve) => {
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
            resolve({ ok: json.ok, description: json.description });
          } catch {
            resolve({ ok: false, description: data });
          }
        });
      }
    );
    req.on("error", (err: Error) => resolve({ ok: false, description: err.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, description: "timeout" }); });
    req.write(body);
    req.end();
  });
}

async function getChatIdFromSmsGateway(phone: string): Promise<string | null> {
  try {
    const normalized = phone.replace(/\D/g, "");
    const url = SMS_GATEWAY_URL + "/api/telegram/chat-id?phone=" + encodeURIComponent(normalized);
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json() as { chatId?: string };
    return data.chatId ?? null;
  } catch (err) {
    console.error("[TG-DIRECT] Failed to get chat_id from SMS gateway:", err);
    return null;
  }
}

export async function sendTelegramVerification(phone: string, code: string): Promise<boolean> {
  try {
    const chatId = await getChatIdFromSmsGateway(phone);
    if (!chatId) {
      console.log("[TG-DIRECT] No Telegram chat_id for " + phone + ", skipping");
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
      console.log("[TG-DIRECT] Verification code sent to " + phone + " via Telegram (chat_id: " + chatId + ")");
      return true;
    } else {
      console.error("[TG-DIRECT] Failed to send to " + phone + ": " + result.description);
      return false;
    }
  } catch (err) {
    console.error("[TG-DIRECT] Error sending to " + phone + ":", err);
    return false;
  }
}
