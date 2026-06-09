import { View, Text, Pressable, ScrollView, Switch } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft, Type, Moon, Sun, Volume2, Languages } from "lucide-react-native";

import { useSettingsStore, type FontSize, type Language } from "@/stores/settings";
import { useT } from "@/lib/i18n";
import { colors } from "@/lib/theme";

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useT();

  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const soundsEnabled = useSettingsStore((s) => s.soundsEnabled);
  const setSoundsEnabled = useSettingsStore((s) => s.setSoundsEnabled);

  const fonts: { key: FontSize; label: string }[] = [
    { key: "small", label: t("font_small") },
    { key: "medium", label: t("font_medium") },
    { key: "large", label: t("font_large") },
  ];
  const langs: { code: Language; label: string }[] = [
    { code: "ru", label: t("lang_ru") },
    { code: "uz", label: "Oʻzbekcha" },
  ];

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-2 py-2" style={{ gap: 4 }}>
        <Pressable onPress={() => router.back()} className="w-10 h-10 items-center justify-center active:opacity-70">
          <ChevronLeft size={24} color={colors.foreground} />
        </Pressable>
        <Text className="font-display text-foreground text-lg">{t("settings_title")}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}>
        {/* Language */}
        <Section icon={<Languages size={16} color={colors.primary} />} title={t("language")}>
          <View className="flex-row" style={{ gap: 10 }}>
            {langs.map((l) => {
              const active = language === l.code;
              return (
                <Pressable
                  key={l.code}
                  onPress={() => setLanguage(l.code)}
                  className={`flex-1 py-3 rounded-xl border items-center active:opacity-80 ${active ? "bg-primary border-primary" : "bg-secondary border-border"}`}
                >
                  <Text className={`font-sans-semibold text-sm ${active ? "text-primary-foreground" : "text-foreground"}`}>{l.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        {/* Font size */}
        <Section icon={<Type size={16} color={colors.primary} />} title={t("font_size")}>
          <View className="flex-row" style={{ gap: 10 }}>
            {fonts.map((f) => {
              const active = fontSize === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setFontSize(f.key)}
                  className={`flex-1 py-3 rounded-xl border items-center active:opacity-80 ${active ? "bg-primary border-primary" : "bg-secondary border-border"}`}
                >
                  <Text className={`font-sans-semibold text-sm ${active ? "text-primary-foreground" : "text-foreground"}`}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text className="font-sans text-muted-foreground text-base mt-3">{t("font_preview")} — 1234</Text>
        </Section>

        {/* Theme */}
        <Section icon={theme === "light" ? <Sun size={16} color={colors.primary} /> : <Moon size={16} color={colors.primary} />} title={t("theme_label")}>
          <View className="flex-row" style={{ gap: 10 }}>
            {([["dark", t("theme_dark"), Moon], ["light", t("theme_light"), Sun]] as const).map(([val, label, Icon]) => {
              const active = theme === val;
              return (
                <Pressable
                  key={val}
                  onPress={() => setTheme(val as any)}
                  className={`flex-1 py-3 rounded-xl border flex-row items-center justify-center active:opacity-80 ${active ? "bg-primary border-primary" : "bg-secondary border-border"}`}
                  style={{ gap: 6 }}
                >
                  <Icon size={16} color={active ? colors.primaryForeground : colors.foreground} />
                  <Text className={`font-sans-semibold text-sm ${active ? "text-primary-foreground" : "text-foreground"}`}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        {/* Sounds */}
        <Section icon={<Volume2 size={16} color={colors.primary} />} title={t("sounds_label")}>
          <View className="flex-row items-center justify-between">
            <Text className="font-sans text-foreground text-sm">{soundsEnabled ? t("on") : t("off")}</Text>
            <Switch
              value={soundsEnabled}
              onValueChange={setSoundsEnabled}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor={colors.white}
            />
          </View>
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <View className="bg-card border border-border rounded-2xl p-4">
      <View className="flex-row items-center mb-3" style={{ gap: 8 }}>
        {icon}
        <Text className="font-sans-semibold text-muted-foreground text-[12px] uppercase" style={{ letterSpacing: 0.5 }}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}
