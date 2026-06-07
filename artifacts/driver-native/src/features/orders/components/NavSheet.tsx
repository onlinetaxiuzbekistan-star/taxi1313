import { Modal, View, Text, Pressable, Linking } from "react-native";
import { Navigation, X } from "lucide-react-native";

import { colors } from "@/lib/theme";
import { navDeepLinks } from "../utils";

async function openApp(primary: string, fallback: string) {
  try {
    const ok = await Linking.canOpenURL(primary).catch(() => false);
    await Linking.openURL(ok ? primary : fallback);
  } catch {
    try {
      await Linking.openURL(fallback);
    } catch {}
  }
}

// Navigation hand-off chooser: Yandex Navi / Google Maps / 2GIS via deep links,
// with web fallbacks when the app isn't installed.
export function NavSheet({
  visible,
  toLat,
  toLng,
  onClose,
}: {
  visible: boolean;
  toLat?: number;
  toLng?: number;
  onClose: () => void;
}) {
  if (toLat == null || toLng == null) return null;
  const links = navDeepLinks(toLat, toLng);

  const apps: { key: string; label: string; color: string; onPress: () => void }[] = [
    { key: "yandex", label: "Яндекс Навигатор", color: "#ffcc00", onPress: () => openApp(links.yandex, `https://yandex.ru/maps/?rtext=~${toLat},${toLng}`) },
    { key: "google", label: "Google Maps", color: "#34a853", onPress: () => openApp(links.google, links.web) },
    { key: "dgis", label: "2GIS", color: "#41ad49", onPress: () => openApp(links.dgis, `https://2gis.ru/routeSearch/rsType/car/to/${toLng},${toLat}`) },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/60 justify-end" onPress={onClose}>
        <Pressable className="bg-card rounded-t-3xl border-t border-border px-5 pt-4 pb-8" onPress={() => {}}>
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Navigation size={18} color={colors.primary} />
              <Text className="font-display text-foreground text-base">Открыть в навигаторе</Text>
            </View>
            <Pressable onPress={onClose} className="w-8 h-8 rounded-full bg-secondary items-center justify-center">
              <X size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <View style={{ gap: 10 }}>
            {apps.map((a) => (
              <Pressable
                key={a.key}
                onPress={() => {
                  a.onPress();
                  onClose();
                }}
                className="flex-row items-center bg-secondary rounded-2xl px-4 py-4 active:opacity-80"
                style={{ gap: 12 }}
              >
                <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: a.color }}>
                  <Navigation size={16} color="#fff" />
                </View>
                <Text className="font-sans-bold text-foreground text-base">{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
