import { View, ActivityIndicator } from "react-native";

import { colors } from "@/lib/theme";
import { useOrders } from "./use-orders";
import { IdleScreen } from "./IdleScreen";
import { RouteSelectScreen } from "./RouteSelectScreen";
import { ActiveRideSummary } from "./ActiveRideSummary";

// Ride-flow state machine (web OrdersMain + RideStateRouter equivalent).
export function OrdersMain() {
  const o = useOrders();

  if (o.screen === "loading") {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (o.screen === "route_select") {
    return (
      <RouteSelectScreen
        cities={o.cities}
        routes={o.routes}
        creating={o.actionLoading}
        onCreateRide={o.createRide}
      />
    );
  }

  if ((o.screen === "seat_view" || o.screen === "active" || o.screen === "pickup") && o.activeRide) {
    return <ActiveRideSummary ride={o.activeRide} passengers={o.passengers} />;
  }

  // idle (offline, or online with no ride yet)
  return <IdleScreen isOnline={o.isOnline} loading={o.actionLoading} onGoOnline={o.goOnline} />;
}
