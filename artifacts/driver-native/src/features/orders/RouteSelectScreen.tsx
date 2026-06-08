import { useState, useMemo, useEffect } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Car, Clock, ArrowRight, Zap, Check } from "lucide-react-native";

import { colors } from "@/lib/theme";
import { BUILD_TAG } from "@/config";
import type { City, RouteOption } from "./types";

// Ported from web orders/components/RouteSelectScreen.tsx — From/To selection +
// the 2-hour time-slot picker + urgent mode. (GPS auto-detect of the origin city
// arrives with maps in CP2; here From is chosen manually.)
export function RouteSelectScreen({
  cities,
  routes,
  creating,
  onCreateRide,
  userCity,
}: {
  cities: City[];
  routes: RouteOption[];
  creating: boolean;
  onCreateRide: (fromCity: string, toCity: string, departureTime: string, urgent?: boolean, timeSlot?: string) => void;
  userCity?: string | null;
}) {
  const [fromCity, setFromCity] = useState("");
  const [toCity, setToCity] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [urgentMode, setUrgentMode] = useState(false);

  const fromCityObj = cities.find((c) => c.id === fromCity);
  const fromNameRu = fromCityObj?.nameRu || "";

  const matchesFrom = (rf: string) =>
    rf === fromNameRu || rf === fromCity || rf.toLowerCase() === fromNameRu.toLowerCase();
  const matchesTo = (rt: string, c: City) =>
    rt === c.nameRu || rt === c.id || rt.toLowerCase() === c.nameRu.toLowerCase();

  // Auto-detect the driver's current city as the origin (matches web GPS flow).
  useEffect(() => {
    if (fromCity || !userCity || cities.length === 0) return;
    const uc = String(userCity).toLowerCase();
    const match = cities.find(
      (c) => c.id === userCity || c.nameRu === userCity || c.nameRu.toLowerCase() === uc,
    );
    if (match) setFromCity(match.id);
  }, [userCity, cities, fromCity]);

  // Destination list = ONLY cities reachable via an ENABLED route from the
  // origin. `routes` is already filtered to isActive !== false upstream, so a
  // disabled route is completely absent here (no greyed-out / "недоступно").
  const destinationCities = useMemo(() => {
    if (!fromCity) return [];
    const matching = routes.filter((r) => matchesFrom(r.fromCity));
    return cities.filter((c) => c.id !== fromCity && matching.some((r) => matchesTo(r.toCity, c)));
  }, [fromCity, routes, cities]);

  // Auto-select the single destination if there's only one.
  useEffect(() => {
    if (destinationCities.length === 1) setToCity(destinationCities[0].id);
  }, [destinationCities]);

  const timeSlotsData = useMemo(() => {
    const items: { label: string; dep: Date }[] = [];
    const now = new Date();
    const base = new Date(now);
    base.setHours(now.getHours() - (now.getHours() % 2), 0, 0, 0);
    for (let i = 0; i < 12; i++) {
      const dep = new Date(base.getTime() + i * 2 * 60 * 60 * 1000);
      const h = dep.getHours();
      const end = (h + 2) % 24;
      items.push({ label: `${String(h).padStart(2, "0")}:00–${String(end).padStart(2, "0")}:00`, dep });
    }
    return items;
  }, []);

  const canCreate = !!fromCity && !!toCity && fromCity !== toCity && (urgentMode || !!timeSlot);

  const handleCreate = () => {
    if (!canCreate || creating) return;
    if (urgentMode) {
      onCreateRide(fromCity, toCity, "", true);
      return;
    }
    const found = timeSlotsData.find((x) => x.label === timeSlot);
    const dep = (found ? found.dep : new Date()).toISOString();
    onCreateRide(fromCity, toCity, dep, false, timeSlot.replace("–", "-"));
  };

  const Chip = ({
    label,
    selected,
    tint,
    onPress,
  }: {
    label: string;
    selected: boolean;
    tint: "primary" | "red";
    onPress: () => void;
  }) => {
    const dot = selected ? "bg-white" : tint === "red" ? "bg-red-500" : "bg-primary";
    const box = selected
      ? tint === "red"
        ? "bg-red-500 border-red-500"
        : "bg-primary border-primary"
      : "bg-card border-border";
    return (
      <Pressable
        onPress={onPress}
        className={`flex-row items-center rounded-xl border-2 px-3 py-3 active:opacity-90 ${box}`}
        style={{ width: "48%", gap: 8 }}
      >
        <View className={`w-2.5 h-2.5 rounded-full ${dot}`} />
        <Text
          className={`font-sans-bold text-sm flex-1 ${selected ? "text-white" : "text-foreground"}`}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-4 pt-4 pb-10">
      {/* header */}
      <View className="items-center py-3 mb-2">
        <View className="w-16 h-16 rounded-full bg-primary/10 items-center justify-center mb-3">
          <Car size={32} color={colors.primary} />
        </View>
        <Text className="font-display text-foreground text-lg">Создать рейс</Text>
        <Text className="font-sans text-muted-foreground text-sm mt-1">
          Выберите маршрут и время отправления
        </Text>
        <Text className="font-sans text-primary/50 text-[10px] mt-1">{BUILD_TAG}</Text>
      </View>

      {/* From */}
      <Text className="font-sans-bold text-muted-foreground text-[11px] uppercase mb-2" style={{ letterSpacing: 0.5 }}>
        Откуда
      </Text>
      <View className="flex-row flex-wrap justify-between" style={{ rowGap: 8 }}>
        {cities.map((c) => (
          <Chip
            key={c.id}
            label={c.nameRu}
            tint="primary"
            selected={fromCity === c.id}
            onPress={() => {
              setFromCity(fromCity === c.id ? "" : c.id);
              setToCity("");
            }}
          />
        ))}
      </View>

      <View className="items-center my-3">
        <ArrowRight size={20} color={colors.mutedForeground} />
      </View>

      {/* To */}
      <Text className="font-sans-bold text-muted-foreground text-[11px] uppercase mb-2" style={{ letterSpacing: 0.5 }}>
        Куда{" "}
        {fromCity && routes.length > 0 ? (
          <Text className="text-primary/60">
            ({destinationCities.length}{" "}
            {destinationCities.length === 1 ? "направление" : "направлений"})
          </Text>
        ) : null}
      </Text>
      <View className="flex-row flex-wrap justify-between" style={{ rowGap: 8 }}>
        {destinationCities.map((c) => (
          <Chip
            key={c.id}
            label={c.nameRu}
            tint="red"
            selected={toCity === c.id}
            onPress={() => setToCity(toCity === c.id ? "" : c.id)}
          />
        ))}
      </View>

      {/* Type toggle */}
      <View className="flex-row mt-5" style={{ gap: 8 }}>
        <Pressable
          onPress={() => setUrgentMode(false)}
          className={`flex-1 py-2.5 rounded-xl border-2 items-center active:opacity-90 ${
            !urgentMode ? "bg-primary border-primary" : "bg-card border-border"
          }`}
        >
          <Text className={`font-sans-bold text-xs ${!urgentMode ? "text-white" : "text-foreground"}`}>
            По времени
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setUrgentMode(true);
            setTimeSlot("");
          }}
          className={`flex-1 py-2.5 rounded-xl border-2 flex-row items-center justify-center active:opacity-90 ${
            urgentMode ? "bg-amber-500 border-amber-500" : "bg-card border-border"
          }`}
          style={{ gap: 4 }}
        >
          <Zap size={14} color={urgentMode ? "#fff" : colors.foreground} />
          <Text className={`font-sans-bold text-xs ${urgentMode ? "text-white" : "text-foreground"}`}>
            Только срочные
          </Text>
        </Pressable>
      </View>

      {/* Time slots */}
      {!urgentMode ? (
        <View className="mt-4">
          <View className="flex-row items-center mb-2.5" style={{ gap: 8 }}>
            <Clock size={16} color={colors.primary} />
            <Text className="font-sans-bold text-foreground text-sm">Время отправления</Text>
          </View>
          <View style={{ gap: 8 }}>
            {timeSlotsData.map(({ label }) => {
              const selected = timeSlot === label;
              const [start, end] = label.split("–");
              return (
                <Pressable
                  key={label}
                  onPress={() => setTimeSlot(selected ? "" : label)}
                  className={`flex-row items-center rounded-2xl border px-3 py-3 active:opacity-90 ${
                    selected ? "bg-emerald-500/15 border-emerald-500" : "bg-card border-border"
                  }`}
                  style={{ gap: 12 }}
                >
                  <View
                    className={`w-10 h-10 rounded-xl items-center justify-center ${
                      selected ? "bg-emerald-500" : "bg-secondary"
                    }`}
                  >
                    <Clock size={18} color={selected ? "#fff" : colors.mutedForeground} />
                  </View>
                  <View className="flex-row items-center flex-1" style={{ gap: 4 }}>
                    <Text className={`font-sans-bold text-base ${selected ? "text-emerald-400" : "text-foreground"}`}>
                      {start}
                    </Text>
                    <Text className={`font-sans-bold text-sm ${selected ? "text-emerald-400/50" : "text-muted-foreground"}`}>
                      –
                    </Text>
                    <Text className={`font-sans-bold text-base ${selected ? "text-emerald-400" : "text-foreground"}`}>
                      {end}
                    </Text>
                  </View>
                  {selected ? (
                    <View className="w-5 h-5 rounded-full bg-emerald-500 items-center justify-center">
                      <Check size={12} color="#fff" strokeWidth={3} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          {!timeSlot && (
            <View className="flex-row items-center justify-center mt-2.5" style={{ gap: 4 }}>
              <Clock size={12} color={colors.amber} />
              <Text className="font-sans-medium text-[12px] text-amber-500">Выберите время отправления</Text>
            </View>
          )}
        </View>
      ) : (
        <View className="mt-4 rounded-xl bg-amber-500/10 border border-amber-500/30 p-3">
          <Text className="font-sans text-xs text-amber-400" style={{ lineHeight: 18 }}>
            Получаете только срочные заказы (без интервала времени) на выбранный маршрут. Время
            отправления — сейчас.
          </Text>
        </View>
      )}

      {/* Create */}
      <Pressable
        onPress={handleCreate}
        disabled={!canCreate || creating}
        className={`mt-6 py-4 rounded-2xl flex-row items-center justify-center active:opacity-90 ${
          !canCreate || creating ? "opacity-40" : ""
        } ${urgentMode ? "bg-amber-500" : "bg-emerald-500"}`}
        style={{ gap: 8 }}
      >
        {creating ? (
          <ActivityIndicator color="#fff" />
        ) : urgentMode ? (
          <Zap size={20} color="#fff" />
        ) : (
          <Car size={20} color="#fff" />
        )}
        <Text className="font-sans-bold text-white text-base">
          {creating ? "Создаём рейс..." : urgentMode ? "Принимать срочные" : "Начать рейс"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
