import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Linking } from "react-native";
import { Navigation, XCircle, Phone, User, Users } from "lucide-react-native";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { colors } from "@/lib/theme";
import { formatCurrency, formatRoutePoint } from "../utils";
import type { Ride, SeatPassenger, City, QueueInfoData } from "../types";
import { QueueWidget } from "./QueueWidget";
import { RideMap } from "./RideMap";
import { NavSheet } from "./NavSheet";
import { CarSeatLayout } from "./CarSeatLayout";
import { ExpiredRideModal } from "./ExpiredRideModal";

function statusBadge(status: string) {
  if (status === "picked_up") return { label: "В машине", cls: "bg-emerald-500/15", txt: "text-emerald-400" };
  if (status === "dropped_off") return { label: "Высажен", cls: "bg-zinc-700/40", txt: "text-zinc-400" };
  return { label: "Ожидает", cls: "bg-amber-500/15", txt: "text-amber-400" };
}

export function PassengerRow({ p }: { p: SeatPassenger }) {
  const female = p.gender === "female";
  const badge = statusBadge(p.status);
  return (
    <View className="flex-row items-center bg-card border border-border rounded-2xl px-3 py-2.5" style={{ gap: 10 }}>
      <View className={`w-9 h-9 rounded-full items-center justify-center ${female ? "bg-pink-500/20" : "bg-blue-500/20"}`}>
        <User size={18} color={female ? "#ec4899" : "#3b82f6"} />
      </View>
      <View className="flex-1">
        <Text className="font-sans-bold text-foreground text-sm" numberOfLines={1}>
          {p.name}
        </Text>
        <Text className="font-sans text-muted-foreground text-[12px]">
          Место {p.seatNumber} • {formatCurrency(p.price)}
        </Text>
      </View>
      <View className={`rounded-full px-2 py-0.5 ${badge.cls}`}>
        <Text className={`font-sans-semibold text-[11px] ${badge.txt}`}>{badge.label}</Text>
      </View>
      {p.phone ? (
        <Pressable
          onPress={() => Linking.openURL(`tel:${p.phone}`)}
          className="w-9 h-9 rounded-xl bg-secondary items-center justify-center active:opacity-80"
        >
          <Phone size={16} color={colors.foreground} />
        </Pressable>
      ) : null}
    </View>
  );
}

// Ported from web orders/components/SeatViewScreen.tsx (CP3: list-based; the full
// CarSeatLayout grid, confetti, manual-client + expired modal land in CP4; the
// map/pickup-route panel lands in CP2).
export function SeatViewScreen({
  ride,
  passengers,
  cities,
  loading,
  onStartRide,
  onCancel,
}: {
  ride: Ride;
  passengers: SeatPassenger[];
  cities: City[];
  loading: boolean;
  onStartRide: () => void;
  onCancel: () => void;
}) {
  const { token } = useAuth();
  const [queueInfo, setQueueInfo] = useState<QueueInfoData | null>(null);
  const [showNav, setShowNav] = useState(false);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [showExpired, setShowExpired] = useState(false);
  const [extending, setExtending] = useState(false);

  const filledSeats = passengers.length;
  const totalSeats = ride.seatsTotal ?? ride.totalSeats ?? 4;
  const totalEarnings = passengers.reduce((s, p) => s + (p.price || 0), 0);

  const fromName = formatRoutePoint(ride.fromDistrictName, cities.find((c) => c.id === ride.fromCity)?.nameRu || ride.fromCity);
  const toName = formatRoutePoint(ride.toDistrictName, cities.find((c) => c.id === ride.toCity)?.nameRu || ride.toCity);

  const fetchQueue = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/drivers/queue-info`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setQueueInfo(await res.json());
    } catch {}
  }, [token]);

  useEffect(() => {
    fetchQueue();
    const iv = setInterval(fetchQueue, 10000);
    return () => clearInterval(iv);
  }, [fetchQueue]);

  useEffect(() => {
    if (queueInfo?.isExpired) setShowExpired(true);
  }, [queueInfo?.isExpired]);

  const onExtend = async () => {
    if (!token) return;
    setExtending(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/drivers/extend-ride`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rideId: ride.id }),
      });
      if (res.ok) {
        setShowExpired(false);
        fetchQueue();
      }
    } catch {
    } finally {
      setExtending(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerClassName="px-3 pt-2 pb-4" style={{ flex: 1 }}>
        {/* header card */}
        <View className="rounded-2xl bg-zinc-900 px-3 py-3">
          <Text className="font-sans-bold text-zinc-400 text-[10px] uppercase" style={{ letterSpacing: 0.5 }}>
            {filledSeats >= totalSeats ? "Машина заполнена" : "Ваш рейс"}
          </Text>
          <Text className="font-display text-white text-base mt-0.5" numberOfLines={1}>
            {fromName} → {toName}
          </Text>
          <View className="flex-row mt-2" style={{ gap: 6 }}>
            <View className="flex-1 bg-white/10 rounded-lg py-1.5 items-center">
              <Text className="font-sans-bold text-white text-lg">
                {filledSeats}
                <Text className="text-zinc-400 text-sm">/{totalSeats}</Text>
              </Text>
              <Text className="font-sans text-zinc-400 text-[8px] uppercase">Мест</Text>
            </View>
            <View className="flex-1 bg-white/10 rounded-lg py-1.5 items-center">
              <Text className="font-sans-bold text-white text-base">{formatCurrency(totalEarnings)}</Text>
              <Text className="font-sans text-zinc-400 text-[8px] uppercase">Заработок</Text>
            </View>
            <View className="flex-1 bg-white/10 rounded-lg py-1.5 items-center">
              <Text className="font-sans-bold text-white text-lg">{ride.distance ?? "—"}</Text>
              <Text className="font-sans text-zinc-400 text-[8px] uppercase">км</Text>
            </View>
          </View>
        </View>

        {/* route map */}
        <View className="mt-3">
          <RideMap ride={ride} height={180} />
        </View>

        {/* seat map */}
        <View className="mt-3">
          <CarSeatLayout
            passengers={passengers}
            selectedSeat={selectedSeat}
            onSeatClick={(n) => setSelectedSeat((s) => (s === n ? null : n))}
            totalSeats={totalSeats}
          />
        </View>

        {/* passengers */}
        <View className="mt-3" style={{ gap: 8 }}>
          {passengers.length === 0 ? (
            <View className="items-center py-8">
              <Users size={32} color={colors.mutedForeground} />
              <Text className="font-sans text-muted-foreground text-sm mt-2">Ожидание пассажиров…</Text>
            </View>
          ) : (
            passengers.map((p) => <PassengerRow key={p.id} p={p} />)
          )}
        </View>

        {queueInfo && filledSeats < totalSeats ? (
          <View className="mt-3">
            <QueueWidget queueInfo={queueInfo} />
          </View>
        ) : null}
      </ScrollView>

      {/* footer actions */}
      <View className="bg-card border-t border-border px-3 py-3" style={{ gap: 8 }}>
        <View className="flex-row" style={{ gap: 8 }}>
          {ride.fromLat && ride.fromLng ? (
            <Pressable
              onPress={() => setShowNav(true)}
              className="flex-1 py-3 rounded-xl bg-muted border border-border flex-row items-center justify-center active:opacity-80"
              style={{ gap: 6 }}
            >
              <Navigation size={16} color={colors.foreground} />
              <Text className="font-sans-bold text-foreground text-sm">Навигатор</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onCancel}
            disabled={loading}
            className="flex-1 py-3 rounded-xl bg-red-500/10 border border-red-500/20 flex-row items-center justify-center active:opacity-80"
            style={{ gap: 6 }}
          >
            <XCircle size={16} color={colors.red} />
            <Text className="font-sans-bold text-red-500 text-sm">Отменить</Text>
          </Pressable>
        </View>
        {ride.status === "accepted" && filledSeats > 0 ? (
          <Pressable
            onPress={onStartRide}
            disabled={loading}
            className="h-14 rounded-2xl bg-zinc-900 flex-row items-center justify-center active:opacity-90"
            style={{ gap: 8 }}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Navigation size={16} color="#fff" />}
            <Text className="font-sans-bold text-white text-sm">{loading ? "Начинаю…" : "Начать поездку"}</Text>
          </Pressable>
        ) : null}
      </View>

      <NavSheet visible={showNav} toLat={ride.fromLat} toLng={ride.fromLng} onClose={() => setShowNav(false)} />
      <ExpiredRideModal
        visible={showExpired}
        extending={extending}
        filledSeats={filledSeats}
        onExtend={onExtend}
        onStartRide={onStartRide}
        onEndRide={onCancel}
        onClose={() => setShowExpired(false)}
      />
    </View>
  );
}
