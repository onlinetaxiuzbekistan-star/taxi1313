import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const SMS_GATEWAY_URL = "http://217.30.171.176:3000/api/messages/send";

interface SmsSettings {
  enabled: boolean;
}

export async function getSmsSettings(): Promise<SmsSettings> {
  const rows = await db.select().from(settingsTable)
    .where(eq(settingsTable.category, "sms"));
  const map = new Map(rows.map(r => [r.key, r.value]));
  return {
    enabled: map.get("sms_enabled") === "true",
  };
}

export async function getNotificationSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(settingsTable)
    .where(eq(settingsTable.category, "notifications"));
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export async function sendSms(phone: string, message: string): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const settings = await getSmsSettings();
    if (!settings.enabled) {
      console.log(`[SMS] Disabled, skipping: ${phone} — ${message.substring(0, 50)}...`);
      return { success: false, error: "sms_disabled" };
    }

    let cleanPhone = phone.replace(/[^0-9+]/g, "");
    if (!cleanPhone.startsWith("+")) {
      if (cleanPhone.startsWith("998")) {
        cleanPhone = "+" + cleanPhone;
      } else if (cleanPhone.length === 9) {
        cleanPhone = "+998" + cleanPhone;
      }
    }

    console.log(`[SMS] Sending via local gateway to ${cleanPhone}`);

    // Auto-detect non-ASCII (cyrillic, etc) → force UCS-2/Unicode encoding
    // so gateway doesn't strip to "???" via GSM-7 default alphabet.
    const isUnicode = /[^\x00-\x7F]/.test(message);
    const payload: Record<string, unknown> = {
      phone: cleanPhone,
      text: message,
      message,
      unicode: isUnicode,
      encoding: isUnicode ? "ucs2" : "gsm7",
      dcs: isUnicode ? 8 : 0,
      datacoding: isUnicode ? 8 : 0,
    };
    console.log(`[SMS] payload: phone=${cleanPhone} unicode=${isUnicode} len=${message.length}`);

    const res = await fetch(SMS_GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // Bound the call so a hung gateway can't stall the SMS queue worker.
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[SMS] Gateway error: ${res.status} ${text}`);
      return { success: false, error: text };
    }

    const data = await res.json() as { success: boolean; messageId?: string; error?: string };
    if (data.success) {
      console.log(`[SMS] Sent to ${cleanPhone} via local gateway, id=${data.messageId}`);
      return { success: true, id: data.messageId };
    } else {
      console.error(`[SMS] Gateway returned error: ${data.error}`);
      return { success: false, error: data.error };
    }
  } catch (err: any) {
    console.error(`[SMS] Error:`, err.message);
    return { success: false, error: err.message };
  }
}

export function formatPhone(phone: string): string {
  let clean = phone.replace(/[^0-9]/g, "");
  if (clean.startsWith("998") && clean.length === 12) {
    return `+${clean}`;
  }
  if (clean.length === 9) {
    return `+998${clean}`;
  }
  return phone;
}
