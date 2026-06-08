import { View, Text, Pressable } from "react-native";
import { CheckCircle, User } from "lucide-react-native";

import { colors } from "@/lib/theme";
import { useT, type TKey } from "@/lib/i18n";
import type { SeatPassenger } from "../types";

// RN adaptation of web CarSeatLayout: card-based seat map (front row = seat 1,
// back row = 2..N), colored by passenger status, tappable, with a legend.
function seatColors(p?: SeatPassenger) {
  if (!p) return { bg: colors.secondary, border: colors.border, fg: colors.mutedForeground, labelKey: "st_free" as TKey, labelColor: colors.mutedForeground };
  if (p.status === "dropped_off") return { bg: "#3f3f46", border: "#52525b", fg: "#a1a1aa", labelKey: "st_dropped" as TKey, labelColor: "#a1a1aa" };
  const female = p.gender === "female";
  if (p.status === "picked_up")
    return { bg: female ? "#ec4899" : "#3b82f6", border: female ? "#db2777" : "#2563eb", fg: "#fff", labelKey: "st_in_car" as TKey, labelColor: "#34d399" };
  return { bg: female ? "#9d2463" : "#1e40af", border: female ? "#db2777" : "#2563eb", fg: "#fff", labelKey: "st_waiting" as TKey, labelColor: "#fbbf24" };
}

function SeatCard({
  n,
  p,
  selected,
  onPress,
  width,
}: {
  n: number;
  p?: SeatPassenger;
  selected: boolean;
  onPress: () => void;
  width: string | number;
}) {
  const { t } = useT();
  const c = seatColors(p);
  return (
    <Pressable
      onPress={onPress}
      style={{ width: width as any, borderColor: selected ? colors.primary : c.border, backgroundColor: c.bg }}
      className="rounded-2xl border-2 px-2 py-3 items-center active:opacity-90"
    >
      <View className="w-10 h-10 rounded-full bg-white/90 items-center justify-center mb-1.5">
        {p ? (
          <User size={22} color={c.bg} />
        ) : (
          <Text className="font-sans-bold text-lg" style={{ color: colors.mutedForeground }}>
            {n}
          </Text>
        )}
      </View>
      <Text className="font-sans-bold text-[12px]" style={{ color: c.fg }} numberOfLines={1}>
        {p ? (p.name || "").split(" ")[0] : "—"}
      </Text>
      <Text className="font-sans-bold text-[8px] uppercase mt-0.5" style={{ color: c.labelColor, letterSpacing: 0.5 }}>
        {t(c.labelKey)}
      </Text>
      {p?.status === "picked_up" && (
        <View className="absolute top-1.5 right-1.5">
          <CheckCircle size={14} color="#10b981" />
        </View>
      )}
      {p && (
        <View className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-zinc-900 items-center justify-center">
          <Text className="font-sans-bold text-white text-[10px]">{n}</Text>
        </View>
      )}
    </Pressable>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <View className="flex-row items-center my-2" style={{ gap: 8 }}>
      <View className="flex-1 h-px bg-border" />
      <Text className="font-sans-bold text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: 1 }}>
        {label}
      </Text>
      <View className="flex-1 h-px bg-border" />
    </View>
  );
}

export function CarSeatLayout({
  passengers,
  onSeatClick,
  selectedSeat,
  totalSeats = 4,
}: {
  passengers: SeatPassenger[];
  onSeatClick: (n: number) => void;
  selectedSeat: number | null;
  totalSeats?: number;
}) {
  const { t } = useT();
  const get = (n: number) => passengers.find((p) => p.seatNumber === n);
  const backSeats = Array.from({ length: Math.max(0, totalSeats - 1) }, (_, i) => i + 2);

  return (
    <View className="bg-card rounded-2xl border border-border px-3 py-2">
      <Divider label={t("front_row")} />
      <View className="items-center">
        <SeatCard n={1} p={get(1)} selected={selectedSeat === 1} onPress={() => onSeatClick(1)} width="46%" />
      </View>

      <Divider label={t("back_row")} />
      <View className="flex-row justify-between">
        {backSeats.map((n) => (
          <SeatCard
            key={n}
            n={n}
            p={get(n)}
            selected={selectedSeat === n}
            onPress={() => onSeatClick(n)}
            width={`${Math.floor(96 / backSeats.length)}%`}
          />
        ))}
      </View>

      <View className="flex-row items-center justify-center mt-2 pt-1.5 border-t border-border" style={{ gap: 14 }}>
        {[
          { c: "#1e40af", key: "st_waiting" as TKey },
          { c: "#3b82f6", key: "st_in_car" as TKey },
          { c: "#52525b", key: "st_dropped" as TKey },
        ].map((l) => (
          <View key={l.key} className="flex-row items-center" style={{ gap: 5 }}>
            <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.c }} />
            <Text className="font-sans-bold text-[9px] uppercase text-muted-foreground">{t(l.key)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
