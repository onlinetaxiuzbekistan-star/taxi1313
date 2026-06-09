import { useState, useEffect, useMemo } from "react";
import { View, Text, Pressable, ScrollView, TextInput, ActivityIndicator, Modal } from "react-native";
import { ChevronLeft, ChevronDown, ChevronUp, Store, Check, MapPin, X } from "lucide-react-native";

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
  const [seatMode, setSeatMode] = useState<"front" | "back" | "whole">("whole");
  const [phone, setPhone] = useState("+998");
  const [priceStr, setPriceStr] = useState("");
  const [comment, setComment] = useState("");
  const [routeOpen, setRouteOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const cityName = (s?: string) => cities.find((c) => c.id === s || c.nameRu === s)?.nameRu || s || "—";

  const selRoute = useMemo(
    () => routes.find((r) => (r as any).id === routeId) as any,
    [routes, routeId],
  );

  // Front row = seat 1, back row = seats 2..4, whole car = 1..4.
  const seatNums = seatMode === "front" ? [1] : seatMode === "back" ? [2, 3, 4] : [1, 2, 3, 4];
  const seats = seatNums.length;

  const tierCol = TIERS.find((x) => x.key === tier)!.col;
  const perSeat = selRoute ? Number(selRoute[tierCol] || selRoute.priceEconomy || 0) : 0;
  const minPrice = selRoute ? Number(selRoute.priceEconomy || 0) * seats : 0;
  const computed = perSeat * seats;

  // Auto-fill the price from the current route tariff × seats (web behavior).
  useEffect(() => {
    setPriceStr(computed > 0 ? String(computed) : "");
  }, [computed]);

  const price = Number(priceStr.replace(/\D/g, "")) || 0;
  // Phone is OPTIONAL now — only route + a valid price are required.
  const canSubmit = !!routeId && price >= minPrice && minPrice > 0 && !loading;

  const doSubmit = async () => {
    if (!canSubmit || !routeId) return;
    setConfirmOpen(false);
    const ok = await onSubmit({
      routeId,
      clientPhone: phone.trim(),
      seatsCount: seatNums,
      price,
      comment: comment.trim() || undefined,
      genders: seatNums.map(() => "male"),
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

      {/* Seats — row selection (front / back / whole car), like the ride picker */}
      <Label text={t("sell_seats")} className="mt-4" />
      <View className="flex-row" style={{ gap: 8 }}>
        {([
          ["front", t("sell_front_row")],
          ["back", t("sell_back_row")],
          ["whole", t("sell_whole_car")],
        ] as const).map(([mode, label]) => {
          const sel = seatMode === mode;
          return (
            <Pressable
              key={mode}
              onPress={() => setSeatMode(mode)}
              className={`flex-1 py-3 rounded-xl border items-center active:opacity-80 ${sel ? "bg-primary border-primary" : "bg-card border-border"}`}
            >
              <Text className={`font-sans-bold text-[12px] text-center ${sel ? "text-primary-foreground" : "text-foreground"}`}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Client phone — OPTIONAL */}
      <Label text={t("sell_phone_optional")} className="mt-4" />
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
        onPress={() => canSubmit && setConfirmOpen(true)}
        disabled={!canSubmit}
        className="mt-5 py-4 rounded-2xl bg-primary flex-row items-center justify-center active:opacity-90"
        style={{ gap: 8, opacity: !canSubmit ? 0.5 : 1 }}
      >
        {loading ? <ActivityIndicator color={colors.primaryForeground} /> : <Store size={20} color={colors.primaryForeground} />}
        <Text className="font-sans-bold text-primary-foreground text-base">
          {price > 0 ? `${t("sell_list")} · ${formatCurrency(price)}` : t("sell_list")}
        </Text>
      </Pressable>

      {/* Confirmation */}
      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View className="flex-1 bg-black/60 items-center justify-center px-6">
          <View className="w-full bg-card rounded-3xl border border-border p-5" style={{ gap: 14 }}>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center" style={{ gap: 8 }}>
                <Store size={20} color={colors.primary} />
                <Text className="font-display text-foreground text-lg">{t("sell_to_operator")}</Text>
              </View>
              <Pressable onPress={() => setConfirmOpen(false)} className="w-8 h-8 rounded-full bg-secondary items-center justify-center active:opacity-80">
                <X size={16} color={colors.foreground} />
              </Pressable>
            </View>
            <Text className="font-sans-bold text-foreground text-base text-center">{t("sell_confirm_q")}</Text>
            <View className="items-center rounded-2xl bg-secondary py-3">
              <Text className="font-sans text-muted-foreground text-[12px] uppercase" style={{ letterSpacing: 0.5 }}>
                {cityName(selRoute?.fromCity)} → {cityName(selRoute?.toCity)}
              </Text>
              <Text className="font-display text-emerald-400 text-2xl mt-1">{formatCurrency(price)}</Text>
            </View>
            <View className="flex-row" style={{ gap: 10 }}>
              <Pressable
                onPress={() => setConfirmOpen(false)}
                className="flex-1 py-3.5 rounded-2xl bg-secondary border border-border items-center active:opacity-80"
              >
                <Text className="font-sans-bold text-foreground text-sm">{t("no")}</Text>
              </Pressable>
              <Pressable
                onPress={doSubmit}
                disabled={loading}
                className="flex-1 py-3.5 rounded-2xl bg-primary items-center justify-center active:opacity-90"
                style={{ opacity: loading ? 0.6 : 1 }}
              >
                {loading ? <ActivityIndicator color={colors.primaryForeground} /> : <Text className="font-sans-bold text-primary-foreground text-sm">{t("yes")}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
