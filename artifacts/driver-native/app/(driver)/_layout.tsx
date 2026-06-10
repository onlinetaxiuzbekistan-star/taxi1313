import { useState, useEffect, useRef } from "react";
import { Alert, BackHandler, ToastAndroid, Platform, AppState } from "react-native";
import { Tabs, Redirect, useRouter } from "expo-router";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import { preloadSounds } from "@/lib/sounds";
import { isRideActive } from "@/lib/ride-lock";

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

  // Keep the screen awake the whole time the driver is in the app (logged in) —
  // NOT just while user.status === "online". That status is server-derived and
  // can flip to offline (presence reaper, a brief GPS lapse, a status blip); if
  // keep-awake were tied to it, the screen would sleep WHILE THE DRIVER SITS
  // WAITING FOR AN ORDER, the JS thread would freeze, and the incoming offer
  // would be missed. Gating on the session (token) instead keeps the screen on
  // the entire time the app is open; it also keeps the JS thread alive so GPS
  // keeps flowing and the driver is never falsely reaped offline. Releases
  // automatically when the app is backgrounded/closed.
  useEffect(() => {
    if (!token) return;
    activateKeepAwakeAsync("driver-app").catch(() => {});
    return () => {
      try {
        deactivateKeepAwake("driver-app");
      } catch {}
    };
  }, [token]);

  // When the app returns to the foreground, immediately refetch /me. While
  // backgrounded the JS thread is frozen, so user.lastLocationUpdate goes stale
  // and the GPS indicator drops to red; the native GPS service kept posting fixes
  // to the server the whole time, so one fresh /me flips GPS back to green at once
  // (instead of waiting for the next 8s poll tick).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshUser();
    });
    return () => sub.remove();
  }, [refreshUser]);

  // Hardware back: require a DOUBLE press within 2s to leave the app (only at a
  // navigation root — pushed screens still pop normally on the first press).
  const lastBack = useRef(0);
  // Latest online state, read inside the back handler without re-subscribing.
  const onlineRef = useRef(false);
  onlineRef.current = user?.status === "online" || user?.status === "busy";
  useEffect(() => {
    const onBack = () => {
      if (router.canGoBack()) return false; // let navigation handle in-app back
      // Active ride → never allow exit (back / swipe). Finish the ride first.
      if (isRideActive()) {
        if (Platform.OS === "android") ToastAndroid.show(t("finish_ride_to_exit"), ToastAndroid.SHORT);
        return true;
      }
      // Online → cannot leave the app until the driver goes Offline themselves.
      // (Leaving while online would silently stop them receiving orders.)
      if (onlineRef.current) {
        if (Platform.OS === "android") ToastAndroid.show(t("go_offline_to_exit"), ToastAndroid.SHORT);
        return true;
      }
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
  // While ONLINE the driver must go Offline first — closing the app online would
  // silently stop them receiving orders, so we block exit and tell them.
  const handleExit = () => {
    if (isOnline) {
      Alert.alert(t("exit_q"), t("go_offline_to_exit"), [{ text: t("ok") }]);
      return;
    }
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
        <Tabs.Screen name="board" />
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
