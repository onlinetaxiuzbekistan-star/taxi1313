import { useState } from "react";
import { Tabs, Redirect } from "expo-router";

import { useAuth } from "@/hooks/use-auth";
import { useRideWebSocket } from "@/hooks/use-ride-websocket";
import { DriverHeader } from "@/components/DriverHeader";
import { DriverTabBar } from "@/components/DriverTabBar";
import { DEMO_DRIVER } from "@/lib/driver";
import { PREVIEW_MODE } from "@/config";
import { colors } from "@/lib/theme";
import type { DriverUser } from "@/types";

// The driver tab shell — equivalent of web DriverLayout. A shared dark header
// (callsign/balance/online-toggle/exit) sits above the active tab; a custom
// 4-tab bar (Заказы/Срочные/Чат/Профиль) sits below. expo-router <Tabs> drives
// real navigation while DriverHeader/DriverTabBar control the look.
export default function DriverShellLayout() {
  const { user, token, hydrated, logout } = useAuth();

  // Establish the driver WebSocket whenever we have a session (no-op in preview).
  useRideWebSocket(token);

  // Preview-only: lets the online/offline toggle visibly flip without a backend.
  const [demoStatus, setDemoStatus] = useState<"online" | "offline">("online");

  if (!hydrated) return null;

  const activeUser: DriverUser | null =
    user ?? (PREVIEW_MODE ? { ...DEMO_DRIVER, status: demoStatus } : null);

  if (!activeUser) return <Redirect href="/driver-login" />;

  const handleToggleStatus = () => {
    // Real status PATCH (/api/drivers/status) is wired in a later phase.
    if (!user) setDemoStatus((s) => (s === "online" ? "offline" : "online"));
  };

  return (
    <Tabs
      tabBar={(props) => <DriverTabBar {...props} />}
      screenOptions={{
        headerShown: true,
        header: () => (
          <DriverHeader
            user={activeUser}
            onToggleStatus={handleToggleStatus}
            onExit={logout}
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
  );
}
