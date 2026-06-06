import { db, ridesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendSms, getNotificationSettings } from "./sms.js";
import { enqueueSms } from "./queues/sms.queue.js";
import { sendTelegramVerification } from "./telegram-direct.js";

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] || "");
}

export async function notifyRideStatusChange(rideId: number, newStatus: string) {
  try {
    const notif = await getNotificationSettings();

    let settingKey = "";
    let textKey = "";

    switch (newStatus) {
      case "accepted":
        settingKey = "sms_on_order_accepted";
        textKey = "sms_text_accepted";
        break;
      case "in_progress":
        settingKey = "sms_on_order_in_progress";
        textKey = "sms_text_in_progress";
        break;
      case "completed":
        settingKey = "sms_on_order_completed";
        textKey = "sms_text_completed";
        break;
      case "cancelled":
        settingKey = "sms_on_order_cancelled";
        textKey = "sms_text_cancelled";
        break;
      default:
        return;
    }

    if (notif[settingKey] === "false") return;

    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId));
    if (!ride || !ride.riderPhone) return;

    let driver: any = null;
    if (ride.driverId) {
      const [d] = await db.select().from(usersTable).where(eq(usersTable.id, ride.driverId));
      driver = d;
    }

    const template = notif[textKey] || "Такси 1313: Статус заказа — " + newStatus;
    const vars: Record<string, string> = {
      driver: driver?.name || "",
      driver_phone: driver?.phone || "",
      car: [driver?.carBrand, driver?.carModel, driver?.carNumber].filter(Boolean).join(" ") || "",
      status: newStatus,
      price: ride.price ? Number(ride.price).toLocaleString("ru-RU") : "",
      from: ride.fromAddress || "",
      to: ride.toAddress || "",
    };

    const message = interpolate(template, vars);
    await sendSms(ride.riderPhone, message);
  } catch (err) {
    console.error("[SMS-NOTIF] Error for ride " + rideId + ", status=" + newStatus + ":", err);
  }
}

export async function sendVerificationSms(phone: string, code: string) {
  try {
    const notif = await getNotificationSettings();
    if (notif["sms_on_verification_code"] === "false") return;

    const telegramSent = await sendTelegramVerification(phone, code);

    if (telegramSent) {
      console.log("[VERIFY] Code delivered via Telegram to " + phone + ", sending SMS as backup");
    } else {
      console.log("[VERIFY] Telegram not available for " + phone + ", sending SMS only");
    }

    const template = notif["sms_text_verification"] || "Такси 1313: Ваш код подтверждения: {code}";
    const message = interpolate(template, { code });
    await enqueueSms(phone, message);
  } catch (err) {
    console.error("[SMS-NOTIF] Verification SMS error for " + phone + ":", err);
  }
}
