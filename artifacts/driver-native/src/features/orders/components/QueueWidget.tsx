import { View, Text } from "react-native";
import { Users, Zap, TrendingUp } from "lucide-react-native";

import { colors } from "@/lib/theme";
import type { QueueInfoData } from "../types";

// Ported from web orders/components/QueueWidget.tsx (without the audio cue).
export function QueueWidget({ queueInfo }: { queueInfo: QueueInfoData | null }) {
  if (!queueInfo) return null;
  const pos = queueInfo.position ?? 0;
  const total = queueInfo.total ?? queueInfo.totalInQueue ?? 0;
  if (total <= 0) return null;
  const avgMin = queueInfo.avgWaitMinutes ?? queueInfo.estimatedWaitMinutes ?? 0;
  const progressPct = total > 1 ? Math.round(((total - pos) / (total - 1)) * 100) : pos === 1 ? 100 : 0;
  const isFirst = pos === 1;

  return (
    <View className={`rounded-2xl border p-4 ${isFirst ? "bg-muted border-border" : "bg-card border-border"}`}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center" style={{ gap: 8 }}>
          {isFirst ? <Zap size={16} color={colors.primary} /> : <Users size={16} color={colors.primary} />}
          <Text className="font-sans-bold text-foreground text-sm">
            {isFirst ? "Вы первый в очереди!" : `Очередь: ${pos} из ${total}`}
          </Text>
        </View>
        {!isFirst && avgMin > 0 && (
          <View className="rounded-full bg-muted px-2 py-0.5">
            <Text className="font-sans-semibold text-muted-foreground text-[13px]">~{avgMin} мин</Text>
          </View>
        )}
      </View>

      {!isFirst && (
        <View className="mt-3" style={{ gap: 6 }}>
          <View className="flex-row items-center justify-between">
            <Text className="font-sans text-muted-foreground text-[13px]">Прогресс очереди</Text>
            <Text className="font-sans-bold text-foreground text-[13px]">{progressPct}%</Text>
          </View>
          <View className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <View className="h-full bg-primary rounded-full" style={{ width: `${progressPct}%` }} />
          </View>
        </View>
      )}

      {isFirst && (
        <View className="flex-row items-center mt-2" style={{ gap: 8 }}>
          <TrendingUp size={14} color={colors.primary} />
          <Text className="font-sans-medium text-primary text-xs flex-1">
            Следующий заказ — ваш. Диспетчер видит вас первым.
          </Text>
        </View>
      )}
    </View>
  );
}
