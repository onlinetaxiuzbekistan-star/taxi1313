import { useState, useEffect, useRef, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "/api";
const _base = (import.meta as any).env?.BASE_URL?.replace(/\/$/, "") || "";
const WS_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${_base}/api/ws`;

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

export interface GroupChatInfo {
  id: number;
  name: string;
  chatType: string;
  cityId: number | null;
  branchId: number | null;
  driverGroupId: number | null;
  createdBy: number;
  description: string;
  memberCount: number;
  lastMessage: string;
  lastMessageAt: string | null;
  lastSenderName: string;
  photosEnabled: boolean;
  voiceEnabled: boolean;
  callsEnabled: boolean;
}

export interface ChatSettings {
  photosEnabled: boolean;
  voiceEnabled: boolean;
  callsEnabled: boolean;
}

export function useGroupChatList(token: string | null) {
  const [chats, setChats] = useState<GroupChatInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const loadChats = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/group-chats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setChats(data.chats || []);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadChats(); }, [loadChats]);

  return { chats, loading, refresh: loadChats };
}

export function useGroupChat(
  token: string | null,
  myUserId: number | undefined,
  chatId: number | null,
) {
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOpen = chatId !== null && chatId > 0;

  const loadMessages = useCallback(async () => {
    if (!token || !chatId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/group-chats/${chatId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [token, chatId]);

  useEffect(() => {
    if (isOpen) {
      setMessages([]);
      loadMessages();
    }
  }, [isOpen, loadMessages]);

  useEffect(() => {
    if (!token || !myUserId || !isOpen) return;
    let mounted = true;

    function connect() {
      if (!mounted) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "auth", token }));
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === "new_group_chat_message" && data.chatId === chatId && data.message) {
            const msg = data.message as GroupChatMessage;
            setMessages(prev => {
              if (prev.some(m => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
          }
        } catch {}
      };

      ws.onclose = () => {
        if (mounted) {
          reconnectTimer.current = setTimeout(connect, 3000);
        }
      };
    }

    connect();

    return () => {
      mounted = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [token, myUserId, chatId, isOpen]);

  const sendMessage = useCallback(async (text: string) => {
    if (!token || !chatId || !text.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/group-chats/${chatId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text.trim() }),
      });
      if (res.ok) {
        const msg = await res.json();
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    } catch {} finally {
      setSending(false);
    }
  }, [token, chatId]);

  const sendPhoto = useCallback(async (file: File, caption?: string) => {
    if (!token || !chatId) return;
    setSending(true);
    try {
      const formData = new FormData();
      formData.append("photo", file);
      if (caption) formData.append("caption", caption);
      const res = await fetch(`${API_BASE}/group-chats/${chatId}/send-photo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        const msg = await res.json();
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    } catch {} finally {
      setSending(false);
    }
  }, [token, chatId]);

  const sendVoice = useCallback(async (blob: Blob, duration: number) => {
    if (!token || !chatId) return;
    setSending(true);
    try {
      const formData = new FormData();
      formData.append("voice", blob, "voice.webm");
      formData.append("duration", String(duration));
      const res = await fetch(`${API_BASE}/group-chats/${chatId}/send-voice`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        const msg = await res.json();
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    } catch {} finally {
      setSending(false);
    }
  }, [token, chatId]);

  const updateSettings = useCallback(async (settings: Partial<ChatSettings>) => {
    if (!token || !chatId) return null;
    try {
      const res = await fetch(`${API_BASE}/group-chats/${chatId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(settings),
      });
      if (res.ok) return await res.json();
    } catch {}
    return null;
  }, [token, chatId]);

  return { messages, loading, sending, sendMessage, sendPhoto, sendVoice, updateSettings, refresh: loadMessages };
}
