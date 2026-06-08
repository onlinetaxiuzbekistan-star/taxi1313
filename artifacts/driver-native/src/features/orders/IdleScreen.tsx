import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { Car } from "lucide-react-native";

import { colors } from "@/lib/theme";
import { useT } from "@/lib/i18n";

// Ported from web orders/components/IdleScreen.tsx.
export function IdleScreen({
  isOnline,
  loading,
  onGoOnline,
}: {
  isOnline: boolean;
  loading?: boolean;
  onGoOnline: () => void;
}) {
  const { t } = useT();
  if (!isOnline) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-6">
        <View className="w-24 h-24 rounded-full bg-muted items-center justify-center mb-5">
          <Car size={40} color={colors.mutedForeground} />
        </View>
        <Text className="font-sans-bold text-foreground text-lg mb-2 text-center">{t("idle_offline")}</Text>
        <Text className="font-sans text-muted-foreground text-sm text-center mb-6">
          {t("idle_offline_sub")}
        </Text>
        <Pressable
          onPress={onGoOnline}
          disabled={loading}
          className="px-8 py-3.5 bg-amber-500 rounded-2xl active:opacity-90"
        >
          {loading ? (
            <ActivityIndicator color="#18181b" />
          ) : (
            <Text className="font-sans-bold text-zinc-900 text-base">{t("go_online")}</Text>
          )}
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background items-center justify-center px-6">
      <View className="w-20 h-20 rounded-full bg-primary/10 items-center justify-center mb-4">
        <Car size={36} color={colors.primary} />
      </View>
      <Text className="font-sans-bold text-foreground text-lg mb-1 text-center">{t("idle_online")}</Text>
      <Text className="font-sans text-muted-foreground text-sm text-center">
        {t("idle_online_sub")}
      </Text>
    </View>
  );
}
