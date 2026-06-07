import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { Zap, MapPin, Check } from "lucide-react-native";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { colors } from "@/lib/theme";
import { formatCurrency } from "@/features/orders/utils";
import { wsEvents } from "@/lib/ws-events";

type Offer = { offerId: number; ride: any };

// Срочные tab — list of pending offers the driver can accept.
export default function UrgentScreen() {
  const { token } = useAuth();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/drivers/pending-offers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setOffers(d.offers || []);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 8000);
    const off = wsEvents.on((d) => {
      if (d.type === "new_order" || d.type === "new_ride") load();
    });
    return () => {
      clearInterval(iv);
      off();
    };
  }, [load]);

  const accept = async (offer: Offer) => {
    if (acceptingId) return;
    setAcceptingId(offer.offerId);
    try {
      const res = await fetch(`${API_BASE_URL}/api/drivers/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rideId: offer.ride?.id }),
      });
      if (res.ok) setOffers((prev) => prev.filter((o) => o.offerId !== offer.offerId));
    } catch {
    } finally {
      setAcceptingId(null);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="p-4"
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
    >
      {offers.length === 0 ? (
        <View className="items-center justify-center py-24">
          <View className="w-20 h-20 rounded-2xl bg-primary/[0.12] items-center justify-center mb-4">
            <Zap size={36} color={colors.primary} />
          </View>
          <Text className="font-display text-foreground text-xl mb-1">Срочные заказы</Text>
          <Text className="font-sans text-muted-foreground text-sm">Пока нет доступных заказов</Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {offers.map((offer) => {
            const r = offer.ride || {};
            return (
              <View key={offer.offerId} className="bg-card border border-border rounded-2xl p-4">
                <View className="flex-row items-center" style={{ gap: 10 }}>
                  <View className="items-center" style={{ gap: 2 }}>
                    <View className="w-3 h-3 rounded-full bg-emerald-500" />
                    <View style={{ width: 1, height: 16, backgroundColor: colors.border }} />
                    <View className="w-3 h-3 rounded-full bg-red-500" />
                  </View>
                  <View className="flex-1">
                    <Text className="font-sans-bold text-foreground text-sm" numberOfLines={1}>
                      {r.fromDistrictName || r.fromCity || "—"}
                    </Text>
                    <View className="h-2" />
                    <Text className="font-sans-bold text-foreground text-sm" numberOfLines={1}>
                      {r.toDistrictName || r.toCity || "—"}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="font-display text-foreground text-lg">{formatCurrency(r.price)}</Text>
                    <View className="flex-row items-center" style={{ gap: 3 }}>
                      <MapPin size={12} color={colors.mutedForeground} />
                      <Text className="font-sans text-muted-foreground text-[12px]">{r.distance ?? "—"} км</Text>
                    </View>
                  </View>
                </View>
                <Pressable
                  onPress={() => accept(offer)}
                  disabled={acceptingId === offer.offerId}
                  className="mt-3 py-3 rounded-xl bg-emerald-500 flex-row items-center justify-center active:opacity-90"
                  style={{ gap: 6 }}
                >
                  {acceptingId === offer.offerId ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Check size={18} color="#fff" />
                  )}
                  <Text className="font-sans-bold text-white text-sm">Принять заказ</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
