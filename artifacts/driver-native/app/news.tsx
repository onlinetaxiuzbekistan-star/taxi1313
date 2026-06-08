import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft, Bell, Check } from "lucide-react-native";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { colors } from "@/lib/theme";

interface NewsItem {
  id: number;
  title: string;
  content: string;
  createdAt: string;
  isRead?: boolean;
}

const strip = (s: string) => (s || "").replace(/<[^>]*>/g, "").replace(/\*\*/g, "").trim();
const dateOf = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return "";
  }
};

export default function NewsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<NewsItem | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/news?audience=driver&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setNews(d.items || []);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const markRead = useCallback(
    async (id: number) => {
      setNews((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      try {
        await fetch(`${API_BASE_URL}/api/news/${id}/read`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: "{}",
        });
      } catch {}
    },
    [token],
  );

  const open = (item: NewsItem) => {
    setSelected(item);
    if (!item.isRead) markRead(item.id);
  };

  // ---- detail ----
  if (selected) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center px-2 py-2" style={{ gap: 4 }}>
          <Pressable onPress={() => setSelected(null)} className="w-10 h-10 items-center justify-center active:opacity-70">
            <ChevronLeft size={24} color={colors.foreground} />
          </Pressable>
          <Text className="font-display text-foreground text-lg">Новость</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16 }}>
          <Text className="font-display text-foreground text-xl mb-1">{selected.title}</Text>
          <Text className="font-sans text-muted-foreground text-[12px] mb-4">{dateOf(selected.createdAt)}</Text>
          <Text className="font-sans text-foreground text-[15px]" style={{ lineHeight: 22 }}>
            {strip(selected.content)}
          </Text>
          <View className="flex-row items-center justify-center mt-6" style={{ gap: 6 }}>
            <Check size={16} color={colors.emerald} />
            <Text className="font-sans-semibold text-emerald-400 text-sm">Прочитано</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ---- list ----
  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-2 py-2" style={{ gap: 4 }}>
        <Pressable onPress={() => router.back()} className="w-10 h-10 items-center justify-center active:opacity-70">
          <ChevronLeft size={24} color={colors.foreground} />
        </Pressable>
        <Text className="font-display text-foreground text-lg">Новости</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} className="mt-8" />
      ) : news.length === 0 ? (
        <View className="items-center justify-center mt-24">
          <Bell size={36} color={colors.mutedForeground} />
          <Text className="font-sans text-muted-foreground text-sm mt-2">Нет новостей</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16, gap: 10 }}>
          {news.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => open(item)}
              className={`bg-card border rounded-2xl p-4 active:opacity-80 ${item.isRead ? "border-border opacity-70" : "border-primary/30"}`}
            >
              <View className="flex-row items-center" style={{ gap: 8 }}>
                {!item.isRead && <View className="w-2 h-2 rounded-full bg-primary" />}
                <Text className="font-sans-bold text-foreground text-[15px] flex-1" numberOfLines={1}>
                  {item.title}
                </Text>
              </View>
              <Text className="font-sans text-muted-foreground text-[13px] mt-1" numberOfLines={2}>
                {strip(item.content).substring(0, 120)}
              </Text>
              <Text className="font-sans text-muted-foreground text-[11px] mt-2">{dateOf(item.createdAt)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
