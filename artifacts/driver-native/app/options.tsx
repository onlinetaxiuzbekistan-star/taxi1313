import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, ScrollView, Switch, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft, Package } from "lucide-react-native";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { colors } from "@/lib/theme";
import { useT } from "@/lib/i18n";

type Opt = { key: string; label: string; enabled: boolean };

// Driver "Доп. опции" — toggle which dop-options the car supports. A disabled
// option means the driver still SEES orders needing it but cannot ACCEPT them
// (enforced server-side in /drivers/accept). Saved on each toggle.
export default function OptionsScreen() {
  const { t } = useT();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [opts, setOpts] = useState<Opt[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/drivers/options`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setOpts((await res.json()).options || []);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (next: Opt[]) => {
    const disabledOptions = next.filter((o) => !o.enabled).map((o) => o.key);
    try {
      await fetch(`${API_BASE_URL}/api/drivers/options`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ disabledOptions }),
      });
    } catch {}
  }, [token]);

  const toggle = (key: string, val: boolean) => {
    setOpts((prev) => {
      const next = prev.map((o) => (o.key === key ? { ...o, enabled: val } : o));
      save(next);
      return next;
    });
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-2 py-2" style={{ gap: 4 }}>
        <Pressable onPress={() => router.back()} className="w-10 h-10 items-center justify-center active:opacity-70">
          <ChevronLeft size={24} color={colors.foreground} />
        </Pressable>
        <Text className="font-display text-foreground text-xl">{t("options_title")}</Text>
      </View>

      <ScrollView contentContainerClassName="p-4">
        <Text className="font-sans text-muted-foreground text-[13px] mb-3">{t("options_hint")}</Text>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : opts.length === 0 ? (
          <Text className="text-center text-muted-foreground py-10">{t("options_empty")}</Text>
        ) : (
          <View className="bg-card border border-border rounded-2xl overflow-hidden">
            {opts.map((o, i) => (
              <View
                key={o.key}
                className={`flex-row items-center px-4 py-3.5 ${i > 0 ? "border-t border-border" : ""}`}
                style={{ gap: 12 }}
              >
                <View className="w-9 h-9 rounded-xl bg-secondary items-center justify-center">
                  <Package size={18} color={colors.primary} />
                </View>
                <Text className="flex-1 font-sans-bold text-foreground text-sm">{o.label}</Text>
                <Switch
                  value={o.enabled}
                  onValueChange={(v) => toggle(o.key, v)}
                  trackColor={{ true: colors.primary, false: "#d1d5db" }}
                  thumbColor="#ffffff"
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
