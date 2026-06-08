import { useState, useEffect } from "react";
import { View, Text, Pressable, Image, ScrollView, ActivityIndicator } from "react-native";
import { Car, Plus, Camera, Wallet, Power, Store } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { DriverUser } from "@/types";
import { getCallsign } from "@/lib/driver";
import { colors } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "./utils";

// Main Заказы tab when there is NO active ride: identity + tappable car photo +
// prominent balance + a button that opens the ride-creation screen.
export function HomeScreen({
  user,
  isOnline,
  creating,
  onCreate,
  onSell,
  onGoOnline,
}: {
  user: DriverUser;
  isOnline: boolean;
  creating?: boolean;
  onCreate: () => void;
  onSell: () => void;
  onGoOnline: () => void;
}) {
  const { t } = useT();
  const [photo, setPhoto] = useState<string | null>(null);
  const storeKey = `car_photo_${user.id ?? "me"}`;

  useEffect(() => {
    AsyncStorage.getItem(storeKey)
      .then((v) => v && setPhoto(v))
      .catch(() => {});
  }, [storeKey]);

  const pickPhoto = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.6,
      });
      const uri = !res.canceled ? res.assets?.[0]?.uri : null;
      if (uri) {
        setPhoto(uri);
        AsyncStorage.setItem(storeKey, uri).catch(() => {});
      }
    } catch {}
  };

  const callsign = getCallsign(user);
  const balance = Number((user as any).balance || 0);
  const neg = balance < 0;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-4 pt-4 pb-10">
      <View className="bg-card border border-border rounded-3xl p-5 items-center">
        {/* identity */}
        <Text className="font-display text-foreground text-xl">{user.name}</Text>
        <View className="flex-row items-center mt-1" style={{ gap: 8 }}>
          <Text className="font-sans text-muted-foreground text-[13px]">{user.carModel ?? "—"}</Text>
          {(user as any).carNumber ? (
            <Text className="font-sans-bold text-foreground text-[13px]">· {(user as any).carNumber}</Text>
          ) : null}
        </View>
        <Text className="font-mono text-primary text-sm mt-0.5" style={{ fontWeight: "700", letterSpacing: 0.5 }}>
          {callsign}
        </Text>

        {/* car photo — tap to upload (persisted locally) */}
        <Pressable
          onPress={pickPhoto}
          className="w-full mt-4 rounded-2xl overflow-hidden border border-border bg-secondary active:opacity-90"
          style={{ aspectRatio: 16 / 9 }}
        >
          {photo ? (
            <Image source={{ uri: photo }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
          ) : (
            <View className="flex-1 items-center justify-center" style={{ gap: 8 }}>
              <Car size={48} color={colors.mutedForeground} />
              <View className="flex-row items-center" style={{ gap: 6 }}>
                <Camera size={15} color={colors.primary} />
                <Text className="font-sans text-muted-foreground text-[13px]">{t("home_add_photo")}</Text>
              </View>
            </View>
          )}
        </Pressable>
        {photo ? (
          <Pressable onPress={pickPhoto} className="mt-2 active:opacity-70">
            <Text className="font-sans text-primary text-[12px]">{t("home_change_photo")}</Text>
          </Pressable>
        ) : null}

        {/* balance — large + prominent */}
        <View className="w-full mt-5 items-center rounded-2xl bg-secondary py-4">
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <Wallet size={16} color={neg ? colors.red : colors.emerald} />
            <Text className="font-sans-bold text-muted-foreground text-[11px] uppercase" style={{ letterSpacing: 0.5 }}>
              {t("balance_title")}
            </Text>
          </View>
          <Text className={`font-display text-3xl mt-1 ${neg ? "text-red-400" : "text-foreground"}`}>
            {formatCurrency(balance)}
          </Text>
        </View>
      </View>

      {/* create ride */}
      {!isOnline ? (
        <Pressable
          onPress={onGoOnline}
          disabled={creating}
          className="mt-4 py-4 rounded-2xl bg-amber-500 flex-row items-center justify-center active:opacity-90"
          style={{ gap: 8 }}
        >
          {creating ? <ActivityIndicator color="#18181b" /> : <Power size={20} color="#18181b" />}
          <Text className="font-sans-bold text-zinc-900 text-base">{t("go_online")}</Text>
        </Pressable>
      ) : (
        <>
          <Pressable
            onPress={onCreate}
            className="mt-4 py-4 rounded-2xl bg-primary flex-row items-center justify-center active:opacity-90"
            style={{ gap: 8 }}
          >
            <Plus size={22} color={colors.primaryForeground} />
            <Text className="font-sans-bold text-primary-foreground text-base">{t("create_ride")}</Text>
          </Pressable>
          <Pressable
            onPress={onSell}
            className="mt-3 py-4 rounded-2xl bg-card border border-primary/40 flex-row items-center justify-center active:opacity-90"
            style={{ gap: 8 }}
          >
            <Store size={20} color={colors.primary} />
            <Text className="font-sans-bold text-primary text-base">{t("sell_to_operator")}</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}
