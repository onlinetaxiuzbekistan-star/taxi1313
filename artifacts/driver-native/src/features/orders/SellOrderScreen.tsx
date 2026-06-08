import { useState, useEffect, useMemo } from "react";
import { View, Text, Pressable, ScrollView, TextInput, ActivityIndicator } from "react-native";
import { ChevronLeft, ChevronDown, ChevronUp, Store, Check, Minus, Plus, MapPin } from "lucide-react-native";

import { colors } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "./utils";
import type { City, RouteOption } from "./types";

const TIERS = [
  { key: "economy", labelKey: "tariff_standard", col: "priceEconomy" },
  { key: "comfort", label: "Comfort", col: "priceComfort" },
  { key: "business", labelKey: "tariff_business", col: "priceBusiness" },
] as const;

export type SellOrderParams = {
  routeId: number;
  clientPhone: string;
  seatsCount: number[];
  price: number;
  comment?: string;
  genders?: (string | null)[];
};

// Driver creates a standalone order and sells it to the operator (efir).
// Mirrors the web Marketplace sell form → POST /api/marketplace/sell-order
// (new ride with driverId:null, auto-dispatched — never occupies the seller).
export function SellOrderScreen({
  cities,
  routes,
  loading,
  error,
  onSubmit,
  onBack,
}: {
  cities: City[];
  routes: RouteOption[];
  loading?: boolean;
  error?: string | null;
  onSubmit: (p: SellOrderParams) => Promise<boolean>;
  onBack: () => void;
}) {
  const { t } = useT();
  const [routeId, setRouteId] = useState<number | null>(null);
  const [tier, setTier] = useState<string>("economy");
  const [seats, setSeats] = useState(1);
  const [phone, setPhone] = useState("+998");
  const [priceStr, setPriceStr] = useState("");
  const [comment, setComment] = useState("");
  const [routeOpen, setRouteOpen] = useState(false);

  const cityName = (s?: string) => cities.find((c) => c.id === s || c.nameRu === s)?.nameRu || s || "—";

  const selRoute = useMemo(
    () => routes.find((r) => (r as any).id === routeId) as any,
    [routes, routeId],
  );

  const tierCol = TIERS.find((x) => x.key === tier)!.col;
  const perSeat = selRoute ? Number(selRoute[tierCol] || selRoute.priceEconomy || 0) : 0;
  const minPrice = selRoute ? Number(selRoute.priceEconomy || 0) * seats : 0;
  const computed = perSeat * seats;

  // Auto-fill the price from the current route tariff × seats (web behavior).
  useEffect(() => {
    setPriceStr(computed > 0 ? String(computed) : "");
  }, [computed]);

  const price = Number(priceStr.replace(/\D/g, "")) || 0;
  const phoneDigits = phone.replace(/\D/g, "");
  const canSubmit = !!routeId && phoneDigits.length >= 9 && price >= minPrice && minPrice > 0 && !loading;

  const submit = async () => {
    if (!canSubmit || !routeId) return;
    const ok = await onSubmit({
      routeId,
      clientPhone: phone.trim(),
      seatsCount: Array.from({ length: seats }, (_, i) => i + 1),
      price,
      comment: comment.trim() || undefined,
      genders: Array.from({ length: seats }, () => "male"),
    });
    if (ok) onBack();
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-4 pt-3 pb-10">
      <View className="flex-row items-center mb-4" style={{ gap: 4 }}>
        <Pressable onPress={onBack} className="w-10 h-10 -ml-2 items-center justify-center active:opacity-70">
          <ChevronLeft size={24} color={colors.foreground} />
        </Pressable>
        <Store size={18} color={colors.primary} />
        <Text className="font-display text-foreground text-lg ml-1">{t("sell_to_operator")}</Text>
      </View>

      {/* Route */}
      <Label text={t("sell_route")} />
      {routes.length === 0 ? (
        <Text className="font-sans text-muted-foreground text-[13px] py-2">{t("sell_no_routes")}</Text>
      ) : (
        <View>
          <Pressable
            onPress={() => setRouteOpen((o) => !o)}
            className={`flex-row items-center bg-card border rounded-xl px-3 py-3.5 active:opacity-90 ${routeOpen ? "border-primary" : "border-border"}`}
            style={{ gap: 10 }}
          >
            <MapPin size={16} color={colors.primary} />
            <Text className={`flex-1 font-sans-bold text-sm ${selRoute ? "text-foreground" : "text-muted-foreground"}`}>
              {selRoute ? `${cityName(selRoute.fromCity)} → ${cityName(selRoute.toCity)}` : t("rs_choose")}
            </Text>
            {routeOpen ? <ChevronUp size={18} color={colors.mutedForeground} /> : <ChevronDown size={18} color={colors.mutedForeground} />}
          </Pressable>
          {routeOpen ? (
            <View className="mt-1.5 bg-card border border-border rounded-xl overflow-hidden">
              {routes.map((r) => {
                const id = (r as any).id;
                const sel = routeId === id;
                return (
                  <Pressable
                    key={id}
                    onPress={() => {
                      setRouteId(id);
                      setRouteOpen(false);
                    }}
                    className={`flex-row items-center px-3 py-3 border-b border-border active:opacity-80 ${sel ? "bg-emerald-500/10" : ""}`}
                  >
                    <Text className={`flex-1 font-sans-bold text-sm ${sel ? "text-emerald-400" : "text-foreground"}`}>
                      {cityName(r.fromCity)} → {cityName(r.toCity)}
                    </Text>
                    {sel ? <Check size={16} color={colors.emerald} strokeWidth={3} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      )}

      {/* Tariff */}
      <Label text={t("sell_tariff")} className="mt-4" />
      <View className="flex-row" style={{ gap: 8 }}>
        {TIERS.map((ti) => {
          const sel = tier === ti.key;
          const colPrice = selRoute ? Number(selRoute[ti.col] || 0) : 0;
          return (
            <Pressable
              key={ti.key}
              onPress={() => setTier(ti.key)}
              className={`flex-1 py-2.5 rounded-xl border items-center active:opacity-90 ${sel ? "bg-emerald-500/15 border-emerald-500" : "bg-card border-border"}`}
            >
              <Text className={`font-sans-bold text-[13px] ${sel ? "text-emerald-400" : "text-foreground"}`}>
                {"labelKey" in ti ? t(ti.labelKey as any) : ti.label}
              </Text>
              <Text className={`font-sans text-[10px] ${sel ? "text-emerald-400/70" : "text-muted-foreground"}`}>
                {colPrice > 0 ? formatCurrency(colPrice) : "—"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Seats */}
      <Label text={t("sell_seats")} className="mt-4" />
      <View className="flex-row items-center" style={{ gap: 10 }}>
        <Pressable
          onPress={() => setSeats((s) => Math.max(1, s - 1))}
          className="w-11 h-11 rounded-xl bg-card border border-border items-center justify-center active:opacity-80"
        >
          <Minus size={18} color={colors.foreground} />
        </Pressable>
        <View className="flex-1 items-center">
          <Text className="font-display text-foreground text-2xl">{seats}</Text>
        </View>
        <Pressable
          onPress={() => setSeats((s) => Math.min(4, s + 1))}
          className="w-11 h-11 rounded-xl bg-card border border-border items-center justify-center active:opacity-80"
        >
          <Plus size={18} color={colors.foreground} />
        </Pressable>
        <Pressable
          onPress={() => setSeats(4)}
          className={`px-3 h-11 rounded-xl border items-center justify-center active:opacity-80 ${seats === 4 ? "bg-primary border-primary" : "bg-card border-border"}`}
        >
          <Text className={`font-sans-bold text-[12px] ${seats === 4 ? "text-primary-foreground" : "text-foreground"}`}>{t("sell_whole_car")}</Text>
        </Pressable>
      </View>

      {/* Client phone */}
      <Label text={t("sell_phone")} className="mt-4" />
      <TextInput
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="+998 90 123 45 67"
        placeholderTextColor={colors.mutedForeground}
        className="px-3 py-3 rounded-xl bg-card border border-border text-foreground text-base"
        style={{ color: colors.foreground }}
      />

      {/* Price */}
      <Label text={t("sell_price")} className="mt-4" />
      <TextInput
        value={priceStr}
        onChangeText={setPriceStr}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={colors.mutedForeground}
        className="px-3 py-3 rounded-xl bg-card border border-border text-foreground text-base"
        style={{ color: colors.foreground }}
      />
      {minPrice > 0 ? (
        <Text className="font-sans text-muted-foreground text-[12px] mt-1">
          {t("sell_min")}: {formatCurrency(minPrice)}
        </Text>
      ) : null}

      {/* Comment */}
      <TextInput
        value={comment}
        onChangeText={setComment}
        placeholder={t("sell_comment")}
        placeholderTextColor={colors.mutedForeground}
        className="mt-4 px-3 py-3 rounded-xl bg-card border border-border text-foreground text-sm"
        style={{ color: colors.foreground }}
      />

      {error ? <Text className="font-sans text-red-400 text-[13px] text-center mt-3">{error}</Text> : null}

      <Pressable
        onPress={submit}
        disabled={!canSubmit}
        className="mt-5 py-4 rounded-2xl bg-primary flex-row items-center justify-center active:opacity-90"
        style={{ gap: 8, opacity: !canSubmit ? 0.5 : 1 }}
      >
        {loading ? <ActivityIndicator color={colors.primaryForeground} /> : <Store size={20} color={colors.primaryForeground} />}
        <Text className="font-sans-bold text-primary-foreground text-base">
          {price > 0 ? `${t("sell_list")} · ${formatCurrency(price)}` : t("sell_list")}
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
