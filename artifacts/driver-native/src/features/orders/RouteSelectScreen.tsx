import { useState, useMemo, useEffect, type ReactNode } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Car, Clock, Zap, Check, MapPin, ChevronDown, ChevronUp, ChevronLeft } from "lucide-react-native";

import { colors } from "@/lib/theme";
import { BUILD_TAG } from "@/config";
import type { City, RouteOption } from "./types";

// Create-ride screen — origin auto-detected; КУДА and ВАКТ are collapsible
// dropdowns (closed by default, expand on tap, collapse on selection). Route
// filtering keeps only ENABLED routes.
export function RouteSelectScreen({
  cities,
  routes,
  creating,
  onCreateRide,
  userCity,
  onBack,
}: {
  cities: City[];
  routes: RouteOption[];
  creating: boolean;
  onCreateRide: (fromCity: string, toCity: string, departureTime: string, urgent?: boolean, timeSlot?: string) => void;
  userCity?: string | null;
  onBack?: () => void;
}) {
  const [fromCity, setFromCity] = useState("");
  const [toCity, setToCity] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [urgentMode, setUrgentMode] = useState(false);
  const [openDD, setOpenDD] = useState<"from" | "to" | "time" | null>(null);

  const fromCityObj = cities.find((c) => c.id === fromCity);
  const toCityObj = cities.find((c) => c.id === toCity);
  const fromNameRu = fromCityObj?.nameRu || "";

  const matchesFrom = (rf: string) =>
    rf === fromNameRu || rf === fromCity || rf.toLowerCase() === fromNameRu.toLowerCase();
  const matchesTo = (rt: string, c: City) =>
    rt === c.nameRu || rt === c.id || rt.toLowerCase() === c.nameRu.toLowerCase();

  // Auto-detect the driver's current city as the origin.
  useEffect(() => {
    if (fromCity || !userCity || cities.length === 0) return;
    const uc = String(userCity).toLowerCase();
    const match = cities.find(
      (c) => c.id === userCity || c.nameRu === userCity || c.nameRu.toLowerCase() === uc,
    );
    if (match) setFromCity(match.id);
  }, [userCity, cities, fromCity]);

  // Origin list = cities with >=1 enabled outgoing route.
  const originCities = useMemo(() => {
    if (routes.length === 0) return cities;
    return cities.filter((c) => routes.some((r) => matchesTo(r.fromCity, c)));
  }, [routes, cities]);

  // Destination list = cities reachable via an enabled route from the origin.
  const destinationCities = useMemo(() => {
    if (!fromCity) return [];
    const matching = routes.filter((r) => matchesFrom(r.fromCity));
    return cities.filter((c) => c.id !== fromCity && matching.some((r) => matchesTo(r.toCity, c)));
  }, [fromCity, routes, cities]);

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

  const toggle = (dd: "from" | "to" | "time") => setOpenDD((cur) => (cur === dd ? null : dd));

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-4 pt-3 pb-10">
      {/* header with back */}
      <View className="flex-row items-center mb-1" style={{ gap: 4 }}>
        {onBack ? (
          <Pressable onPress={onBack} className="w-10 h-10 -ml-2 items-center justify-center active:opacity-70">
            <ChevronLeft size={24} color={colors.foreground} />
          </Pressable>
        ) : null}
        <Text className="font-display text-foreground text-lg">Создать рейс</Text>
      </View>
      <Text className="font-sans text-primary/50 text-[10px] mb-4">{BUILD_TAG}</Text>

      {/* ОТКУДА — auto-detected origin, shown as a compact field (tap to change) */}
      <Label text="Откуда" />
      <Dropdown
        open={openDD === "from"}
        onToggle={() => toggle("from")}
        placeholder="Танланг"
        valueLabel={fromCityObj?.nameRu}
        leftIcon={<MapPin size={16} color={colors.primary} />}
      >
        {originCities.map((c) => (
          <Option
            key={c.id}
            label={c.nameRu}
            selected={fromCity === c.id}
            onPress={() => {
              setFromCity(c.id);
              setToCity("");
              setOpenDD(null);
            }}
          />
        ))}
      </Dropdown>

      {/* КУДА — dropdown of enabled destinations */}
      <Label text="Куда" className="mt-4" />
      <Dropdown
        open={openDD === "to"}
        onToggle={() => toggle("to")}
        placeholder="Танланг"
        valueLabel={toCityObj?.nameRu}
        leftIcon={<MapPin size={16} color={colors.red} />}
        disabled={!fromCity}
      >
        {destinationCities.length === 0 ? (
          <View className="px-3 py-3">
            <Text className="font-sans text-muted-foreground text-[13px]">Нет доступных направлений</Text>
          </View>
        ) : (
          destinationCities.map((c) => (
            <Option
              key={c.id}
              label={c.nameRu}
              selected={toCity === c.id}
              onPress={() => {
                setToCity(c.id);
                setOpenDD(null);
              }}
            />
          ))
        )}
      </Dropdown>

      {/* Type toggle */}
      <View className="flex-row mt-5" style={{ gap: 8 }}>
        <Pressable
          onPress={() => setUrgentMode(false)}
          className={`flex-1 py-2.5 rounded-xl border-2 items-center active:opacity-90 ${
            !urgentMode ? "bg-primary border-primary" : "bg-card border-border"
          }`}
        >
          <Text className={`font-sans-bold text-xs ${!urgentMode ? "text-white" : "text-foreground"}`}>По времени</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setUrgentMode(true);
            setTimeSlot("");
            setOpenDD(null);
          }}
          className={`flex-1 py-2.5 rounded-xl border-2 flex-row items-center justify-center active:opacity-90 ${
            urgentMode ? "bg-amber-500 border-amber-500" : "bg-card border-border"
          }`}
          style={{ gap: 4 }}
        >
          <Zap size={14} color={urgentMode ? "#fff" : colors.foreground} />
          <Text className={`font-sans-bold text-xs ${urgentMode ? "text-white" : "text-foreground"}`}>Только срочные</Text>
        </Pressable>
      </View>

      {/* ВАКТ — time dropdown */}
      {!urgentMode ? (
        <>
          <Label text="Время отправления" className="mt-4" />
          <Dropdown
            open={openDD === "time"}
            onToggle={() => toggle("time")}
            placeholder="Выберите время"
            valueLabel={timeSlot ? timeSlot.replace("–", " – ") : undefined}
            leftIcon={<Clock size={16} color={colors.primary} />}
          >
            {timeSlotsData.map(({ label }) => (
              <Option
                key={label}
                label={label.replace("–", " – ")}
                selected={timeSlot === label}
                onPress={() => {
                  setTimeSlot(label);
                  setOpenDD(null);
                }}
              />
            ))}
          </Dropdown>
        </>
      ) : (
        <View className="mt-4 rounded-xl bg-amber-500/10 border border-amber-500/30 p-3">
          <Text className="font-sans text-xs text-amber-400" style={{ lineHeight: 18 }}>
            Получаете только срочные заказы (без интервала времени) на выбранный маршрут. Время отправления — сейчас.
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

function Label({ text, className = "" }: { text: string; className?: string }) {
  return (
    <Text className={`font-sans-bold text-muted-foreground text-[11px] uppercase mb-2 ${className}`} style={{ letterSpacing: 0.5 }}>
      {text}
    </Text>
  );
}

function Dropdown({
  open,
  onToggle,
  placeholder,
  valueLabel,
  leftIcon,
  disabled,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  placeholder: string;
  valueLabel?: string;
  leftIcon?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <View>
      <Pressable
        onPress={() => !disabled && onToggle()}
        disabled={disabled}
        className={`flex-row items-center bg-card border rounded-xl px-3 py-3.5 active:opacity-90 ${
          open ? "border-primary" : "border-border"
        }`}
        style={{ gap: 10, opacity: disabled ? 0.5 : 1 }}
      >
        {leftIcon}
        <Text className={`flex-1 font-sans-bold text-sm ${valueLabel ? "text-foreground" : "text-muted-foreground"}`}>
          {valueLabel || placeholder}
        </Text>
        {open ? <ChevronUp size={18} color={colors.mutedForeground} /> : <ChevronDown size={18} color={colors.mutedForeground} />}
      </Pressable>
      {open ? <View className="mt-1.5 bg-card border border-border rounded-xl overflow-hidden">{children}</View> : null}
    </View>
  );
}

function Option({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center px-3 py-3 border-b border-border active:opacity-80 ${selected ? "bg-emerald-500/10" : ""}`}
      style={{ gap: 8 }}
    >
      <Text className={`flex-1 font-sans-bold text-sm ${selected ? "text-emerald-400" : "text-foreground"}`}>{label}</Text>
      {selected ? <Check size={16} color={colors.emerald} strokeWidth={3} /> : null}
    </Pressable>
  );
}
