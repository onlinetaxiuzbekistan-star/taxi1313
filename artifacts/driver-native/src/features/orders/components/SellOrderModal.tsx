import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, TextInput, Modal, ActivityIndicator } from "react-native";
import { Store, X, Check } from "lucide-react-native";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { colors } from "@/lib/theme";
import { formatCurrency } from "../utils";
import type { Ride, SeatPassenger } from "../types";

// Tariff tiers — labels per owner (Стандарт / Comfort / Бизнес) mapped to the
// backend carClass values the dispatcher's price-estimate uses.
const TARIFFS: { key: string; carClass: string; label: string }[] = [
  { key: "economy", carClass: "economy", label: "Стандарт" },
  { key: "comfort", carClass: "comfort", label: "Comfort" },
  { key: "business", carClass: "business", label: "Бизнес" },
];

// Driver sells / returns the current order to the operator (marketplace).
// Price is NOT typed — the driver picks a tariff tier and the price is fetched
// LIVE from POST /api/rides/price-estimate (mirrors dispatcher CreateOrderDrawer),
// so any admin price raise (peak) is reflected automatically.
export function SellOrderModal({
  visible,
  ride,
  passengers,
  loading,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  ride: Ride;
  passengers: SeatPassenger[];
  loading?: boolean;
  onClose: () => void;
  onConfirm: (price: number, comment: string) => void;
}) {
  const { token } = useAuth();
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [fetching, setFetching] = useState(false);
  const [selected, setSelected] = useState<string>("economy");
  const [comment, setComment] = useState("");

  // Same seat composition the dispatcher prices: front = seat 1, back = 2..4.
  // Fall back to a single standard seat if the order has no seated passengers yet.
  let frontSeats = passengers.some((p) => p.seatNumber === 1) ? 1 : 0;
  let backSeats = passengers.filter((p) => p.seatNumber >= 2).length;
  if (frontSeats + backSeats === 0) backSeats = 1;

  const fetchPrices = useCallback(async () => {
    if (!token || !ride.fromCity || !ride.toCity) return;
    setFetching(true);
    try {
      const results = await Promise.all(
        TARIFFS.map(async (t) => {
          try {
            const res = await fetch(`${API_BASE_URL}/api/rides/price-estimate`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                fromCity: ride.fromCity,
                toCity: ride.toCity,
                carClass: t.carClass,
                roundTrip: false,
                frontSeats,
                backSeats,
              }),
            });
            if (!res.ok) return [t.key, null] as const;
            const d = await res.json();
            return [t.key, typeof d.price === "number" ? d.price : null] as const;
          } catch {
            return [t.key, null] as const;
          }
        }),
      );
      setPrices(Object.fromEntries(results));
    } finally {
      setFetching(false);
    }
  }, [token, ride.fromCity, ride.toCity, frontSeats, backSeats]);

  // Re-fetch live every time the sheet opens (no caching → peak prices show).
  useEffect(() => {
    if (visible) fetchPrices();
  }, [visible, fetchPrices]);

  const selectedPrice = prices[selected] ?? null;
  const canSell = typeof selectedPrice === "number" && selectedPrice > 0 && !loading;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 justify-end">
        <View className="bg-card rounded-t-3xl border-t border-border p-4" style={{ gap: 12 }}>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Store size={20} color={colors.primary} />
              <Text className="font-display text-foreground text-lg">Продать заказ оператору</Text>
            </View>
            <Pressable onPress={onClose} className="w-8 h-8 rounded-full bg-secondary items-center justify-center active:opacity-80">
              <X size={16} color={colors.foreground} />
            </Pressable>
          </View>

          <Text className="font-sans text-muted-foreground text-[13px]" style={{ lineHeight: 19 }}>
            Выберите тариф — цена берётся из текущего тарифа маршрута. Оплату получите после того, как покупатель завершит заказ.
          </Text>

          {/* three live tariff prices */}
          <View style={{ gap: 8 }}>
            {TARIFFS.map((t) => {
              const price = prices[t.key];
              const isSel = selected === t.key;
              const unavailable = !fetching && price == null;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => !unavailable && setSelected(t.key)}
                  disabled={unavailable}
                  className={`flex-row items-center rounded-2xl border px-3 py-3 active:opacity-90 ${
                    isSel ? "bg-emerald-500/15 border-emerald-500" : "bg-secondary border-border"
                  }`}
                  style={{ gap: 12, opacity: unavailable ? 0.4 : 1 }}
                >
                  <View
                    className={`w-9 h-9 rounded-xl items-center justify-center ${isSel ? "bg-emerald-500" : "bg-muted"}`}
                  >
                    <Store size={16} color={isSel ? "#fff" : colors.mutedForeground} />
                  </View>
                  <View className="flex-1">
                    <Text className={`font-sans-bold text-sm ${isSel ? "text-emerald-400" : "text-foreground"}`}>
                      {t.label}
                    </Text>
                    <Text className="font-sans text-muted-foreground text-[12px]">
                      {fetching && price == null
                        ? "Загрузка…"
                        : price == null
                          ? "Тариф не настроен"
                          : formatCurrency(price)}
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
            placeholder="Комментарий (необязательно)"
            placeholderTextColor={colors.mutedForeground}
            className="px-3 py-3 rounded-xl bg-muted border border-border text-foreground text-sm"
            style={{ color: colors.foreground }}
          />

          <Pressable
            onPress={() => canSell && onConfirm(selectedPrice as number, comment.trim())}
            disabled={!canSell}
            className="py-3.5 rounded-2xl bg-primary flex-row items-center justify-center active:opacity-90"
            style={{ gap: 8, opacity: !canSell ? 0.5 : 1 }}
          >
            {loading ? <ActivityIndicator color={colors.primaryForeground} /> : <Store size={18} color={colors.primaryForeground} />}
            <Text className="font-sans-bold text-primary-foreground text-sm">
              {selectedPrice ? `Выставить за ${formatCurrency(selectedPrice)}` : "Выставить на продажу"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
