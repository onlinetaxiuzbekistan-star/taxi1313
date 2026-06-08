import { useState, useEffect, useRef } from "react";
import { View, Text, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Bell,
  Zap,
  ClipboardCheck,
  AlertTriangle,
  ShoppingBag,
  DollarSign,
  ShieldBan,
  X,
  type LucideIcon,
} from "lucide-react-native";

import { wsEvents } from "@/lib/ws-events";
import { useT, type TKey } from "@/lib/i18n";

type Cfg = { icon: LucideIcon; bg: string; defaultTitleKey: TKey };

// Maps WS push types -> banner styling. Events with dedicated UI (new_order ->
// IncomingOfferModal, call_* -> VoiceCall, chat -> tab badge) are intentionally
// excluded. Ported from web DriverNotificationPopup + use-driver-notifications.
const TYPES: Record<string, Cfg> = {
  urgent_order: { icon: Zap, bg: "#ef4444", defaultTitleKey: "ntf_urgent" },
  order_assigned: { icon: ClipboardCheck, bg: "#18181b", defaultTitleKey: "ntf_assigned" },
  order_taken: { icon: AlertTriangle, bg: "#18181b", defaultTitleKey: "ntf_taken" },
  order_expired: { icon: AlertTriangle, bg: "#18181b", defaultTitleKey: "ntf_expired" },
  marketplace_sold: { icon: ShoppingBag, bg: "#18181b", defaultTitleKey: "ntf_sold" },
  payment_received: { icon: DollarSign, bg: "#18181b", defaultTitleKey: "ntf_payment" },
  driver_blocked: { icon: ShieldBan, bg: "#ef4444", defaultTitleKey: "ntf_banned" },
  driver_unblocked: { icon: Bell, bg: "#10b981", defaultTitleKey: "ntf_unbanned" },
  news: { icon: Bell, bg: "#1FBAD6", defaultTitleKey: "news_one" },
};

interface Banner {
  type: string;
  title: string;
  body: string;
}

export function NotificationBanner() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const [banner, setBanner] = useState<Banner | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return wsEvents.on((d: any) => {
      const cfg = TYPES[d.type];
      if (!cfg) return;
      const title = d.title || t(cfg.defaultTitleKey);
      const body = d.body || d.message || "";
      setBanner({ type: d.type, title, body });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setBanner(null), 6000);
    });
  }, [t]);

  if (!banner) return null;
  const cfg = TYPES[banner.type] ?? TYPES.news;
  const Icon = cfg.icon;

  return (
    <View
      style={{ position: "absolute", top: insets.top + 60, left: 12, right: 12, zIndex: 150 }}
    >
      <View
        className="rounded-2xl border-2 px-4 py-3.5 flex-row items-start"
        style={{ backgroundColor: cfg.bg, borderColor: "rgba(255,255,255,0.15)", gap: 12 }}
      >
        <View className="w-11 h-11 rounded-xl bg-white/20 items-center justify-center">
          <Icon size={22} color="#fff" />
        </View>
        <View className="flex-1">
          <Text className="font-sans-bold text-white text-[15px]">{banner.title}</Text>
          {banner.body ? (
            <Text className="font-sans text-white/90 text-[13px] mt-0.5" numberOfLines={3}>
              {banner.body}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => setBanner(null)}
          className="w-8 h-8 rounded-full bg-white/25 items-center justify-center active:opacity-80"
        >
          <X size={16} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}
