import { useState, useEffect, useCallback } from "react";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { wsEvents } from "@/lib/ws-events";

export interface GroupChatInfo {
  id: number;
  name: string;
  chatType: string;
  memberCount: number;
  lastMessage: string;
  lastMessageAt: string | null;
  lastSenderName: string;
}

export interface GroupChatMessage {
  id: number;
  chatId: number;
  senderId: number;
  senderRole: string;
  senderName: string;
  message: string;
  type: string;
  status: string;
  createdAt: string;
}

// Ported from web hooks/use-group-chat.ts.
export function useGroupList() {
  const { token } = useAuth();
  const [chats, setChats] = useState<GroupChatInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/group-chats`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json();
        setChats(d.chats || []);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
    return wsEvents.on((d: any) => {
      if (d.type === "new_group_chat_message") load();
    });
  }, [load]);

  return { chats, loading, refresh: load };
}

export function useGroupChat(chatId: number | null) {
  const { token } = useAuth();
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const isOpen = chatId !== null && chatId > 0;

  const load = useCallback(async () => {
    if (!token || !chatId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/group-chats/${chatId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setMessages(d.messages || []);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [token, chatId]);

  useEffect(() => {
    if (!isOpen) return;
    setMessages([]);
    load();
    return wsEvents.on((d: any) => {
      if (d.type === "new_group_chat_message" && d.chatId === chatId && d.message) {
        const msg = d.message as GroupChatMessage;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      }
    });
  }, [isOpen, load, chatId]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!token || !chatId || !text.trim()) return;
      setSending(true);
      try {
        const res = await fetch(`${API_BASE_URL}/api/group-chats/${chatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ message: text.trim() }),
        });
        if (res.ok) {
          const msg = await res.json();
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        }
      } catch {
      } finally {
        setSending(false);
      }
    },
    [token, chatId],
  );

  return { messages, loading, sending, sendMessage, refresh: load };
}
