import { useState, useEffect } from "react";
import { View, Text, Pressable, Image, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Car, Plus, Camera, Wallet, Power, Store, Star, ChevronRight, Pencil } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { DriverUser } from "@/types";
import { getCallsign } from "@/lib/driver";
import { colors } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "./utils";

// Main Заказы tab when there is NO active ride — a polished driver card
// (identity + license plate + car photo + balance) above the primary actions.
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
  const router = useRouter();
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
  const carNumber = (user as any).carNumber as string | undefined;
  const balance = Number((user as any).balance || 0);
  const neg = balance < 0;
  const rating = (user as any).rating;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-4 pt-4 pb-10">
      {/* Driver card */}
      <View className="bg-card border border-border rounded-3xl p-4">
        {/* identity row */}
        <View className="flex-row items-center" style={{ gap: 12 }}>
          <View className="w-14 h-14 rounded-2xl bg-primary/12 items-center justify-center">
            <Text className="font-display text-primary text-xl">{(user.name || "?").trim().charAt(0).toUpperCase()}</Text>
          </View>
          <View className="flex-1">
            <Text className="font-display text-foreground text-lg" numberOfLines={1}>
              {user.name}
            </Text>
            <View className="flex-row items-center mt-0.5" style={{ gap: 6 }}>
              <Car size={13} color={colors.mutedForeground} />
              <Text className="font-sans text-muted-foreground text-[13px]" numberOfLines={1}>
                {user.carModel ?? "—"}
              </Text>
              {rating != null ? (
                <>
                  <Star size={12} color={colors.amber} fill={colors.amber} />
                  <Text className="font-sans-semibold text-foreground text-[12px]">{rating}</Text>
                </>
              ) : null}
            </View>
          </View>
          <View className="items-end" style={{ gap: 6 }}>
            <View className="bg-primary/15 rounded-lg px-2 py-0.5">
              <Text className="font-mono text-primary text-[11px]" style={{ fontWeight: "800", letterSpacing: 0.5 }}>
                {callsign}
              </Text>
            </View>
            {carNumber ? (
              <View className="bg-white rounded-lg px-3 py-1.5 border-2 border-zinc-800">
                <Text className="font-mono text-zinc-900 text-xl" style={{ fontWeight: "900", letterSpacing: 1.5 }}>
                  {carNumber}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* car photo */}
        <Pressable
          onPress={pickPhoto}
          className="w-full mt-4 rounded-2xl overflow-hidden border border-border bg-secondary active:opacity-90"
          style={{ aspectRatio: 16 / 9 }}
        >
          {photo ? (
            <>
              <Image source={{ uri: photo }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
              <View className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/55 items-center justify-center">
                <Pencil size={14} color="#fff" />
              </View>
            </>
          ) : (
            <View className="flex-1 items-center justify-center" style={{ gap: 8 }}>
              <Car size={44} color={colors.mutedForeground} />
              <View className="flex-row items-center" style={{ gap: 6 }}>
                <Camera size={15} color={colors.primary} />
                <Text className="font-sans text-muted-foreground text-[13px]">{t("home_add_photo")}</Text>
              </View>
            </View>
          )}
        </Pressable>

        {/* balance — tap to open the statement */}
        <Pressable
          onPress={() => router.push("/wallet")}
          className="w-full mt-4 rounded-2xl bg-secondary px-4 py-3.5 flex-row items-center active:opacity-80"
          style={{ gap: 12 }}
        >
          <View className="w-10 h-10 rounded-xl bg-card items-center justify-center">
            <Wallet size={18} color={neg ? colors.red : colors.primary} />
          </View>
          <View className="flex-1">
            <Text className="font-sans-bold text-muted-foreground text-[11px] uppercase" style={{ letterSpacing: 0.5 }}>
              {t("balance_title")}
            </Text>
            <Text className={`font-display text-2xl ${neg ? "text-red-400" : "text-foreground"}`}>{formatCurrency(balance)}</Text>
          </View>
          <ChevronRight size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* primary actions */}
      {!isOnline ? (
        <Pressable
          onPress={onGoOnline}
          disabled={creating}
          className="mt-5 py-4 rounded-2xl bg-amber-500 flex-row items-center justify-center active:opacity-90"
          style={{ gap: 8 }}
        >
          {creating ? <ActivityIndicator color="#18181b" /> : <Power size={20} color="#18181b" />}
          <Text className="font-sans-bold text-zinc-900 text-base">{t("go_online")}</Text>
        </Pressable>
      ) : (
        <>
          <Pressable
            onPress={onCreate}
            className="mt-5 py-4 rounded-2xl bg-primary flex-row items-center justify-center active:opacity-90"
            style={{ gap: 8 }}
          >
            <Plus size={22} color={colors.primaryForeground} />
            <Text className="font-sans-bold text-primary-foreground text-base">{t("start_work")}</Text>
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
