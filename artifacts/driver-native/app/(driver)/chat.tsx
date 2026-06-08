import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Send, Check, CheckCheck, MessageCircle } from "lucide-react-native";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { colors } from "@/lib/theme";
import { useChat, type ChatMessage } from "@/features/chat/use-chat";

function timeOf(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

export default function ChatScreen() {
  const { token, user } = useAuth();
  const [peer, setPeer] = useState<{ id: number; name: string } | null>(null);
  const [resolving, setResolving] = useState(true);
  const [text, setText] = useState("");
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const typingThrottle = useRef(0);

  const { messages, loading, sending, peerTyping, peerOnline, sendMessage, sendTyping, markRead } = useChat(
    peer?.id ?? null,
    0,
  );

  // Resolve the dispatcher to chat with.
  useEffect(() => {
    if (!token) return;
    setResolving(true);
    fetch(`${API_BASE_URL}/api/chat/dispatcher-info`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d?.id) setPeer({ id: d.id, name: d.name || "Диспетчер" });
        else setPeer(null);
      })
      .catch(() => setPeer(null))
      .finally(() => setResolving(false));
  }, [token]);

  // Mark incoming (peer) messages as read.
  useEffect(() => {
    const unread = messages.filter((m) => m.senderId !== user?.id && m.status !== "read").map((m) => m.id);
    if (unread.length) markRead(unread);
  }, [messages, user?.id, markRead]);

  const onChangeText = useCallback(
    (v: string) => {
      setText(v);
      const now = Date.now();
      if (now - typingThrottle.current > 1500) {
        typingThrottle.current = now;
        sendTyping();
      }
    },
    [sendTyping],
  );

  const onSend = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    sendMessage(t);
  };

  const renderItem = ({ item }: { item: ChatMessage }) => {
    const mine = item.senderId === user?.id;
    return (
      <View className={`px-4 mb-2 ${mine ? "items-end" : "items-start"}`}>
        <View
          className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${mine ? "bg-primary" : "bg-card border border-border"}`}
        >
          <Text className={`font-sans text-[15px] ${mine ? "text-primary-foreground" : "text-foreground"}`}>
            {item.message}
          </Text>
          <View className="flex-row items-center justify-end mt-1" style={{ gap: 4 }}>
            <Text className={`font-sans text-[10px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
              {timeOf(item.createdAt)}
            </Text>
            {mine &&
              (item.status === "read" ? (
                <CheckCheck size={13} color="#67e8f9" />
              ) : item.status === "delivered" ? (
                <CheckCheck size={13} color={colors.primaryForeground} />
              ) : (
                <Check size={13} color={colors.primaryForeground} />
              ))}
          </View>
        </View>
      </View>
    );
  };

  if (resolving) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!peer) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-8">
        <View className="w-20 h-20 rounded-2xl bg-primary/[0.12] items-center justify-center mb-4">
          <MessageCircle size={36} color={colors.primary} />
        </View>
        <Text className="font-display text-foreground text-xl mb-1">Чат</Text>
        <Text className="font-sans text-muted-foreground text-sm text-center">Диспетчер сейчас недоступен</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* sub-header: dispatcher + presence */}
      <View className="flex-row items-center bg-card border-b border-border px-4 py-2.5" style={{ gap: 10 }}>
        <View className="w-9 h-9 rounded-full bg-primary/15 items-center justify-center">
          <MessageCircle size={18} color={colors.primary} />
        </View>
        <View className="flex-1">
          <Text className="font-sans-bold text-foreground text-sm">{peer.name}</Text>
          <Text className={`font-sans text-[12px] ${peerOnline ? "text-emerald-400" : "text-muted-foreground"}`}>
            {peerTyping ? "печатает…" : peerOnline ? "в сети" : "не в сети"}
          </Text>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => String(m.id)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingVertical: 12 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View className="items-center py-16">
              <Text className="font-sans text-muted-foreground text-sm">Нет сообщений</Text>
            </View>
          }
        />
      )}

      {/* input */}
      <View className="flex-row items-end bg-card border-t border-border px-3 py-2.5" style={{ gap: 8 }}>
        <TextInput
          value={text}
          onChangeText={onChangeText}
          placeholder="Сообщение…"
          placeholderTextColor={colors.mutedForeground}
          multiline
          className="flex-1 bg-secondary rounded-2xl px-4 py-2.5 text-foreground font-sans text-[15px] max-h-28"
        />
        <Pressable
          onPress={onSend}
          disabled={sending || !text.trim()}
          className={`w-11 h-11 rounded-full items-center justify-center ${text.trim() ? "bg-primary" : "bg-secondary"}`}
        >
          {sending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Send size={18} color={text.trim() ? colors.primaryForeground : colors.mutedForeground} />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
