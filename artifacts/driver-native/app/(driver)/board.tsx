import { useState, useEffect, useCallback, useRef } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, RefreshControl, Alert } from "react-native";
import { MapPin, Check, ShoppingBag, User, Clock, LayoutGrid, Package } from "lucide-react-native";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { colors } from "@/lib/theme";
import { formatCurrency } from "@/features/orders/utils";
import { wsEvents } from "@/lib/ws-events";
import { playMarket, playNewOrder } from "@/lib/sounds";
import { isRecentlyUnassigned } from "@/lib/unassigned-guard";
import { useT } from "@/lib/i18n";

// One unified item from GET /api/drivers/free-orders.
type Item = {
  kind: "order" | "marketplace";
  id: number;
  rideId?: number;
  listingId?: number;
  fromCity?: string;
  toCity?: string;
  fromDistrictName?: string;
  toDistrictName?: string;
  price?: number;
  basePrice?: number;
  passengers?: number;
  seatsCount?: number;
  distance?: number | string;
  scheduledAt?: string;
  timeSlot?: string;
  clientName?: string;
  comment?: string;
  isUrgent?: boolean;
  optionDetails?: Array<{ key: string; label: string; price: number }>;
};

// "Свободные" tab — ALL orders nobody has taken yet: pending dispatcher/client
// orders (accept) + marketplace listings sold by other drivers (buy). Any driver
// can grab one here. (Distinct from "Срочные" which is offers made TO this driver.)
export default function BoardScreen() {
  const { t } = useT();
  const { token } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);

  const keyOf = (it: Item) => `${it.kind}:${it.id}`;

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/drivers/free-orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const raw: Item[] = (await res.json()).items || [];
      // Hide an order this device just had unassigned (avoid instant re-grab churn).
      const next = raw.filter((it) => it.kind !== "order" || !isRecentlyUnassigned(it.rideId));

      if (!firstLoad.current) {
        const fresh = next.filter((it) => !seen.current.has(keyOf(it)));
        if (fresh.length > 0) {
          if (fresh.some((it) => it.kind === "marketplace")) playMarket();
          else playNewOrder();
        }
      }
      seen.current = new Set(next.map(keyOf));
      firstLoad.current = false;
      setItems(next);
    } catch {
      /* keep last */
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 10000);
    const off = wsEvents.on((d: any) => {
      if (
        [
          "new_order",
          "new_ride",
          "ride_updated",
          "ride_accepted",
          "ride_cancelled",
          "order_expired",
          "ride_unassigned_by_dispatcher",
          "marketplace_new_listing",
          "marketplace_listing_sold",
        ].includes(d.type)
      )
        load();
    });
    return () => {
      clearInterval(iv);
      off();
    };
  }, [load]);

  const take = async (it: Item) => {
    const k = keyOf(it);
    if (busyKey) return;
    setBusyKey(k);
    try {
      if (it.kind === "order") {
        const res = await fetch(`${API_BASE_URL}/api/drivers/accept`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ rideId: it.rideId }),
        });
        const dd = await res.json().catch(() => ({}) as any);
        if (res.ok) {
          setItems((p) => p.filter((x) => keyOf(x) !== k));
          Alert.alert(t("accepted_title"), t("accepted_sub"));
        } else {
          Alert.alert(t("err"), dd.message || t("accept_failed"));
        }
      } else {
        const res = await fetch(`${API_BASE_URL}/api/marketplace/buy`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ listingId: it.listingId }),
        });
        const dd = await res.json().catch(() => ({}) as any);
        if (res.ok) {
          setItems((p) => p.filter((x) => keyOf(x) !== k));
          Alert.alert(t("bought"), t("bought_sub"));
        } else {
          Alert.alert(t("err"), dd.message || t("buy_failed"));
        }
      }
    } catch {
      Alert.alert(t("err_network"), t("err_network_sub"));
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="flex-1"
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
      >
        <View className="flex-1 items-center justify-center py-24">
          <View className="w-20 h-20 rounded-2xl bg-primary/[0.12] items-center justify-center mb-4">
            <LayoutGrid size={36} color={colors.primary} />
          </View>
          <Text className="font-display text-foreground text-xl mb-1">{t("board_empty_title")}</Text>
          <Text className="font-sans text-muted-foreground text-sm">{t("board_empty_sub")}</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="p-4"
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
    >
      <View style={{ gap: 10 }}>
        {items.map((it) => {
          const k = keyOf(it);
          const isMarket = it.kind === "marketplace";
          return (
            <View key={k} className="bg-card border border-border rounded-2xl p-4">
              <View className="flex-row items-center justify-between mb-2">
                <View className="flex-row items-center" style={{ gap: 6 }}>
                  {isMarket ? (
                    <View className="w-5 h-5 rounded-md bg-primary items-center justify-center">
                      <Text className="font-sans-bold text-[12px]" style={{ color: colors.primaryForeground }}>M</Text>
                    </View>
                  ) : null}
                  <Text className="font-sans-bold text-[11px] uppercase" style={{ letterSpacing: 0.5, color: isMarket ? colors.primary : colors.mutedForeground }}>
                    {isMarket ? t("market") : (it.isUrgent ? t("nav_urgent") : t("nav_orders"))}
                  </Text>
                </View>
              </View>

              <Route
                from={it.fromDistrictName || it.fromCity}
                to={it.toDistrictName || it.toCity}
                price={it.price}
                distance={it.distance}
              />

              <View className="flex-row items-center mt-2" style={{ gap: 12 }}>
                {it.clientName ? (
                  <View className="flex-row items-center" style={{ gap: 4 }}>
                    <User size={12} color={colors.mutedForeground} />
                    <Text className="font-sans text-muted-foreground text-[12px]">{it.clientName}</Text>
                  </View>
                ) : null}
                {it.timeSlot ? (
                  <View className="flex-row items-center" style={{ gap: 4 }}>
                    <Clock size={12} color={colors.mutedForeground} />
                    <Text className="font-sans text-muted-foreground text-[12px]">{it.timeSlot}</Text>
                  </View>
                ) : null}
                {(it.passengers || it.seatsCount) ? (
                  <View className="flex-row items-center" style={{ gap: 4 }}>
                    <User size={12} color={colors.mutedForeground} />
                    <Text className="font-sans text-muted-foreground text-[12px]">{it.passengers || it.seatsCount}</Text>
                  </View>
                ) : null}
              </View>

              {it.comment ? (
                <Text className="font-sans text-muted-foreground text-[12px] mt-1" numberOfLines={2}>
                  {it.comment}
                </Text>
              ) : null}

              {it.optionDetails && it.optionDetails.length > 0 ? (
                <View className="flex-row flex-wrap mt-2" style={{ gap: 6 }}>
                  {it.optionDetails.map((o) => (
                    <View key={o.key} className="flex-row items-center bg-amber-100 rounded-lg px-2 py-1" style={{ gap: 4 }}>
                      <Package size={12} color="#854f0b" />
                      <Text className="font-sans-bold text-[11px]" style={{ color: "#854f0b" }}>
                        {o.label}{o.price ? ` +${formatCurrency(o.price)}` : ""}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <Pressable
                onPress={() => take(it)}
                disabled={busyKey === k}
                className={`mt-3 py-3 rounded-xl flex-row items-center justify-center active:opacity-90 ${isMarket ? "bg-primary" : "bg-emerald-500"}`}
                style={{ gap: 6 }}
              >
                {busyKey === k ? (
                  <ActivityIndicator color="#fff" />
                ) : isMarket ? (
                  <ShoppingBag size={18} color={colors.primaryForeground} />
                ) : (
                  <Check size={18} color="#fff" />
                )}
                <Text className="font-sans-bold text-white text-sm">
                  {isMarket ? `${t("buy")} · ${formatCurrency(it.price)}` : t("accept_order")}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function Route({ from, to, price, distance }: { from?: string; to?: string; price?: number; distance?: number | string }) {
  const { t } = useT();
  return (
    <View className="flex-row items-center" style={{ gap: 10 }}>
      <View className="items-center" style={{ gap: 2 }}>
        <View className="w-3 h-3 rounded-full bg-emerald-500" />
        <View style={{ width: 1, height: 16, backgroundColor: colors.border }} />
        <View className="w-3 h-3 rounded-full bg-red-500" />
      </View>
      <View className="flex-1">
        <Text className="font-sans-bold text-foreground text-sm" numberOfLines={1}>{from || "—"}</Text>
        <View className="h-2" />
        <Text className="font-sans-bold text-foreground text-sm" numberOfLines={1}>{to || "—"}</Text>
      </View>
      <View className="items-end">
        <Text className="font-display text-foreground text-lg">{formatCurrency(price)}</Text>
        {distance != null ? (
          <View className="flex-row items-center" style={{ gap: 3 }}>
            <MapPin size={12} color={colors.mutedForeground} />
            <Text className="font-sans text-muted-foreground text-[12px]">{distance} {t("unit_km")}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
