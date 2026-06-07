import { View, Text } from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { colors } from "@/lib/theme";
import { useT } from "@/lib/i18n";

// On-brand placeholder for Phase 0 tab content. Real screens (Orders, Urgent,
// Chat, Profile) are ported in later phases; this keeps the shell navigable and
// visually consistent in the meantime.
export function PlaceholderScreen({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
}) {
  const { t } = useT();
  return (
    <View className="flex-1 bg-background items-center justify-center px-8">
      <View className="w-20 h-20 rounded-2xl bg-primary/[0.12] items-center justify-center mb-5">
        <Icon size={36} color={colors.primary} />
      </View>
      <Text className="font-display text-foreground text-xl text-center mb-2">{title}</Text>
      <Text className="font-sans text-muted-foreground text-sm text-center mb-6">{subtitle}</Text>
      <View className="px-3 py-1.5 rounded-full bg-secondary border border-border">
        <Text className="font-sans-medium text-muted-foreground text-[11px]">
          Phase 0 · {t("phase0_note")}
        </Text>
      </View>
    </View>
  );
}
