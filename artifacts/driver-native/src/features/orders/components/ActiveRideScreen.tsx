import { useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { CheckCircle, MapPin, XCircle, Navigation } from "lucide-react-native";

import { colors } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { formatCurrency, formatRoutePoint } from "../utils";
import type { Ride, SeatPassenger, City } from "../types";
import { PassengerRow } from "./SeatViewScreen";
import { ElapsedTimer } from "./ElapsedTimer";
import { NavSheet } from "./NavSheet";

// Ported from web orders/components/ActiveRideScreen.tsx (CP3: list-based
// sequential pickup/dropoff; CarSeatLayout grid + map land in CP4/CP2).
export function ActiveRideScreen({
  ride,
  passengers,
  cities,
  loading,
  passengerActionLoading,
  onPickup,
  onDropoff,
  onComplete,
  onCancel,
}: {
  ride: Ride;
  passengers: SeatPassenger[];
  cities: City[];
  loading: boolean;
  passengerActionLoading: number | null;
  onPickup: (id: number) => void;
  onDropoff: (id: number) => void;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [showNav, setShowNav] = useState(false);
  const filledSeats = passengers.length;
  const totalEarnings = passengers.reduce((s, p) => s + (p.price || 0), 0);
  const bySeat = (a: SeatPassenger, b: SeatPassenger) => a.seatNumber - b.seatNumber;
  const waiting = passengers.filter((p) => p.status === "waiting").sort(bySeat);
  const pickedUp = passengers.filter((p) => p.status === "picked_up").sort(bySeat);
  const droppedOff = passengers.filter((p) => p.status === "dropped_off").length;
  const pickedCount = passengers.filter((p) => p.status === "picked_up" || p.status === "dropped_off").length;
  const allDroppedOff = filledSeats > 0 && droppedOff === filledSeats;

  const fromName = formatRoutePoint(ride.fromDistrictName, cities.find((c) => c.id === ride.fromCity)?.nameRu || ride.fromCity);
  const toName = formatRoutePoint(ride.toDistrictName, cities.find((c) => c.id === ride.toCity)?.nameRu || ride.toCity);
  const statusLabel = filledSeats === 0 ? t("st_accepted") : allDroppedOff ? t("all_delivered") : pickedCount < filledSeats ? t("st_collecting") : t("st_in_progress");
  const progressPct = filledSeats > 0 ? (droppedOff / filledSeats) * 100 : 0;

  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerClassName="pb-4" style={{ flex: 1 }}>
        {/* header */}
        <View className="bg-zinc-900 px-5 pt-4 pb-4">
          <View className="flex-row items-start justify-between">
            <View className="flex-1 pr-3">
              <Text className="font-sans-bold text-zinc-400 text-[10px] uppercase" style={{ letterSpacing: 0.5 }}>
                {statusLabel}
              </Text>
              <Text className="font-display text-white text-lg" numberOfLines={1}>
                {fromName} → {toName}
              </Text>
              <View className="mt-1">
                <ElapsedTimer since={ride.startedAt} />
              </View>
            </View>
            <Text className="font-display text-white text-2xl">{formatCurrency(totalEarnings || ride.price)}</Text>
          </View>

          {filledSeats > 0 && (
            <View className="mt-3">
              <Text className="font-sans-bold text-zinc-400 text-[10px] uppercase mb-1" style={{ letterSpacing: 0.5 }}>
                {allDroppedOff ? t("all_delivered") : `${droppedOff} ${t("q_of")} ${filledSeats}`}
              </Text>
              <View className="h-2 bg-white/15 rounded-full overflow-hidden">
                <View className="h-full bg-emerald-400 rounded-full" style={{ width: `${progressPct}%` }} />
              </View>
            </View>
          )}
        </View>

        <View className="px-4 py-3" style={{ gap: 10 }}>
          {/* sequential action buttons */}
          {!allDroppedOff && waiting.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text className="font-sans-bold text-emerald-500 text-xs uppercase" style={{ letterSpacing: 0.5 }}>
                {t("pickup_pax")}
              </Text>
              {waiting.map((wp, idx) => {
                const isNext = idx === 0;
                return (
                  <Pressable
                    key={wp.id}
                    onPress={() => isNext && onPickup(wp.id)}
                    disabled={!isNext || passengerActionLoading !== null}
                    className={`py-4 rounded-2xl flex-row items-center justify-center active:opacity-90 ${
                      isNext ? "bg-emerald-500" : "bg-muted/60 border border-border opacity-60"
                    }`}
                    style={{ gap: 10 }}
                  >
                    {isNext && passengerActionLoading === wp.id ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <CheckCircle size={20} color={isNext ? "#fff" : colors.mutedForeground} />
                    )}
                    <Text className={`font-sans-bold text-base ${isNext ? "text-white" : "text-muted-foreground"}`}>
                      {isNext
                        ? `${t("pickup_btn")} — ${wp.name.split(" ")[0]} (${pickedCount + 1}/${filledSeats})`
                        : `${wp.name.split(" ")[0]} — ${t("seat")} ${wp.seatNumber}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {!allDroppedOff && waiting.length === 0 && pickedUp.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text className="font-sans-bold text-blue-400 text-xs uppercase" style={{ letterSpacing: 0.5 }}>
                {t("dropoff_pax")}
              </Text>
              {pickedUp.map((pp, idx) => {
                const isNext = idx === 0;
                return (
                  <Pressable
                    key={pp.id}
                    onPress={() => isNext && onDropoff(pp.id)}
                    disabled={!isNext || passengerActionLoading !== null}
                    className={`py-4 rounded-2xl flex-row items-center justify-center active:opacity-90 ${
                      isNext ? "bg-blue-500" : "bg-muted/60 border border-border opacity-60"
                    }`}
                    style={{ gap: 10 }}
                  >
                    {isNext && passengerActionLoading === pp.id ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <MapPin size={20} color={isNext ? "#fff" : colors.mutedForeground} />
                    )}
                    <Text className={`font-sans-bold text-base ${isNext ? "text-white" : "text-muted-foreground"}`}>
                      {isNext
                        ? `${t("dropoff_btn")} — ${pp.name.split(" ")[0]} (${droppedOff + 1}/${filledSeats})`
                        : `${pp.name.split(" ")[0]} — ${t("seat")} ${pp.seatNumber}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {allDroppedOff && (
            <View className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 items-center">
              <View className="w-14 h-14 rounded-full bg-emerald-500/15 items-center justify-center mb-2">
                <CheckCircle size={28} color={colors.emerald} />
              </View>
              <Text className="font-sans-bold text-foreground text-base">{t("all_delivered")}</Text>
              <Text className="font-sans text-muted-foreground text-xs mt-1">{t("press_finish")}</Text>
            </View>
          )}

          {/* roster */}
          {passengers.length > 0 && (
            <View className="mt-1" style={{ gap: 8 }}>
              {passengers.map((p) => (
                <PassengerRow key={p.id} p={p} />
              ))}
            </View>
          )}

          {ride.toLat && ride.toLng && !allDroppedOff ? (
            <Pressable
              onPress={() => setShowNav(true)}
              className="py-3.5 rounded-2xl bg-muted border border-border flex-row items-center justify-center active:opacity-80"
              style={{ gap: 8 }}
            >
              <Navigation size={18} color={colors.foreground} />
              <Text className="font-sans-bold text-foreground text-sm">{t("navigator")}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      {/* footer */}
      <View className="bg-card border-t border-border px-5 py-4 flex-row" style={{ gap: 12 }}>
        <Pressable
          onPress={onCancel}
          disabled={loading}
          className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 items-center justify-center active:opacity-80"
        >
          <XCircle size={24} color={colors.red} />
        </Pressable>
        {(allDroppedOff || filledSeats === 0) && (
          <Pressable
            onPress={onComplete}
            disabled={loading}
            className="flex-1 h-14 rounded-2xl bg-emerald-500 flex-row items-center justify-center active:opacity-90"
            style={{ gap: 8 }}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <CheckCircle size={20} color="#fff" />}
            <Text className="font-sans-bold text-white text-base">{loading ? t("finishing") : t("finish_ride")}</Text>
          </Pressable>
        )}
      </View>

      <NavSheet visible={showNav} toLat={ride.toLat} toLng={ride.toLng} onClose={() => setShowNav(false)} />
    </View>
  );
}
