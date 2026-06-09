import { useState, useEffect } from "react";
import { View, Text, Pressable, ScrollView, Alert, Image } from "react-native";
import { useRouter } from "expo-router";
import { User, Star, Car, Wallet, TrendingUp, Bell, ChevronRight, Settings, Trash2, Camera } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useAuth } from "@/hooks/use-auth";
import { useT } from "@/lib/i18n";
import { getCallsign, DEMO_DRIVER } from "@/lib/driver";
import { PREVIEW_MODE, API_BASE_URL } from "@/config";
import { colors } from "@/lib/theme";
import { formatCurrency } from "@/features/orders/utils";

export default function ProfileScreen() {
  const { user, token, logout } = useAuth();
  const { t } = useT();
  const router = useRouter();
  const [ratingCount, setRatingCount] = useState<number | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  const driver = user ?? (PREVIEW_MODE ? DEMO_DRIVER : null);
  const photoKey = `driver_photo_${(driver as any)?.id ?? "me"}`;

  useEffect(() => {
    AsyncStorage.getItem(photoKey)
      .then((v) => v && setPhoto(v))
      .catch(() => {});
  }, [photoKey]);

  const savePhoto = (uri: string) => {
    setPhoto(uri);
    AsyncStorage.setItem(photoKey, uri).catch(() => {});
  };

  const fromGallery = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.6,
      });
      const uri = !res.canceled ? res.assets?.[0]?.uri : null;
      if (uri) savePhoto(uri);
    } catch {}
  };

  const fromCamera = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return;
      const res = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.6,
      });
      const uri = !res.canceled ? res.assets?.[0]?.uri : null;
      if (uri) savePhoto(uri);
    } catch {}
  };

  const pickPhoto = () => {
    Alert.alert(t("choose_photo"), undefined, [
      { text: t("from_camera"), onPress: fromCamera },
      { text: t("from_gallery"), onPress: fromGallery },
      { text: t("cancel"), style: "cancel" },
    ]);
  };

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE_URL}/api/drivers/my-rating-history`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const arr = d?.ratings || d?.history || d?.items || [];
        setRatingCount(Array.isArray(arr) ? arr.length : null);
      })
      .catch(() => {});
  }, [token]);

  if (!driver) return null;

  const menu = [
    { icon: Wallet, label: t("wallet_menu"), sub: formatCurrency(Number((driver as any).balance || 0)), to: "/wallet" as const },
    { icon: TrendingUp, label: t("earnings_menu"), sub: t("earnings_sub"), to: "/earnings" as const },
    { icon: Bell, label: t("news_menu"), sub: t("news_sub"), to: "/news" as const },
    { icon: Settings, label: t("settings_title"), sub: "", to: "/settings" as const },
  ];

  const confirmDelete = () => {
    Alert.alert(t("delete_account"), t("delete_account_q"), [
      { text: t("no"), style: "cancel" },
      { text: t("yes"), style: "destructive", onPress: () => logout() },
    ]);
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="p-4">
      {/* identity */}
      <View className="bg-card border border-border rounded-2xl p-5 items-center mb-4">
        <Pressable
          onPress={pickPhoto}
          className="w-20 h-20 rounded-full bg-primary/15 items-center justify-center mb-3 overflow-hidden active:opacity-80"
        >
          {photo ? (
            <Image source={{ uri: photo }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
          ) : (
            <User size={40} color={colors.primary} />
          )}
          {/* camera badge to signal it's tappable */}
          <View className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-primary items-center justify-center border-2 border-card">
            <Camera size={13} color="#fff" />
          </View>
        </Pressable>
        <Text className="font-display text-foreground text-xl mb-0.5">{driver.name}</Text>
        <Text className="font-mono text-primary text-sm" style={{ fontWeight: "700" }}>
          {getCallsign(driver)}
        </Text>
        <View className="flex-row items-center mt-3" style={{ gap: 6 }}>
          <Car size={15} color={colors.mutedForeground} />
          <Text className="font-sans text-muted-foreground text-[13px]">{driver.carModel ?? "—"}</Text>
          {(driver as any).carNumber ? (
            <Text className="font-sans-bold text-foreground text-[13px]">· {(driver as any).carNumber}</Text>
          ) : null}
        </View>
      </View>

      {/* stats */}
      <View className="flex-row mb-4" style={{ gap: 10 }}>
        <View className="flex-1 bg-card border border-border rounded-2xl p-3 items-center">
          <Star size={18} color={colors.amber} fill={colors.amber} />
          <Text className="font-display text-foreground text-lg mt-1">{driver.rating ?? "—"}</Text>
          <Text className="font-sans text-muted-foreground text-[11px]">
            {ratingCount != null ? `${ratingCount} ${t("ratings_count")}` : t("rating_label")}
          </Text>
        </View>
        <View className="flex-1 bg-card border border-border rounded-2xl p-3 items-center">
          <Car size={18} color={colors.primary} />
          <Text className="font-display text-foreground text-lg mt-1">{(driver as any).totalRides ?? 0}</Text>
          <Text className="font-sans text-muted-foreground text-[11px]">{t("rides_label")}</Text>
        </View>
        <View className="flex-1 bg-card border border-border rounded-2xl p-3 items-center">
          <Wallet size={18} color={colors.emerald} />
          <Text className="font-display text-foreground text-base mt-1" numberOfLines={1}>
            {formatCurrency(Number((driver as any).balance || 0))}
          </Text>
          <Text className="font-sans text-muted-foreground text-[11px]">{t("balance_label_low")}</Text>
        </View>
      </View>

      {/* menu */}
      <View className="bg-card border border-border rounded-2xl overflow-hidden mb-4">
        {menu.map((m, i) => (
          <Pressable
            key={m.label}
            onPress={() => router.push(m.to as any)}
            className={`flex-row items-center px-4 py-3.5 active:opacity-80 ${i > 0 ? "border-t border-border" : ""}`}
            style={{ gap: 12 }}
          >
            <View className="w-9 h-9 rounded-xl bg-secondary items-center justify-center">
              <m.icon size={18} color={colors.primary} />
            </View>
            <View className="flex-1">
              <Text className="font-sans-bold text-foreground text-sm">{m.label}</Text>
              <Text className="font-sans text-muted-foreground text-[12px]">{m.sub}</Text>
            </View>
            <ChevronRight size={18} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </View>

      {/* delete account (only auth action) */}
      <Pressable
        onPress={confirmDelete}
        className="bg-red-500/10 border border-red-500/20 rounded-2xl py-3.5 flex-row items-center justify-center active:opacity-80"
        style={{ gap: 8 }}
      >
        <Trash2 size={18} color={colors.red} />
        <Text className="font-sans-bold text-red-500 text-sm">{t("delete_account")}</Text>
      </Pressable>
    </ScrollView>
  );
}
