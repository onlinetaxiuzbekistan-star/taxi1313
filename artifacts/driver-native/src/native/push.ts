import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import { API_BASE_URL } from "@/config";

// FCM-ready scaffold (currently inert). The backend's /api/auth/device-token
// endpoint already exists, but the server only *sends* Web Push (VAPID) today —
// so registering an FCM token here is harmless and forward-compatible: the day
// the backend gains an FCM sender, closed-app order pushes start working with
// no client change. Until then, the foreground-service offer poll
// (modules/buxtaxi-background) delivers new-order alerts when minimized.
//
// getDevicePushTokenAsync() throws without a google-services.json / Firebase
// config; we swallow that so the app runs fine before Firebase is set up.

let configured = false;

export function configurePushHandler(): void {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Register the device's native (FCM) push token with the backend. Inert until Firebase is configured. */
export async function registerPushToken(authToken: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return;

    const device = await Notifications.getDevicePushTokenAsync(); // throws w/o Firebase
    const fcmToken = device?.data;
    if (!fcmToken) return;

    await fetch(`${API_BASE_URL}/api/auth/device-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token: fcmToken }),
    });
    console.log("[push] device token registered");
  } catch (e) {
    console.log("[push] FCM not configured yet (inert):", (e as Error)?.message);
  }
}

/** Route a tapped order notification to the incoming-ride screen. */
export function addNotificationTapListener(onIncoming: () => void): { remove: () => void } {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as Record<string, unknown> | undefined;
    if (data?.navigate === "incoming" || data?.type === "new_order") onIncoming();
  });
  return sub;
}
