import { useState, useEffect, useMemo, useCallback } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft, MapPin, Clock, Users, TrendingUp } from "lucide-react-native";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { colors } from "@/lib/theme";
import { formatCurrency, formatRoutePoint } from "@/features/orders/utils";
import { useT, type TKey } from "@/lib/i18n";

interface EarningsData {
  today: number;
  thisWeek: number;
  thisMonth: number;
  completedRides: number;
}
interface RideRow {
  id: number;
  status: string;
  fromCity: string;
  toCity: string;
  fromDistrictName?: string | null;
  toDistrictName?: string | null;
  createdAt: string;
  passengers?: number;
  price: number;
}

const STATUS: Record<string, { labelKey: TKey; cls: string }> = {
  completed: { labelKey: "st_completed", cls: "bg-emerald-500/15 text-emerald-400" },
  cancelled: { labelKey: "st_cancelled", cls: "bg-red-500/10 text-red-400" },
  in_progress: { labelKey: "st_in_progress", cls: "bg-blue-500/15 text-blue-400" },
  accepted: { labelKey: "st_accepted", cls: "bg-primary/15 text-primary" },
  pending: { labelKey: "st_waiting", cls: "bg-secondary text-muted-foreground" },
};
const WD = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export default function EarningsScreen() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const [earnings, setEarnings] = useState<EarningsData | null>(null);
  const [rides, setRides] = useState<RideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "today" | "week" | "month">("all");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [eRes, rRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/drivers/earnings`, { headers }),
        fetch(`${API_BASE_URL}/api/drivers/my-rides`, { headers }),
      ]);
      if (eRes.ok) setEarnings(await eRes.json());
      if (rRes.ok) {
        const d = await rRes.json();
        setRides(d.rides || []);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // 7-day earnings bar chart (computed from completed rides).
  const chart = useMemo(() => {
    const days: { label: string; total: number }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      days.push({ label: WD[d.getDay()], total: 0 });
    }
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    for (const r of rides) {
      if (r.status !== "completed") continue;
      const created = new Date(r.createdAt);
      if (created < start) continue;
      const idx = 6 - Math.floor((now.getTime() - created.getTime()) / (24 * 3600 * 1000));
      if (idx >= 0 && idx < 7) days[idx].total += Math.round((r.price || 0) * 0.9);
    }
    const max = Math.max(1, ...days.map((d) => d.total));
    return { days, max };
  }, [rides]);

  const filteredRides = useMemo(() => {
    if (filter === "all") return rides;
    const now = Date.now();
    const cut = filter === "today" ? 1 : filter === "week" ? 7 : 30;
    const since = now - cut * 24 * 3600 * 1000;
    return rides.filter((r) => new Date(r.createdAt).getTime() >= since);
  }, [rides, filter]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-2 py-2" style={{ gap: 4 }}>
        <Pressable onPress={() => router.back()} className="w-10 h-10 items-center justify-center active:opacity-70">
          <ChevronLeft size={24} color={colors.foreground} />
        </Pressable>
        <Text className="font-display text-foreground text-lg">{t("earnings_menu")}</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} className="mt-8" />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
          {/* stat cards */}
          <View className="flex-row flex-wrap px-4" style={{ gap: 10 }}>
            {[
              { label: t("earn_today"), value: formatCurrency(earnings?.today || 0), primary: true },
              { label: t("earn_week"), value: formatCurrency(earnings?.thisWeek || 0) },
              { label: t("earn_month"), value: formatCurrency(earnings?.thisMonth || 0) },
              { label: t("earn_rides"), value: String(earnings?.completedRides ?? 0) },
            ].map((s) => (
              <View
                key={s.label}
                className={`rounded-2xl p-4 ${s.primary ? "bg-primary/[0.12] border border-primary/30" : "bg-card border border-border"}`}
                style={{ width: "47%" }}
              >
                <Text className="font-sans text-muted-foreground text-[12px]">{s.label}</Text>
                <Text className={`font-display text-lg mt-0.5 ${s.primary ? "text-primary" : "text-foreground"}`}>{s.value}</Text>
              </View>
            ))}
          </View>

          {/* 7-day chart */}
          <View className="mx-4 mt-4 bg-card border border-border rounded-2xl p-4">
            <View className="flex-row items-center mb-3" style={{ gap: 6 }}>
              <TrendingUp size={16} color={colors.primary} />
              <Text className="font-sans-bold text-foreground text-sm">{t("earn_7days")}</Text>
            </View>
            <View className="flex-row items-end justify-between" style={{ height: 120, gap: 6 }}>
              {chart.days.map((d, i) => (
                <View key={i} className="flex-1 items-center" style={{ gap: 4 }}>
                  <View className="w-full items-center justify-end" style={{ flex: 1 }}>
                    <View
                      className="w-full rounded-t-lg bg-primary"
                      style={{ height: Math.max(4, (d.total / chart.max) * 96), opacity: d.total > 0 ? 1 : 0.25 }}
                    />
                  </View>
                  <Text className="font-sans text-muted-foreground text-[10px]">{d.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* filter */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-4 py-3" style={{ flexGrow: 0 }}>
            <View className="flex-row" style={{ gap: 8 }}>
              {(["all", "today", "week", "month"] as const).map((f) => {
                const label = { all: t("filter_all"), today: t("filter_today"), week: t("filter_week"), month: t("filter_month") }[f];
                const active = filter === f;
                return (
                  <Pressable
                    key={f}
                    onPress={() => setFilter(f)}
                    className={`px-3.5 py-1.5 rounded-full border ${active ? "bg-primary border-primary" : "bg-card border-border"}`}
                  >
                    <Text className={`font-sans-semibold text-[13px] ${active ? "text-primary-foreground" : "text-foreground"}`}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          {/* rides */}
          {filteredRides.length === 0 ? (
            <Text className="font-sans text-muted-foreground text-sm text-center mt-6">{t("no_rides")}</Text>
          ) : (
            <View className="px-4" style={{ gap: 8 }}>
              {filteredRides.map((r) => {
                const st = STATUS[r.status] || STATUS.pending;
                return (
                  <View key={r.id} className="bg-card border border-border rounded-2xl p-4">
                    <View className="flex-row items-center justify-between mb-2">
                      <View className="flex-row items-center flex-1" style={{ gap: 6 }}>
                        <MapPin size={14} color={colors.primary} />
                        <Text className="font-sans-semibold text-foreground text-sm" numberOfLines={1}>
                          {formatRoutePoint(r.fromDistrictName, r.fromCity)} → {formatRoutePoint(r.toDistrictName, r.toCity)}
                        </Text>
                      </View>
                      <View className={`rounded-full px-2 py-0.5 ${st.cls.split(" ")[0]}`}>
                        <Text className={`font-sans-bold text-[10px] ${st.cls.split(" ")[1]}`}>{t(st.labelKey)}</Text>
                      </View>
                    </View>
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center" style={{ gap: 12 }}>
                        <View className="flex-row items-center" style={{ gap: 4 }}>
                          <Clock size={12} color={colors.mutedForeground} />
                          <Text className="font-sans text-muted-foreground text-[12px]">
                            {new Date(r.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                          </Text>
                        </View>
                        <View className="flex-row items-center" style={{ gap: 4 }}>
                          <Users size={12} color={colors.mutedForeground} />
                          <Text className="font-sans text-muted-foreground text-[12px]">{r.passengers ?? 0}</Text>
                        </View>
                      </View>
                      <Text className={`font-sans-bold text-sm ${r.status === "completed" ? "text-primary" : "text-muted-foreground"}`}>
                        {r.status === "completed" ? `+${formatCurrency(Math.round(r.price * 0.9))}` : formatCurrency(r.price)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
