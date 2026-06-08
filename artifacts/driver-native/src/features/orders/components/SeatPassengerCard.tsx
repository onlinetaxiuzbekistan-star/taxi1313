import { View, Text, Pressable, Linking, ActivityIndicator } from "react-native";
import { User, X, Phone, UserX } from "lucide-react-native";

import { colors } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "../utils";
import type { SeatPassenger } from "../types";

// Details card shown when the driver taps an OCCUPIED seat: passenger info +
// call + "снять клиента" (reject). Mirrors web SeatPassengerCard.
export function SeatPassengerCard({
  passenger,
  onClose,
  onReject,
  loading,
}: {
  passenger: SeatPassenger;
  onClose: () => void;
  onReject?: (id: number) => void;
  loading?: boolean;
}) {
  const { t } = useT();
  const female = passenger.gender === "female";
  const statusLabel =
    passenger.status === "picked_up" ? t("st_in_car") : passenger.status === "dropped_off" ? t("st_dropped") : t("st_waiting");

  return (
    <View className="bg-card rounded-2xl border border-border overflow-hidden">
      <View className="bg-zinc-900 px-3 py-2.5 flex-row items-center justify-between">
        <Text className="font-sans-bold text-white text-sm">{t("seat")} {passenger.seatNumber}</Text>
        <Pressable onPress={onClose} className="w-7 h-7 rounded-lg bg-white/15 items-center justify-center active:opacity-80">
          <X size={14} color="#fff" />
        </Pressable>
      </View>
      <View className="p-3" style={{ gap: 10 }}>
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <View className={`w-10 h-10 rounded-full items-center justify-center ${female ? "bg-pink-500/20" : "bg-blue-500/20"}`}>
            <User size={20} color={female ? "#ec4899" : "#3b82f6"} />
          </View>
          <View className="flex-1">
            <Text className="font-sans-bold text-foreground text-sm" numberOfLines={1}>
              {passenger.name || t("passenger")}
            </Text>
            <Text className="font-sans text-muted-foreground text-[12px]">
              {statusLabel} • {formatCurrency(passenger.price)}
            </Text>
          </View>
          {passenger.phone ? (
            <Pressable
              onPress={() => Linking.openURL(`tel:${passenger.phone}`)}
              className="w-9 h-9 rounded-xl bg-secondary items-center justify-center active:opacity-80"
            >
              <Phone size={16} color={colors.foreground} />
            </Pressable>
          ) : null}
        </View>

        {onReject && passenger.status !== "dropped_off" ? (
          <Pressable
            onPress={() => onReject(passenger.id)}
            disabled={loading}
            className="py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 flex-row items-center justify-center active:opacity-80"
            style={{ gap: 6, opacity: loading ? 0.5 : 1 }}
          >
            {loading ? <ActivityIndicator size="small" color={colors.red} /> : <UserX size={16} color={colors.red} />}
            <Text className="font-sans-bold text-red-500 text-sm">{t("remove_client")}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
