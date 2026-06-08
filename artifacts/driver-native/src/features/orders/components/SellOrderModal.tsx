import { useState, useEffect, useCallback, useMemo } from "react";
import { View, Text, Pressable, TextInput, Modal, ActivityIndicator } from "react-native";
import { Store, X, Check } from "lucide-react-native";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { colors } from "@/lib/theme";
import { useT, type TKey } from "@/lib/i18n";
import { formatCurrency } from "../utils";
import type { Ride, SeatPassenger, RouteOption, City } from "../types";

// Tariff tiers — labels per owner (Стандарт / Comfort / Бизнес) mapped to the
// backend carClass + the route price columns (for the offline fallback).
const TARIFFS = [
  { key: "economy", carClass: "economy", labelKey: "tariff_standard" as TKey | null, label: "Стандарт", back: "priceEconomy", front: "priceFrontEconomy" },
  { key: "comfort", carClass: "comfort", labelKey: null, label: "Comfort", back: "priceComfort", front: "priceFrontComfort" },
  { key: "business", carClass: "business", labelKey: "tariff_business" as TKey | null, label: "Бизнес", back: "priceBusiness", front: "priceFrontBusiness" },
] as const;

// Driver sells the order to the operator. Price is NOT typed — driver picks a
// tariff and the price is fetched LIVE from /api/rides/price-estimate (mirrors
// dispatcher). To guarantee the estimate's city strings match the routes table
// (calcPrice does an exact eq), we resolve the order against the loaded routes
// and use THAT route's fromCity/toCity; if the estimate still fails we fall back
// to the route's own price columns so prices always show.
export function SellOrderModal({
  visible,
  ride,
  passengers,
  routes,
  cities,
  loading,
  error,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  ride: Ride;
  passengers: SeatPassenger[];
  routes: RouteOption[];
  cities: City[];
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (price: number, comment: string) => Promise<boolean>;
}) {
  const { t } = useT();
  const { token } = useAuth();
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [fetching, setFetching] = useState(false);
  const [selected, setSelected] = useState<string>("economy");
  const [comment, setComment] = useState("");

  // Seat composition (same as dispatcher): front = seat 1, back = seats 2..4.
  let frontSeats = passengers.some((p) => p.seatNumber === 1) ? 1 : 0;
  let backSeats = passengers.filter((p) => p.seatNumber >= 2).length;
  if (frontSeats + backSeats === 0) backSeats = 1;

  // Resolve the order's route from the loaded routes (forward OR reverse), so
  // the estimate uses the EXACT city strings the routes table stores.
  const matchedRoute = useMemo(() => {
    const cityOf = (slug?: string) => cities.find((c) => c.id === slug);
    const same = (routeCity?: string, rideCity?: string) => {
      if (!routeCity || !rideCity) return false;
      if (routeCity === rideCity) return true;
      const c = cityOf(rideCity);
      if (!c) return routeCity.toLowerCase() === String(rideCity).toLowerCase();
      return routeCity === c.id || routeCity === c.nameRu || routeCity.toLowerCase() === c.nameRu.toLowerCase();
    };
    return (
      routes.find(
        (r) =>
          (same(r.fromCity, ride.fromCity) && same(r.toCity, ride.toCity)) ||
          (same(r.fromCity, ride.toCity) && same(r.toCity, ride.fromCity)),
      ) || null
    );
  }, [routes, cities, ride.fromCity, ride.toCity]);

  const estFrom = matchedRoute?.fromCity || ride.fromCity;
  const estTo = matchedRoute?.toCity || ride.toCity;

  const columnFallback = useCallback(
    (tier: (typeof TARIFFS)[number]): number | null => {
      const r: any = matchedRoute;
      if (!r) return null;
      const back = Number(r[tier.back] || 0);
      const front = Number(r[tier.front] || back);
      const total = backSeats * back + frontSeats * front;
      return total > 0 ? Math.round(total) : null;
    },
    [matchedRoute, backSeats, frontSeats],
  );

  const fetchPrices = useCallback(async () => {
    setFetching(true);
    console.log("[SELL] estimate route:", { estFrom, estTo, frontSeats, backSeats, matched: !!matchedRoute });
    try {
      const results = await Promise.all(
        TARIFFS.map(async (tier) => {
          try {
            const res = await fetch(`${API_BASE_URL}/api/rides/price-estimate`, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({ fromCity: estFrom, toCity: estTo, carClass: tier.carClass, roundTrip: false, frontSeats, backSeats }),
            });
            const text = await res.text();
            let price: number | null = null;
            if (res.ok) {
              try {
                const d = JSON.parse(text);
                price = typeof d.price === "number" && d.price > 0 ? d.price : null;
              } catch {}
            }
            console.log(`[SELL] ${tier.carClass} -> ${res.status}`, res.ok ? price : text.slice(0, 120));
            if (price == null) price = columnFallback(tier); // offline / mismatch fallback
            return [tier.key, price] as const;
          } catch (e) {
            console.log(`[SELL] ${tier.carClass} error`, String(e));
            return [tier.key, columnFallback(tier)] as const;
          }
        }),
      );
      setPrices(Object.fromEntries(results));
    } finally {
      setFetching(false);
    }
  }, [token, estFrom, estTo, frontSeats, backSeats, matchedRoute, columnFallback]);

  useEffect(() => {
    if (visible) fetchPrices();
  }, [visible, fetchPrices]);

  const selectedPrice = prices[selected] ?? null;
  const canSell = typeof selectedPrice === "number" && selectedPrice > 0 && !loading;

  const submit = async () => {
    if (!canSell) return;
    console.log("[SELL] modal submit", { selected, price: selectedPrice });
    const ok = await onConfirm(selectedPrice as number, comment.trim());
    if (ok) onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 justify-end">
        <View className="bg-card rounded-t-3xl border-t border-border p-4" style={{ gap: 12 }}>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Store size={20} color={colors.primary} />
              <Text className="font-display text-foreground text-lg">{t("sell_to_operator")}</Text>
            </View>
            <Pressable onPress={onClose} className="w-8 h-8 rounded-full bg-secondary items-center justify-center active:opacity-80">
              <X size={16} color={colors.foreground} />
            </Pressable>
          </View>

          <Text className="font-sans text-muted-foreground text-[13px]" style={{ lineHeight: 19 }}>
            {t("sell_hint")}
          </Text>

          <View style={{ gap: 8 }}>
            {TARIFFS.map((tier) => {
              const price = prices[tier.key];
              const isSel = selected === tier.key;
              const unavailable = !fetching && price == null;
              return (
                <Pressable
                  key={tier.key}
                  onPress={() => !unavailable && setSelected(tier.key)}
                  disabled={unavailable}
                  className={`flex-row items-center rounded-2xl border px-3 py-3 active:opacity-90 ${
                    isSel ? "bg-emerald-500/15 border-emerald-500" : "bg-secondary border-border"
                  }`}
                  style={{ gap: 12, opacity: unavailable ? 0.4 : 1 }}
                >
                  <View className={`w-9 h-9 rounded-xl items-center justify-center ${isSel ? "bg-emerald-500" : "bg-muted"}`}>
                    <Store size={16} color={isSel ? "#fff" : colors.mutedForeground} />
                  </View>
                  <View className="flex-1">
                    <Text className={`font-sans-bold text-sm ${isSel ? "text-emerald-400" : "text-foreground"}`}>{tier.labelKey ? t(tier.labelKey) : tier.label}</Text>
                    <Text className="font-sans text-muted-foreground text-[12px]">
                      {fetching && price == null ? t("loading") : price == null ? t("tariff_missing") : formatCurrency(price)}
                    </Text>
                  </View>
                  {isSel ? (
                    <View className="w-5 h-5 rounded-full bg-emerald-500 items-center justify-center">
                      <Check size={12} color="#fff" strokeWidth={3} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder={t("sell_comment")}
            placeholderTextColor={colors.mutedForeground}
            className="px-3 py-3 rounded-xl bg-muted border border-border text-foreground text-sm"
            style={{ color: colors.foreground }}
          />

          {error ? <Text className="font-sans text-red-400 text-[13px] text-center">{error}</Text> : null}

          <Pressable
            onPress={submit}
            disabled={!canSell}
            className="py-3.5 rounded-2xl bg-primary flex-row items-center justify-center active:opacity-90"
            style={{ gap: 8, opacity: !canSell ? 0.5 : 1 }}
          >
            {loading ? <ActivityIndicator color={colors.primaryForeground} /> : <Store size={18} color={colors.primaryForeground} />}
            <Text className="font-sans-bold text-primary-foreground text-sm">
              {selectedPrice ? `${t("sell_list_for")} ${formatCurrency(selectedPrice)}` : t("sell_list")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
