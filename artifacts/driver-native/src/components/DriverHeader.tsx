import { View, Text, Pressable, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { User, Wallet, Power, LogOut, Loader2 } from "lucide-react-native";

import type { DriverUser } from "@/types";
import { getCallsign, getPhotoUrl } from "@/lib/driver";
import { useT } from "@/lib/i18n";
import { colors } from "@/lib/theme";

// Faithful native port of the header in web DriverLayout.tsx (lines ~437-497):
//   [callsign pill] [balance pill]            [online/offline toggle] [exit]
// Same dark card surface, sizes, and colors.
export function DriverHeader({
  user,
  toggling,
  onToggleStatus,
  onExit,
}: {
  user: DriverUser;
  toggling?: boolean;
  onToggleStatus?: () => void;
  onExit?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useT();
  const router = useRouter();

  const callsign = getCallsign(user);
  const photo = getPhotoUrl(user.driverPhoto);
  const bal = Number(user.balance || 0);
  const neg = bal < 0;
  const isOnline = user.status === "online" || user.status === "busy";
  const isBusy = user.status === "busy";

  const statusBg = isBusy ? "bg-amber-500" : isOnline ? "bg-emerald-500" : "bg-red-500";
  const statusBorder = isBusy
    ? "border-amber-600"
    : isOnline
      ? "border-emerald-600"
      : "border-red-600";
  const statusLabel = isBusy ? t("status_busy") : isOnline ? t("status_online") : t("status_offline");

  return (
    <View
      className="bg-card border-b border-white/[0.06]"
      style={{ paddingTop: insets.top }}
    >
      <View className="h-14 flex-row items-center justify-between px-3" style={{ gap: 10 }}>
        {/* left: callsign + balance */}
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <Pressable
            className="flex-row items-center bg-white/[0.06] px-2 py-1 rounded-lg active:opacity-80"
            style={{ gap: 6 }}
          >
            {photo ? (
              <Image
                source={{ uri: photo }}
                className="w-5 h-5 rounded-full border border-white/10"
              />
            ) : (
              <View className="w-5 h-5 rounded-full bg-primary/15 items-center justify-center">
                <User size={12} color={colors.primary} />
              </View>
            )}
            <Text className="text-[13px] font-mono text-foreground" style={{ fontWeight: "800", letterSpacing: 0.5 }}>
              {callsign}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/wallet")}
            className={`flex-row items-center px-2 py-1 rounded-lg border active:opacity-80 ${
              neg ? "bg-red-500/10 border-red-500/30" : "bg-zinc-900 border-zinc-700"
            }`}
            style={{ gap: 4 }}
          >
            <Wallet size={14} color={neg ? colors.red400 : colors.white} />
            <Text
              className={`text-[13px] font-sans-bold ${neg ? "text-red-400" : "text-white"}`}
            >
              {bal.toLocaleString("ru-RU")}
            </Text>
            <Text
              className={`text-[9px] font-sans-bold ${neg ? "text-red-400" : "text-white"}`}
              style={{ opacity: 0.7 }}
            >
              {t("balance_unit")}
            </Text>
          </Pressable>
        </View>

        {/* right: status toggle + exit */}
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <Pressable
            onPress={onToggleStatus}
            disabled={toggling}
            className={`flex-row items-center h-8 pl-2.5 pr-2 rounded-full border ${statusBg} ${statusBorder} ${
              toggling ? "opacity-50" : ""
            }`}
            style={{ gap: 6 }}
          >
            <View className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-white" : "bg-white/80"}`} />
            <Text className="text-[11px] font-sans-bold text-white">
              {statusLabel}
            </Text>
            {toggling ? (
              <Loader2 size={14} color={colors.white} />
            ) : (
              <Power size={14} color={colors.white} />
            )}
          </Pressable>

          <Pressable
            onPress={onExit}
            className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/30 items-center justify-center active:opacity-80"
          >
            <LogOut size={14} color={colors.red} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
