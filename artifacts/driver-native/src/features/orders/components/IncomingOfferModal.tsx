import { useState, useEffect, useRef, useCallback } from "react";
import { Modal, View, Text, Pressable, ActivityIndicator } from "react-native";
import { Zap, MapPin, User, Check, X, Package } from "lucide-react-native";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { wsEvents } from "@/lib/ws-events";
import { playNewOrder } from "@/lib/sounds";
import { isRecentlyUnassigned } from "@/lib/unassigned-guard";
import { colors } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "../utils";

type Offer = { offerId: number; expiresAt?: string; ride: any };

// Global incoming-offer modal (web IncomingOrderModal equivalent): polls
// /api/drivers/pending-offers (+ reacts to the new_order WS push), shows the
// first live offer with a countdown, and accepts via POST /api/drivers/accept.
export function IncomingOfferModal({ onAccepted }: { onAccepted?: () => void }) {
  const { t } = useT();
  const { token } = useAuth();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const dismissed = useRef<Set<number>>(new Set());

  const poll = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/drivers/pending-offers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const offers: Offer[] = (data.offers || []).filter(
        (o: Offer) => !dismissed.current.has(o.offerId) && !isRecentlyUnassigned(o.ride?.id),
      );
      setOffer((cur) => {
        const next = offers[0] || null;
        if (next && (!cur || cur.offerId !== next.offerId)) {
          playNewOrder(); // bundled new_order.mp3 + vibration
        }
        return next;
      });
    } catch {}
  }, [token]);

  useEffect(() => {
    if (!token) {
      setOffer(null);
      return;
    }
    poll();
    const iv = setInterval(poll, 6000);
    const off = wsEvents.on((d: any) => {
      if (d.type === "new_order" || d.type === "new_ride") poll();
      // Operator pulled/expired the offer → dismiss it immediately.
      if (d.type === "order_expired" || d.type === "ride_unassigned_by_dispatcher") {
        const rid = d.rideId ?? d.ride?.id;
        setOffer((cur) => {
          if (cur && (rid == null || cur.ride?.id === rid)) {
            if (cur.offerId != null) dismissed.current.add(cur.offerId);
            return null;
          }
          return cur;
        });
        poll();
      }
    });
    return () => {
      clearInterval(iv);
      off();
    };
  }, [token, poll]);

  // countdown
  useEffect(() => {
    if (!offer?.expiresAt) {
      setRemaining(null);
      return;
    }
    const end = new Date(offer.expiresAt).getTime();
    const tick = () => {
      const s = Math.max(0, Math.round((end - Date.now()) / 1000));
      setRemaining(s);
      if (s <= 0) {
        dismissed.current.add(offer.offerId);
        setOffer(null);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [offer?.offerId, offer?.expiresAt]);

  const accept = async () => {
    if (!offer || accepting) return;
    setAccepting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/drivers/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rideId: offer.ride?.id }),
      });
      if (res.ok) {
        dismissed.current.add(offer.offerId);
        setOffer(null);
        onAccepted?.();
      }
    } catch {
    } finally {
      setAccepting(false);
    }
  };

  const decline = () => {
    if (offer) dismissed.current.add(offer.offerId);
    setOffer(null);
  };

  if (!offer) return null;
  const r = offer.ride || {};
  const from = r.fromDistrictName || r.fromCity || "—";
  const to = r.toDistrictName || r.toCity || "—";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={decline}>
      <View className="flex-1 bg-black/70 items-center justify-center px-5">
        <View className="w-full max-w-sm bg-card rounded-3xl overflow-hidden border border-primary/30">
          <View className="bg-primary px-5 py-4 flex-row items-center justify-between">
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Zap size={20} color={colors.primaryForeground} />
              <Text className="font-display text-primary-foreground text-base">{t("offer_new")}</Text>
            </View>
            {remaining != null && (
              <View className="w-9 h-9 rounded-full bg-white/20 items-center justify-center">
                <Text className="font-sans-bold text-primary-foreground text-sm">{remaining}</Text>
              </View>
            )}
          </View>

          <View className="px-5 py-4" style={{ gap: 14 }}>
            <View className="flex-row items-center" style={{ gap: 10 }}>
              <View className="items-center" style={{ gap: 2 }}>
                <View className="w-3 h-3 rounded-full bg-emerald-500" />
                <View style={{ width: 1, height: 18, backgroundColor: colors.border }} />
                <View className="w-3 h-3 rounded-full bg-red-500" />
              </View>
              <View className="flex-1">
                <Text className="font-sans-bold text-foreground text-base" numberOfLines={1}>{from}</Text>
                <View className="h-3" />
                <Text className="font-sans-bold text-foreground text-base" numberOfLines={1}>{to}</Text>
              </View>
            </View>

            <View className="flex-row items-center justify-between bg-secondary rounded-2xl px-4 py-3">
              <View className="flex-row items-center" style={{ gap: 6 }}>
                <MapPin size={16} color={colors.mutedForeground} />
                <Text className="font-sans text-muted-foreground text-sm">{r.distance ?? "—"} {t("unit_km")}</Text>
              </View>
              <Text className="font-display text-foreground text-xl">{formatCurrency(r.price)}</Text>
            </View>

            {r.riderName ? (
              <View className="flex-row items-center" style={{ gap: 8 }}>
                <User size={16} color={colors.mutedForeground} />
                <Text className="font-sans text-muted-foreground text-sm">{r.riderName}</Text>
              </View>
            ) : null}

            {Array.isArray(r.optionDetails) && r.optionDetails.length > 0 ? (
              <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                {r.optionDetails.map((o: any) => (
                  <View key={o.key} className="flex-row items-center bg-amber-100 rounded-lg px-2 py-1" style={{ gap: 4 }}>
                    <Package size={12} color="#854f0b" />
                    <Text className="font-sans-bold text-[11px]" style={{ color: "#854f0b" }}>
                      {o.label}{o.price ? ` +${formatCurrency(o.price)}` : ""}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View className="flex-row" style={{ gap: 10 }}>
              <Pressable
                onPress={decline}
                className="flex-1 py-4 rounded-2xl bg-secondary border border-border flex-row items-center justify-center active:opacity-80"
                style={{ gap: 6 }}
              >
                <X size={18} color={colors.mutedForeground} />
                <Text className="font-sans-bold text-muted-foreground text-sm">{t("offer_later")}</Text>
              </Pressable>
              <Pressable
                onPress={accept}
                disabled={accepting}
                className="flex-[2] py-4 rounded-2xl bg-emerald-500 flex-row items-center justify-center active:opacity-90"
                style={{ gap: 8 }}
              >
                {accepting ? <ActivityIndicator color="#fff" /> : <Check size={18} color="#fff" />}
                <Text className="font-sans-bold text-white text-base">{t("offer_accept")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
