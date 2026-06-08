import { View, Text, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Briefcase, Zap, MessageCircle, User, type LucideIcon } from "lucide-react-native";

import { useT, type TKey } from "@/lib/i18n";
import { colors } from "@/lib/theme";
import { useUnread } from "@/features/chat/unread";

// Faithful native port of the bottom nav in web DriverLayout.tsx (lines ~666-731).
// Rendered as a custom tabBar for expo-router <Tabs>, so navigation is real while
// the look is fully controlled: 68px card bar, active tab gets a cyan-tinted icon
// chip + glow, red count badges.
const TABS: Record<string, { icon: LucideIcon; label: TKey }> = {
  index: { icon: Briefcase, label: "nav_orders" },
  urgent: { icon: Zap, label: "nav_urgent" },
  chat: { icon: MessageCircle, label: "nav_chat" },
  profile: { icon: User, label: "nav_profile" },
};
const ORDER = ["index", "urgent", "chat", "profile"];

export function DriverTabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  const { t } = useT();
  const { count: unread } = useUnread();

  // Keep our visual order regardless of route registration order.
  const routes = ORDER.map((name) => state.routes.find((r: any) => r.name === name)).filter(Boolean);

  return (
    <View
      className="bg-card border-t border-white/[0.06]"
      style={{ paddingBottom: Math.max(insets.bottom, 12) }}
    >
      <View className="flex-row justify-around items-center px-1" style={{ height: 68 }}>
        {routes.map((route: any) => {
          const cfg = TABS[route.name];
          if (!cfg) return null;
          const isActive = state.routes[state.index]?.key === route.key;
          const Icon = cfg.icon;
          const badge = route.name === "chat" ? unread : 0;

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!isActive && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              className="flex-1 h-full items-center justify-center rounded-lg"
              style={{ gap: 2 }}
            >
              <View
                className={`relative w-8 h-8 rounded-lg items-center justify-center ${
                  isActive ? "bg-primary/[0.12]" : ""
                }`}
                style={
                  isActive && Platform.OS !== "web"
                    ? {
                        shadowColor: colors.primary,
                        shadowOpacity: 0.4,
                        shadowRadius: 6,
                        shadowOffset: { width: 0, height: 0 },
                      }
                    : undefined
                }
              >
                <Icon size={20} color={isActive ? colors.primary : colors.mutedForeground} />
                {badge > 0 && (
                  <View
                    className="absolute bg-red-500 rounded-full items-center justify-center px-0.5"
                    style={{ top: -4, right: -4, minWidth: 16, height: 16 }}
                  >
                    <Text className="text-white text-[9px] font-sans-bold">
                      {badge > 9 ? "9+" : badge}
                    </Text>
                  </View>
                )}
              </View>
              <Text
                className={`text-[10px] font-sans-semibold ${
                  isActive ? "text-primary" : "text-muted-foreground/70"
                }`}
              >
                {t(cfg.label)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
