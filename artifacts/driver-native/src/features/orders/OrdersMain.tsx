import { useState, useEffect } from "react";
import { View, ActivityIndicator, Alert } from "react-native";

import { useAuth } from "@/hooks/use-auth";
import { colors } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { useDetectedCity } from "@/hooks/use-detected-city";
import { useOrders } from "./use-orders";
import { HomeScreen } from "./HomeScreen";
import { RouteSelectScreen } from "./RouteSelectScreen";
import { SellOrderScreen } from "./SellOrderScreen";
import { SeatViewScreen } from "./components/SeatViewScreen";
import { ActiveRideScreen } from "./components/ActiveRideScreen";
import { CompletionScreen } from "./components/CompletionScreen";

// Ride-flow state machine (web OrdersMain + RideStateRouter equivalent).
export function OrdersMain() {
  const { t } = useT();
  const o = useOrders();
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [showSell, setShowSell] = useState(false);
  // GPS-detected origin (where the phone actually is) — overrides stale profile city.
  const detectedCity = useDetectedCity(o.cities);

  // Leave the create/sell screens automatically once a ride exists.
  useEffect(() => {
    if (o.activeRide) {
      setShowCreate(false);
      setShowSell(false);
    }
  }, [o.activeRide]);

  const confirmCancel = () => {
    Alert.alert(t("cancel_ride_q"), t("cancel_ride_sub"), [
      { text: t("back"), style: "cancel" },
      { text: t("cancel_ride"), style: "destructive", onPress: () => o.cancelRide() },
    ]);
  };

  if (o.screen === "loading") {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (o.screen === "completed" && o.completedRide) {
    return (
      <CompletionScreen
        ride={o.completedRide}
        commissionRate={o.commissionRate}
        onClose={o.handleCompletionClose}
      />
    );
  }

  if (o.screen === "active" && o.activeRide) {
    return (
      <ActiveRideScreen
        ride={o.activeRide}
        passengers={o.passengers}
        cities={o.cities}
        loading={o.actionLoading}
        passengerActionLoading={o.passengerActionLoading}
        onPickup={o.passengerPickup}
        onDropoff={o.passengerDropoff}
        onComplete={o.completeRide}
        onCancel={confirmCancel}
      />
    );
  }

  if ((o.screen === "seat_view" || o.screen === "pickup") && o.activeRide) {
    return (
      <SeatViewScreen
        ride={o.activeRide}
        passengers={o.passengers}
        cities={o.cities}
        routes={o.routes}
        loading={o.actionLoading}
        onStartRide={o.startRide}
        onCancel={confirmCancel}
        onManualClient={o.manualClient}
        onRejectClient={o.rejectPassenger}
        clientActionLoading={o.clientActionLoading}
        passengerActionLoading={o.passengerActionLoading}
      />
    );
  }

  // No active ride: the home card by default; create-ride / sell-order on demand.
  if (showCreate) {
    return (
      <RouteSelectScreen
        cities={o.cities}
        routes={o.routes}
        creating={o.actionLoading}
        onCreateRide={o.createRide}
        userCity={detectedCity ?? o.userCity}
        onBack={() => setShowCreate(false)}
      />
    );
  }

  if (showSell) {
    return (
      <SellOrderScreen
        cities={o.cities}
        routes={o.routes}
        loading={o.sellLoading}
        error={o.sellError}
        onSubmit={o.createSellOrder}
        onBack={() => {
          o.clearSellError();
          setShowSell(false);
        }}
      />
    );
  }

  if (!user) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <HomeScreen
      user={user}
      isOnline={o.isOnline}
      creating={o.actionLoading}
      onCreate={() => setShowCreate(true)}
      onSell={() => {
        o.clearSellError();
        setShowSell(true);
      }}
      onGoOnline={o.goOnline}
    />
  );
}
