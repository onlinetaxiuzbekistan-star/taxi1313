import { useState, useEffect, useMemo, useCallback } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft, MapPin, Clock, Users, TrendingUp, CalendarDays, X, Car } from "lucide-react-native";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { colors } from "@/lib/theme";
import { Calendar } from "@/components/Calendar";
import { formatCurrency, formatRoutePoint } from "@/features/orders/utils";
import { useT, type TKey } from "@/lib/i18n";

function tariffLabel(cc?: string | null): string {
  if (cc === "comfort") return "Comfort";
  if (cc === "business") return "Бизнес";
  return "Стандарт";
}
function timeOf(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
function dayOf(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

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
  carClass?: string | null;
  distance?: number | string | null;
  commission?: number | null;
  driverPayout?: number | null;
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
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [detail, setDetail] = useState<RideRow | null>(null);

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
    if (selectedDate) {
      const y = selectedDate.getFullYear(), m = selectedDate.getMonth(), d = selectedDate.getDate();
      return rides.filter((r) => {
        const c = new Date(r.createdAt);
        return c.getFullYear() === y && c.getMonth() === m && c.getDate() === d;
      });
    }
    if (filter === "all") return rides;
    // "Сегодня" = the CALENDAR day (from midnight), not a rolling 24h window —
    // otherwise yesterday-evening rides leak into Today.
    if (filter === "today") {
      const t0 = new Date(); t0.setHours(0, 0, 0, 0);
      return rides.filter((r) => new Date(r.createdAt).getTime() >= t0.getTime());
    }
    const cut = filter === "week" ? 7 : 30;
    const since = Date.now() - cut * 24 * 3600 * 1000;
    return rides.filter((r) => new Date(r.createdAt).getTime() >= since);
  }, [rides, filter, selectedDate]);

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

          {/* filter + calendar */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-4 py-3" style={{ flexGrow: 0 }}>
            <View className="flex-row" style={{ gap: 8 }}>
              <Pressable
                onPress={() => setCalendarOpen(true)}
                className={`px-3 py-1.5 rounded-full border flex-row items-center ${selectedDate ? "bg-primary border-primary" : "bg-card border-border"}`}
                style={{ gap: 5 }}
              >
                <CalendarDays size={14} color={selectedDate ? colors.primaryForeground : colors.foreground} />
                <Text className={`font-sans-semibold text-[13px] ${selectedDate ? "text-primary-foreground" : "text-foreground"}`}>
                  {selectedDate ? dayOf(selectedDate.toISOString()) : t("earn_pick_date")}
                </Text>
              </Pressable>
              {selectedDate ? (
                <Pressable onPress={() => setSelectedDate(null)} className="px-3 py-1.5 rounded-full border bg-card border-border flex-row items-center" style={{ gap: 5 }}>
                  <X size={13} color={colors.foreground} />
                  <Text className="font-sans-semibold text-[13px] text-foreground">{t("earn_all_dates")}</Text>
                </Pressable>
              ) : (
                (["all", "today", "week", "month"] as const).map((f) => {
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
                })
              )}
            </View>
          </ScrollView>

          {/* rides — full info, tap for detail */}
          {filteredRides.length === 0 ? (
            <Text className="font-sans text-muted-foreground text-sm text-center mt-6">{t("no_rides")}</Text>
          ) : (
            <View className="px-4" style={{ gap: 8 }}>
              {filteredRides.map((r) => {
                const st = STATUS[r.status] || STATUS.pending;
                return (
                  <Pressable key={r.id} onPress={() => setDetail(r)} className="bg-card border border-border rounded-2xl p-4 active:opacity-80">
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
                      <View className="flex-row items-center flex-wrap" style={{ gap: 10 }}>
                        <Row icon={<Clock size={12} color={colors.mutedForeground} />} text={`${dayOf(r.createdAt)}, ${timeOf(r.createdAt)}`} />
                        <Row icon={<Users size={12} color={colors.mutedForeground} />} text={String(r.passengers ?? 0)} />
                        <Row icon={<Car size={12} color={colors.mutedForeground} />} text={tariffLabel(r.carClass)} />
                      </View>
                      <Text className={`font-sans-bold text-sm ${r.status === "completed" ? "text-primary" : "text-muted-foreground"}`}>
                        {r.status === "completed" ? `+${formatCurrency(Math.round(r.driverPayout ?? r.price * 0.9))}` : formatCurrency(r.price)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      {/* Calendar picker */}
      <Modal visible={calendarOpen} transparent animationType="fade" onRequestClose={() => setCalendarOpen(false)}>
        <Pressable className="flex-1 bg-black/60 items-center justify-center px-6" onPress={() => setCalendarOpen(false)}>
          <Pressable className="w-full" onPress={() => {}}>
            <Calendar
              value={selectedDate}
              onSelect={(d) => {
                setSelectedDate(d);
                setCalendarOpen(false);
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Trip detail */}
      <Modal visible={!!detail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-card rounded-t-3xl border-t border-border p-5" style={{ gap: 4, paddingBottom: insets.bottom + 16 }}>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="font-display text-foreground text-lg">{t("trip_detail")}</Text>
              <Pressable onPress={() => setDetail(null)} className="w-8 h-8 rounded-full bg-secondary items-center justify-center active:opacity-80">
                <X size={16} color={colors.foreground} />
              </Pressable>
            </View>
            {detail ? (
              <>
                <DetailRow label={t("f_route")} value={`${formatRoutePoint(detail.fromDistrictName, detail.fromCity)} → ${formatRoutePoint(detail.toDistrictName, detail.toCity)}`} />
                <DetailRow label={t("f_date")} value={dayOf(detail.createdAt)} />
                <DetailRow label={t("f_time")} value={timeOf(detail.createdAt)} />
                <DetailRow label={t("f_tariff")} value={tariffLabel(detail.carClass)} />
                <DetailRow label={t("f_passengers")} value={String(detail.passengers ?? 0)} />
                {detail.distance != null ? <DetailRow label={t("unit_km")} value={String(detail.distance)} /> : null}
                <DetailRow label={t("f_status")} value={t((STATUS[detail.status] || STATUS.pending).labelKey)} />
                <View className="h-px bg-border my-2" />
                <DetailRow label={t("f_price")} value={formatCurrency(detail.price)} />
                {detail.commission != null ? <DetailRow label={t("f_commission")} value={`− ${formatCurrency(detail.commission)}`} /> : null}
                <DetailRow
                  label={t("f_income")}
                  value={`+ ${formatCurrency(Math.round(detail.driverPayout ?? detail.price * 0.9))}`}
                  strong
                />
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Row({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View className="flex-row items-center" style={{ gap: 4 }}>
      {icon}
      <Text className="font-sans text-muted-foreground text-[12px]">{text}</Text>
    </View>
  );
}

function DetailRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <Text className="font-sans text-muted-foreground text-[13px]">{label}</Text>
      <Text className={`text-[14px] ${strong ? "font-display text-emerald-400" : "font-sans-semibold text-foreground"}`} numberOfLines={1} style={{ maxWidth: "62%" }}>
        {value}
      </Text>
    </View>
  );
}
