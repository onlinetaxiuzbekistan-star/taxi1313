import { useState, useEffect, useCallback, useRef } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, RefreshControl, Alert } from "react-native";
import { Zap, MapPin, Check, ShoppingBag, User, Clock } from "lucide-react-native";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { colors } from "@/lib/theme";
import { formatCurrency } from "@/features/orders/utils";
import { wsEvents } from "@/lib/ws-events";
import { playMarket, playNewOrder } from "@/lib/sounds";
import { useT } from "@/lib/i18n";

type Offer = { offerId: number; ride: any };
type Listing = {
  id: number;
  fromCity: string;
  toCity: string;
  price: number;
  sellerName?: string;
  seatsCount?: number;
  passengers?: number;
  carClass?: string;
  comment?: string;
  scheduledAt?: string;
  timeSlot?: string;
};

// Срочные tab — urgent offers (accept) + marketplace listings (buy).
export default function UrgentScreen() {
  const { t } = useT();
  const { token } = useAuth();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const seenListings = useRef<Set<number>>(new Set());
  const seenOffers = useRef<Set<number>>(new Set());
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [oRes, lRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/drivers/pending-offers`, { headers }),
        fetch(`${API_BASE_URL}/api/marketplace/listings`, { headers }),
      ]);
      const newOffers: Offer[] = oRes.ok ? (await oRes.json()).offers || [] : [];
      const newListings: Listing[] = lRes.ok ? (await lRes.json()).listings || [] : [];
      if (oRes.ok) setOffers(newOffers);
      if (lRes.ok) setListings(newListings);

      // Play a sound when a NEW item appears (skip the very first load).
      if (!firstLoad.current) {
        if (newOffers.some((o) => !seenOffers.current.has(o.offerId))) playNewOrder();
        if (newListings.some((l) => !seenListings.current.has(l.id))) playMarket();
      }
      seenOffers.current = new Set(newOffers.map((o) => o.offerId));
      seenListings.current = new Set(newListings.map((l) => l.id));
      firstLoad.current = false;
    } catch {
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 10000);
    const off = wsEvents.on((d: any) => {
      // Mirror web UrgentOrders: refresh on any event that adds/removes an order
      // (incl. operator unassign / expiry / marketplace changes).
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

  const accept = async (offer: Offer) => {
    if (busyId) return;
    setBusyId(offer.offerId);
    try {
      const res = await fetch(`${API_BASE_URL}/api/drivers/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rideId: offer.ride?.id }),
      });
      if (res.ok) setOffers((p) => p.filter((o) => o.offerId !== offer.offerId));
    } catch {
    } finally {
      setBusyId(null);
    }
  };

  const buy = async (listing: Listing) => {
    if (busyId) return;
    setBusyId(listing.id);
    try {
      const res = await fetch(`${API_BASE_URL}/api/marketplace/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ listingId: listing.id }),
      });
      const d = await res.json().catch(() => ({}) as any);
      if (res.ok) {
        setListings((p) => p.filter((l) => l.id !== listing.id));
        Alert.alert(t("bought"), t("bought_sub"));
      } else {
        Alert.alert(t("err"), d.message || t("buy_failed"));
      }
    } catch {
      Alert.alert(t("err_network"), t("err_network_sub"));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const empty = offers.length === 0 && listings.length === 0;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="p-4"
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
    >
      {empty ? (
        <View className="items-center justify-center py-24">
          <View className="w-20 h-20 rounded-2xl bg-primary/[0.12] items-center justify-center mb-4">
            <Zap size={36} color={colors.primary} />
          </View>
          <Text className="font-display text-foreground text-xl mb-1">{t("urgent_empty_title")}</Text>
          <Text className="font-sans text-muted-foreground text-sm">{t("urgent_empty_sub")}</Text>
        </View>
      ) : (
        <>
          {offers.length > 0 && (
            <>
              <Text className="font-sans-bold text-muted-foreground text-[11px] uppercase mb-2" style={{ letterSpacing: 0.5 }}>
                {t("urgent_section")}
              </Text>
              <View style={{ gap: 10 }}>
                {offers.map((offer) => {
                  const r = offer.ride || {};
                  return (
                    <View key={offer.offerId} className="bg-card border border-border rounded-2xl p-4">
                      <Route from={r.fromDistrictName || r.fromCity} to={r.toDistrictName || r.toCity} price={r.price} distance={r.distance} />
                      <Pressable
                        onPress={() => accept(offer)}
                        disabled={busyId === offer.offerId}
                        className="mt-3 py-3 rounded-xl bg-emerald-500 flex-row items-center justify-center active:opacity-90"
                        style={{ gap: 6 }}
                      >
                        {busyId === offer.offerId ? <ActivityIndicator color="#fff" /> : <Check size={18} color="#fff" />}
                        <Text className="font-sans-bold text-white text-sm">{t("accept_order")}</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {listings.length > 0 && (
            <>
              <View className="flex-row items-center mt-5 mb-2" style={{ gap: 6 }}>
                <ShoppingBag size={14} color={colors.primary} />
                <Text className="font-sans-bold text-muted-foreground text-[11px] uppercase" style={{ letterSpacing: 0.5 }}>
                  {t("market")}
                </Text>
              </View>
              <View style={{ gap: 10 }}>
                {listings.map((l) => (
                  <View key={l.id} className="bg-card border border-border rounded-2xl p-4">
                    <Route from={l.fromCity} to={l.toCity} price={l.price} />
                    <View className="flex-row items-center mt-2" style={{ gap: 12 }}>
                      {l.sellerName ? (
                        <View className="flex-row items-center" style={{ gap: 4 }}>
                          <User size={12} color={colors.mutedForeground} />
                          <Text className="font-sans text-muted-foreground text-[12px]">{l.sellerName}</Text>
                        </View>
                      ) : null}
                      {l.timeSlot ? (
                        <View className="flex-row items-center" style={{ gap: 4 }}>
                          <Clock size={12} color={colors.mutedForeground} />
                          <Text className="font-sans text-muted-foreground text-[12px]">{l.timeSlot}</Text>
                        </View>
                      ) : null}
                    </View>
                    {l.comment ? (
                      <Text className="font-sans text-muted-foreground text-[12px] mt-1" numberOfLines={2}>
                        {l.comment}
                      </Text>
                    ) : null}
                    <Pressable
                      onPress={() => buy(l)}
                      disabled={busyId === l.id}
                      className="mt-3 py-3 rounded-xl bg-primary flex-row items-center justify-center active:opacity-90"
                      style={{ gap: 6 }}
                    >
                      {busyId === l.id ? <ActivityIndicator color={colors.primaryForeground} /> : <ShoppingBag size={18} color={colors.primaryForeground} />}
                      <Text className="font-sans-bold text-primary-foreground text-sm">{t("buy")} · {formatCurrency(l.price)}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </>
          )}
        </>
      )}
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
        <Text className="font-sans-bold text-foreground text-sm" numberOfLines={1}>
          {from || "—"}
        </Text>
        <View className="h-2" />
        <Text className="font-sans-bold text-foreground text-sm" numberOfLines={1}>
          {to || "—"}
        </Text>
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
