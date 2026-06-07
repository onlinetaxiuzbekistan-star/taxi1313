import { View, Text, Pressable, ScrollView } from "react-native";
import { CheckCircle } from "lucide-react-native";

import { colors } from "@/lib/theme";
import { formatCurrency, formatRoutePoint } from "../utils";
import type { Ride } from "../types";
import { ConfettiOverlay } from "./ConfettiOverlay";

// Ported from web orders/components/CompletionScreen.tsx (with confetti).
export function CompletionScreen({
  ride,
  onClose,
  commissionRate = 0.15,
}: {
  ride: Ride;
  onClose: () => void;
  commissionRate?: number;
}) {
  const seatPassengers = ride.seatPassengers || [];
  const seatSum = seatPassengers.reduce((s, p) => s + (p.price || 0), 0);
  const totalEarnings = ride.price && ride.price > 0 ? ride.price : seatSum;
  const commission = Math.round(totalEarnings * commissionRate);
  const driverIncome = totalEarnings - commission;

  return (
    <View className="flex-1 bg-background">
      <ConfettiOverlay />
      <View className="bg-zinc-900 pt-10 pb-8 px-6 items-center">
        <View className="w-20 h-20 rounded-full bg-white/20 items-center justify-center mb-4">
          <CheckCircle size={40} color="#fff" />
        </View>
        <Text className="font-display text-white text-xl">Рейс завершён!</Text>
        <Text className="font-sans text-zinc-300 text-sm mt-1">
          {formatRoutePoint(ride.fromDistrictName, ride.fromCity)} → {formatRoutePoint(ride.toDistrictName, ride.toCity)}
        </Text>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="px-5 pt-3 pb-4">
        <View className="bg-card rounded-2xl border border-border p-5 mb-4" style={{ gap: 12 }}>
          <Row label="Стоимость рейса" value={formatCurrency(totalEarnings)} />
          <Row label={`Комиссия (${Math.round(commissionRate * 100)}%)`} value={`−${formatCurrency(commission)}`} valueClass="text-red-500" />
          <View className="h-px bg-border" />
          <View className="flex-row items-center justify-between">
            <Text className="font-sans-bold text-foreground text-base">Ваш доход</Text>
            <Text className="font-display text-foreground text-xl">{formatCurrency(driverIncome)}</Text>
          </View>
        </View>

        <View className="bg-card rounded-2xl border border-border p-4 mb-4">
          <Text className="font-sans-bold text-muted-foreground text-[12px] uppercase mb-3" style={{ letterSpacing: 0.5 }}>
            Детали рейса
          </Text>
          <View className="flex-row">
            <Stat value={String(ride.distance ?? "—")} label="км" />
            <Stat value={String(ride.duration ?? "—")} label="минут" />
            <Stat value={String(seatPassengers.length)} label="пассажиров" />
          </View>
        </View>

        {seatPassengers.length > 0 && (
          <View className="bg-card rounded-2xl border border-border p-4">
            <Text className="font-sans-bold text-muted-foreground text-[12px] uppercase mb-3" style={{ letterSpacing: 0.5 }}>
              Пассажиры
            </Text>
            <View style={{ gap: 8 }}>
              {seatPassengers.map((p) => (
                <View key={p.id} className="flex-row items-center" style={{ gap: 12 }}>
                  <View className="w-8 h-8 rounded-full bg-secondary items-center justify-center">
                    <Text className="font-sans-bold text-foreground text-xs">{p.seatNumber}</Text>
                  </View>
                  <Text className="font-sans-medium text-foreground text-sm flex-1" numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text className="font-sans-semibold text-foreground text-sm">{formatCurrency(p.price)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <View className="px-5 pb-6 pt-2">
        <Pressable onPress={onClose} className="h-14 rounded-2xl bg-primary items-center justify-center active:opacity-90">
          <Text className="font-sans-bold text-primary-foreground text-base">Готово</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Row({ label, value, valueClass = "text-foreground" }: { label: string; value: string; valueClass?: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="font-sans text-muted-foreground text-sm">{label}</Text>
      <Text className={`font-sans-bold text-base ${valueClass}`}>{value}</Text>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View className="flex-1 items-center">
      <Text className="font-sans-bold text-foreground text-lg">{value}</Text>
      <Text className="font-sans text-muted-foreground text-[12px]">{label}</Text>
    </View>
  );
}
