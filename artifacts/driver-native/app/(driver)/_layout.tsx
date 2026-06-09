import { useState, useEffect, useRef } from "react";
import { Alert, BackHandler, ToastAndroid, Platform } from "react-native";
import { Tabs, Redirect, useRouter } from "expo-router";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import { preloadSounds } from "@/lib/sounds";

import { useAuth } from "@/hooks/use-auth";
import { useRideWebSocket } from "@/hooks/use-ride-websocket";
import { useOnlineService } from "@/hooks/use-online-service";
import { DriverHeader } from "@/components/DriverHeader";
import { DriverTabBar } from "@/components/DriverTabBar";
import { IncomingOfferModal } from "@/features/orders/components/IncomingOfferModal";
import { NotificationBanner } from "@/features/notifications/NotificationBanner";
import { UnreadProvider } from "@/features/chat/unread";
import { VoiceCallProvider } from "@/features/voice/VoiceCallProvider";
import { DEMO_DRIVER } from "@/lib/driver";
import { PREVIEW_MODE, API_BASE_URL } from "@/config";
import { colors } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import type { DriverUser } from "@/types";

// The driver tab shell — equivalent of web DriverLayout. A shared dark header
// (callsign/balance/online-toggle/exit) sits above the active tab; a custom
// 4-tab bar (Заказы/Срочные/Чат/Профиль) sits below. expo-router <Tabs> drives
// real navigation while DriverHeader/DriverTabBar control the look.
export default function DriverShellLayout() {
  const { t } = useT();
  const router = useRouter();
  const { user, token, hydrated, logout, refreshUser } = useAuth();

  // Establish the driver WebSocket whenever we have a session (no-op in preview).
  useRideWebSocket(token);

  // Native background capabilities: foreground GPS service, offer-poll
  // notifications, battery exemption, GPS->WS, FCM token. (Android; no-op on web.)
  useOnlineService();

  // Preload bundled notification sounds so the first event plays instantly.
  useEffect(() => {
    preloadSounds();
  }, []);

  // Keep the screen awake while the driver is online (no screen lock/dim).
  const online = user?.status === "online" || user?.status === "busy";
  useEffect(() => {
    if (!online) {
      try {
        deactivateKeepAwake("driver-online");
      } catch {}
      return;
    }
    activateKeepAwakeAsync("driver-online").catch(() => {});
    return () => {
      try {
        deactivateKeepAwake("driver-online");
      } catch {}
    };
  }, [online]);

  // Hardware back: require a DOUBLE press within 2s to leave the app (only at a
  // navigation root — pushed screens still pop normally on the first press).
  const lastBack = useRef(0);
  useEffect(() => {
    const onBack = () => {
      if (router.canGoBack()) return false; // let navigation handle in-app back
      const now = Date.now();
      if (now - lastBack.current < 2000) {
        BackHandler.exitApp();
        return true;
      }
      lastBack.current = now;
      if (Platform.OS === "android") ToastAndroid.show(t("press_back_again"), ToastAndroid.SHORT);
      return true;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBack);
    return () => sub.remove();
  }, [router, t]);

  const [toggling, setToggling] = useState(false);
  // Preview-only: lets the online/offline toggle visibly flip without a backend.
  const [demoStatus, setDemoStatus] = useState<"online" | "offline">("online");

  if (!hydrated) return null;

  const activeUser: DriverUser | null =
    user ?? (PREVIEW_MODE ? { ...DEMO_DRIVER, status: demoStatus } : null);

  if (!activeUser) return <Redirect href="/driver-login" />;

  const isOnline = activeUser.status === "online" || activeUser.status === "busy";

  // Red top-right button = EXIT the app (like the WebView app's exitApp), NOT
  // logout. Logout (clearing the session) lives only in Profile. Confirm first.
  const handleExit = () => {
    Alert.alert(t("exit_q"), t("exit_sub"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("go_offline_btn"), style: "destructive", onPress: () => BackHandler.exitApp() },
    ]);
  };

  // Real status toggle — ported from web DriverLayout.tsx toggleStatus. Flipping
  // user.status on the server (then refreshUser) is what drives useOnlineService
  // to start/stop the native foreground service.
  const handleToggleStatus = async () => {
    // Preview/demo (no real auth): just flip the cosmetic status.
    if (!user || !token) {
      setDemoStatus((s) => (s === "online" ? "offline" : "online"));
      return;
    }
    const newStatus = isOnline ? "offline" : "online";
    setToggling(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/drivers/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        refreshUser(); // refetch /me -> user.status updates -> useOnlineService reacts
      } else {
        const err = await res.json().catch(() => ({}) as any);
        if (err?.error === "driver_banned") {
          Alert.alert(t("banned_title"), err?.message || "");
          refreshUser();
        } else if (err?.error === "photo_required") {
          Alert.alert(t("photo_control"), err?.message || "");
        } else {
          Alert.alert(t("err"), err?.message || err?.error || t("status_failed"));
        }
      }
    } catch {
      Alert.alert(t("err_network"), t("err_network_sub"));
    } finally {
      setToggling(false);
    }
  };

  return (
    <UnreadProvider>
      <VoiceCallProvider>
      <Tabs
        tabBar={(props) => <DriverTabBar {...props} />}
        screenOptions={{
          headerShown: true,
          header: () => (
            <DriverHeader
              user={activeUser}
              toggling={toggling}
              onToggleStatus={handleToggleStatus}
              onExit={handleExit}
            />
          ),
          sceneStyle: { backgroundColor: colors.background },
        }}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="urgent" />
        <Tabs.Screen name="chat" />
        <Tabs.Screen name="profile" />
      </Tabs>

      {/* Global incoming-order offer + push banners (work on any tab) */}
      {user ? <IncomingOfferModal /> : null}
      {user ? <NotificationBanner /> : null}
      </VoiceCallProvider>
    </UnreadProvider>
  );
}
