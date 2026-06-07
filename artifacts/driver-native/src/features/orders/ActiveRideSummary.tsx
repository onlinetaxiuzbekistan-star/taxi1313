import { View, Text, ScrollView } from "react-native";
import { Navigation, MapPin, Users } from "lucide-react-native";

import { colors } from "@/lib/theme";
import type { Ride, SeatPassenger } from "./types";

const STATUS_LABEL: Record<string, string> = {
  pending: "Ожидание",
  offered: "Предложен",
  accepted: "Принят — сбор пассажиров",
  in_progress: "В пути",
  completed: "Завершён",
};

// CP1 interim view for an active ride. The full pickup / in-progress / seat-view
// management screens (with map + per-passenger actions) land in CP3.
export function ActiveRideSummary({ ride, passengers }: { ride: Ride; passengers: SeatPassenger[] }) {
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="p-4">
      <View className="bg-card border border-border rounded-2xl p-5 mb-4">
        <View className="flex-row items-center mb-4" style={{ gap: 10 }}>
          <View className="items-center" style={{ gap: 2 }}>
            <View className="w-3.5 h-3.5 rounded-full bg-foreground items-center justify-center">
              <Navigation size={9} color={colors.background} />
            </View>
            <View style={{ width: 1, height: 22, backgroundColor: colors.border }} />
            <View className="w-3.5 h-3.5 rounded-full bg-red-500" />
          </View>
          <View className="flex-1">
            <Text className="font-sans text-muted-foreground text-xs">Откуда</Text>
            <Text className="font-display text-foreground text-lg">{ride.fromCity}</Text>
            <View className="h-2" />
            <Text className="font-sans text-muted-foreground text-xs">Куда</Text>
            <Text className="font-display text-foreground text-lg">{ride.toCity}</Text>
          </View>
        </View>

        <View className="flex-row items-center self-start rounded-full bg-primary/15 px-3 py-1">
          <Text className="font-sans-semibold text-primary text-[12px]">
            {STATUS_LABEL[ride.status] || ride.status}
          </Text>
        </View>
      </View>

      <View className="flex-row" style={{ gap: 12 }}>
        <View className="flex-1 bg-card border border-border rounded-2xl p-4 items-center">
          <Users size={20} color={colors.primary} />
          <Text className="font-display text-foreground text-xl mt-1">
            {ride.occupiedSeats ?? passengers.length}/{ride.totalSeats ?? 4}
          </Text>
          <Text className="font-sans text-muted-foreground text-[12px]">мест занято</Text>
        </View>
        <View className="flex-1 bg-card border border-border rounded-2xl p-4 items-center">
          <MapPin size={20} color={colors.primary} />
          <Text className="font-display text-foreground text-xl mt-1">{passengers.length}</Text>
          <Text className="font-sans text-muted-foreground text-[12px]">пассажиров</Text>
        </View>
      </View>

      <View className="mt-5 items-center">
        <View className="px-3 py-1.5 rounded-full bg-secondary border border-border">
          <Text className="font-sans-medium text-muted-foreground text-[11px]">
            Управление рейсом (посадка, карта, завершение) — в следующем чекпоинте
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
