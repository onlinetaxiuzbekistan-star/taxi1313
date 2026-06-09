import { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Linking } from "react-native";
import { useFocusEffect } from "expo-router";
import { MessageCircle, Users, ChevronRight, Phone } from "lucide-react-native";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { colors } from "@/lib/theme";
import { useChat } from "@/features/chat/use-chat";
import { useGroupList, useGroupChat } from "@/features/chat/use-group-chat";
import { useUnread } from "@/features/chat/unread";
import { ChatThread } from "@/features/chat/ChatThread";
import { useT } from "@/lib/i18n";

type Open = null | { kind: "dm"; id: number; name: string } | { kind: "group"; id: number; name: string };

function timeShort(iso: string | null) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

export default function ChatScreen() {
  const { t } = useT();
  const { token, user } = useAuth();
  const { reset } = useUnread();
  // Dispatcher hotline — a regular phone call (not WebRTC).
  const DISPATCHER_PHONE = "+998787771313";
  const callDispatcher = () => Linking.openURL(`tel:${DISPATCHER_PHONE}`).catch(() => {});
  const [dispatcher, setDispatcher] = useState<{ id: number; name: string } | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [text, setText] = useState("");
  const typingThrottle = useRef(0);

  const { chats: groups, loading: groupsLoading } = useGroupList();

  // active threads (hooks called unconditionally; null when not open)
  const dm = useChat(open?.kind === "dm" ? open.id : null, 0);
  const group = useGroupChat(open?.kind === "group" ? open.id : null);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE_URL}/api/chat/dispatcher-info`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d?.id) setDispatcher({ id: d.id, name: d.name || t("dispatcher") });
      })
      .catch(() => {});
  }, [token, t]);

  // Reset the unread badge whenever the chat tab is focused.
  useFocusEffect(
    useCallback(() => {
      reset();
    }, [reset]),
  );

  // Mark dispatcher DM messages read while open.
  useEffect(() => {
    if (open?.kind !== "dm") return;
    const unread = dm.messages.filter((m) => m.senderId !== user?.id && m.status !== "read").map((m) => m.id);
    if (unread.length) dm.markRead(unread);
  }, [open, dm, user?.id]);

  const onChangeText = useCallback(
    (v: string) => {
      setText(v);
      if (open?.kind === "dm") {
        const now = Date.now();
        if (now - typingThrottle.current > 1500) {
          typingThrottle.current = now;
          dm.sendTyping();
        }
      }
    },
    [open, dm],
  );

  const onSend = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    if (open?.kind === "dm") dm.sendMessage(t);
    else if (open?.kind === "group") group.sendMessage(t);
  };

  const back = () => {
    setOpen(null);
    setText("");
  };

  // ---- thread views ----
  if (open?.kind === "dm") {
    return (
      <ChatThread
        title={open.name}
        subtitle={dm.peerTyping ? t("typing") : dm.peerOnline ? t("online_low") : t("offline_low")}
        subtitleColor={dm.peerOnline && !dm.peerTyping ? "online" : "muted"}
        messages={dm.messages}
        myUserId={user?.id}
        loading={dm.loading}
        sending={dm.sending}
        showStatusTicks
        text={text}
        onChangeText={onChangeText}
        onSend={onSend}
        onBack={back}
        onCall={callDispatcher}
      />
    );
  }
  if (open?.kind === "group") {
    return (
      <ChatThread
        title={open.name}
        messages={group.messages}
        myUserId={user?.id}
        loading={group.loading}
        sending={group.sending}
        showSenderName
        text={text}
        onChangeText={onChangeText}
        onSend={onSend}
        onBack={back}
      />
    );
  }

  // ---- conversations list ----
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="py-2">
      {/* Prominent call-dispatcher button */}
      {dispatcher && (
        <Pressable
          onPress={callDispatcher}
          className="mx-4 mb-2 py-3.5 rounded-2xl bg-emerald-500 flex-row items-center justify-center active:opacity-90"
          style={{ gap: 8 }}
        >
          <Phone size={18} color="#fff" />
          <Text className="font-sans-bold text-white text-sm">{t("call_dispatcher")}</Text>
        </Pressable>
      )}

      {dispatcher && (
        <Pressable
          onPress={() => setOpen({ kind: "dm", id: dispatcher.id, name: dispatcher.name })}
          className="flex-row items-center px-4 py-3 active:opacity-80"
          style={{ gap: 12 }}
        >
          <View className="w-12 h-12 rounded-full bg-primary/15 items-center justify-center">
            <MessageCircle size={22} color={colors.primary} />
          </View>
          <View className="flex-1">
            <Text className="font-sans-bold text-foreground text-[15px]">{dispatcher.name}</Text>
            <Text className="font-sans text-muted-foreground text-[13px]">{t("dispatch_center")}</Text>
          </View>
          <ChevronRight size={18} color={colors.mutedForeground} />
        </Pressable>
      )}

      <View className="h-px bg-border mx-4 my-1" />
      <Text className="font-sans-semibold text-muted-foreground text-[11px] uppercase px-4 py-2" style={{ letterSpacing: 0.5 }}>
        {t("groups")}
      </Text>

      {groupsLoading ? (
        <ActivityIndicator color={colors.primary} className="mt-4" />
      ) : groups.length === 0 ? (
        <Text className="font-sans text-muted-foreground text-sm px-4 py-3">{t("no_groups")}</Text>
      ) : (
        groups.map((g) => (
          <Pressable
            key={g.id}
            onPress={() => setOpen({ kind: "group", id: g.id, name: g.name })}
            className="flex-row items-center px-4 py-3 active:opacity-80"
            style={{ gap: 12 }}
          >
            <View className="w-12 h-12 rounded-full bg-secondary items-center justify-center">
              <Users size={22} color={colors.mutedForeground} />
            </View>
            <View className="flex-1">
              <View className="flex-row items-center justify-between">
                <Text className="font-sans-bold text-foreground text-[15px]" numberOfLines={1}>
                  {g.name}
                </Text>
                <Text className="font-sans text-muted-foreground text-[11px]">{timeShort(g.lastMessageAt)}</Text>
              </View>
              <Text className="font-sans text-muted-foreground text-[13px]" numberOfLines={1}>
                {g.lastSenderName ? `${g.lastSenderName}: ` : ""}
                {g.lastMessage || `${g.memberCount} ${t("members")}`}
              </Text>
            </View>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}
