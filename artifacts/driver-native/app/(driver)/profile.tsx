import { View, Text, Pressable, ScrollView } from "react-native";
import { User, Star, Car } from "lucide-react-native";

import { useAuth } from "@/hooks/use-auth";
import { useSettingsStore, type Language } from "@/stores/settings";
import { useT } from "@/lib/i18n";
import { getCallsign, DEMO_DRIVER } from "@/lib/driver";
import { PREVIEW_MODE } from "@/config";
import { colors } from "@/lib/theme";

export default function ProfileScreen() {
  const { user } = useAuth();
  const { t } = useT();
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);

  const driver = user ?? (PREVIEW_MODE ? DEMO_DRIVER : null);
  if (!driver) return null;

  const langs: { code: Language; label: string }[] = [
    { code: "ru", label: "Русский" },
    { code: "uz", label: "Oʻzbekcha" },
  ];

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="p-4">
      {/* identity card */}
      <View className="bg-card border border-border rounded-2xl p-5 items-center mb-4">
        <View className="w-20 h-20 rounded-full bg-primary/15 items-center justify-center mb-3">
          <User size={40} color={colors.primary} />
        </View>
        <Text className="font-display text-foreground text-xl mb-0.5">{driver.name}</Text>
        <Text className="font-mono text-primary text-sm" style={{ fontWeight: "700" }}>
          {getCallsign(driver)}
        </Text>

        <View className="flex-row items-center mt-4" style={{ gap: 16 }}>
          <View className="flex-row items-center" style={{ gap: 5 }}>
            <Car size={15} color={colors.mutedForeground} />
            <Text className="font-sans text-muted-foreground text-[13px]">
              {driver.carModel ?? "—"}
            </Text>
          </View>
          <View className="flex-row items-center" style={{ gap: 5 }}>
            <Star size={15} color={colors.amber} fill={colors.amber} />
            <Text className="font-sans-semibold text-foreground text-[13px]">
              {driver.rating ?? "—"}
            </Text>
          </View>
        </View>
      </View>

      {/* language switch — demonstrates ported i18n (ru/uz) */}
      <View className="bg-card border border-border rounded-2xl p-4 mb-4">
        <Text className="font-sans-semibold text-muted-foreground text-[12px] uppercase mb-3" style={{ letterSpacing: 0.5 }}>
          {t("language")}
        </Text>
        <View className="flex-row" style={{ gap: 10 }}>
          {langs.map((l) => {
            const active = language === l.code;
            return (
              <Pressable
                key={l.code}
                onPress={() => setLanguage(l.code)}
                className={`flex-1 py-3 rounded-xl border items-center active:opacity-80 ${
                  active ? "bg-primary border-primary" : "bg-secondary border-border"
                }`}
              >
                <Text
                  className={`font-sans-semibold text-sm ${
                    active ? "text-primary-foreground" : "text-foreground"
                  }`}
                >
                  {l.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Text className="font-sans text-muted-foreground text-[12px] text-center">
        {t("phase0_note")}
      </Text>
    </ScrollView>
  );
}
