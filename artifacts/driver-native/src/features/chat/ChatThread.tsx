import { useRef, useCallback } from "react";
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
import { Send, Check, CheckCheck, ChevronLeft, Phone } from "lucide-react-native";

import { colors } from "@/lib/theme";
import { useT } from "@/lib/i18n";

export interface ThreadMessage {
  id: number;
  senderId: number;
  senderName: string;
  message: string;
  status: string;
  createdAt: string;
}

function timeOf(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

// Generic chat thread UI — shared by the dispatcher DM and group chats.
export function ChatThread({
  title,
  subtitle,
  subtitleColor = "muted",
  messages,
  myUserId,
  loading,
  sending,
  showSenderName = false,
  showStatusTicks = false,
  text,
  onChangeText,
  onSend,
  onBack,
  onCall,
}: {
  title: string;
  subtitle?: string;
  subtitleColor?: "muted" | "online";
  messages: ThreadMessage[];
  myUserId?: number;
  loading: boolean;
  sending: boolean;
  showSenderName?: boolean;
  showStatusTicks?: boolean;
  text: string;
  onChangeText: (v: string) => void;
  onSend: () => void;
  onBack: () => void;
  onCall?: () => void;
}) {
  const { t } = useT();
  const listRef = useRef<FlatList<ThreadMessage>>(null);

  const renderItem = useCallback(
    ({ item }: { item: ThreadMessage }) => {
      const mine = item.senderId === myUserId;
      return (
        <View className={`px-4 mb-2 ${mine ? "items-end" : "items-start"}`}>
          {showSenderName && !mine && (
            <Text className="font-sans-semibold text-primary text-[11px] mb-0.5 ml-1">{item.senderName}</Text>
          )}
          <View className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${mine ? "bg-primary" : "bg-card border border-border"}`}>
            <Text className={`font-sans text-[15px] ${mine ? "text-primary-foreground" : "text-foreground"}`}>
              {item.message}
            </Text>
            <View className="flex-row items-center justify-end mt-1" style={{ gap: 4 }}>
              <Text className={`font-sans text-[10px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                {timeOf(item.createdAt)}
              </Text>
              {showStatusTicks &&
                mine &&
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
    },
    [myUserId, showSenderName, showStatusTicks],
  );

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View className="flex-row items-center bg-card border-b border-border px-2 py-2.5" style={{ gap: 6 }}>
        <Pressable onPress={onBack} className="w-9 h-9 rounded-full items-center justify-center active:opacity-70">
          <ChevronLeft size={22} color={colors.foreground} />
        </Pressable>
        <View className="flex-1">
          <Text className="font-sans-bold text-foreground text-sm" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text className={`font-sans text-[12px] ${subtitleColor === "online" ? "text-emerald-400" : "text-muted-foreground"}`}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {onCall ? (
          <Pressable
            onPress={onCall}
            className="w-10 h-10 rounded-full bg-emerald-500/15 items-center justify-center active:opacity-80 mr-1"
          >
            <Phone size={18} color={colors.emerald} />
          </Pressable>
        ) : null}
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
              <Text className="font-sans text-muted-foreground text-sm">{t("no_messages")}</Text>
            </View>
          }
        />
      )}

      <View className="flex-row items-end bg-card border-t border-border px-3 py-2.5" style={{ gap: 8 }}>
        <TextInput
          value={text}
          onChangeText={onChangeText}
          placeholder={t("message_ph")}
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
