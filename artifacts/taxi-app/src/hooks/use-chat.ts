import { useState, useEffect, useRef, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "/api";
const _base = (import.meta as any).env?.BASE_URL?.replace(/\/$/, "") || "";
const WS_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${_base}/api/ws`;

export interface ChatMessage {
  id: number;
  rideId: number;
  senderId: number;
  senderRole: string;
  senderName: string;
  recipientId: number | null;
  message: string;
  type: string;
  status: string;
  createdAt: string;
}

export interface ChatParticipant {
  id: number;
  rideId: number;
  userId: number;
  role: string;
  name: string;
}

export interface TypingUser {
  userId: number;
  userName: string;
  userRole: string;
}

export function useChat(
  token: string | null,
  myUserId: number | undefined,
  peerId: number | null,
  rideId: number = 0,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [participants, setParticipants] = useState<ChatParticipant[]>([]);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<number>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const isOpen = peerId !== null || rideId > 0;

  const loadHistory = useCallback(async () => {
    if (!token || !isOpen) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (rideId > 0) params.set("rideId", String(rideId));
      if (peerId) params.set("peerId", String(peerId));

      const res = await fetch(`${API_BASE}/chat/messages?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [token, peerId, rideId, isOpen]);

  const loadParticipants = useCallback(async () => {
    if (!token || rideId <= 0) return;
    try {
      const res = await fetch(`${API_BASE}/chat/participants?rideId=${rideId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setParticipants(data.participants || []);
      }
    } catch {}
  }, [token, rideId]);

  const joinChat = useCallback(async () => {
    if (!token || rideId <= 0) return;
    try {
      await fetch(`${API_BASE}/chat/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rideId }),
      });
    } catch {}
  }, [token, rideId]);

  useEffect(() => {
    if (isOpen) {
      setMessages([]);
      setTypingUsers([]);
      loadHistory();
      if (rideId > 0) {
        joinChat();
        loadParticipants();
      }
    }
  }, [isOpen, loadHistory, loadParticipants, joinChat, rideId]);

  useEffect(() => {
    if (!isOpen || !participants.length || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const ids = participants.map(p => p.userId).filter(id => id !== myUserId);
    if (ids.length > 0) {
      wsRef.current.send(JSON.stringify({ type: "presence_query", userIds: ids }));
    }
  }, [participants, isOpen, myUserId]);

  useEffect(() => {
    if (!token || !myUserId || !isOpen) return;
    let mounted = true;

    function connect() {
      if (!mounted) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "auth", token }));
        const queryIds: number[] = [];
        if (peerId) queryIds.push(peerId);
        if (queryIds.length > 0) {
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "presence_query", userIds: queryIds }));
            }
          }, 300);
        }
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);

          if (data.type === "new_chat_message" && data.message) {
            const msg = data.message as ChatMessage;
            const belongsToConvo =
              (rideId > 0 && msg.rideId === rideId) ||
              (peerId && (msg.senderId === peerId || msg.recipientId === peerId) &&
               (msg.senderId === myUserId || msg.recipientId === myUserId));

            if (belongsToConvo) {
              setMessages(prev => {
                if (prev.some(m => m.id === msg.id)) return prev;
                return [...prev, msg];
              });
              setTypingUsers(prev => prev.filter(t => t.userId !== msg.senderId));

              if (msg.senderId !== myUserId && msg.status === "sent") {
                try {
                  ws.send(JSON.stringify({
                    type: "message_delivered",
                    messageIds: [msg.id],
                    rideId: rideId || 0,
                  }));
                } catch {}
              }
            }
          }

          if (data.type === "typing") {
            const isRelevant =
              (rideId > 0 && data.rideId === rideId) ||
              (peerId && data.userId === peerId);
            if (isRelevant && data.userId !== myUserId) {
              setTypingUsers(prev => {
                if (prev.some(t => t.userId === data.userId)) return prev;
                return [...prev, { userId: data.userId, userName: data.userName, userRole: data.userRole }];
              });
              const existing = typingTimers.current.get(data.userId);
              if (existing) clearTimeout(existing);
              typingTimers.current.set(data.userId, setTimeout(() => {
                setTypingUsers(prev => prev.filter(t => t.userId !== data.userId));
                typingTimers.current.delete(data.userId);
              }, 3000));
            }
          }

          if (data.type === "messages_delivered") {
            if (data.messageIds?.length) {
              setMessages(prev => prev.map(m =>
                data.messageIds.includes(m.id) && m.status === "sent"
                  ? { ...m, status: "delivered" }
                  : m
              ));
            }
          }

          if (data.type === "messages_read") {
            if (data.messageIds?.length) {
              setMessages(prev => prev.map(m =>
                data.messageIds.includes(m.id) ? { ...m, status: "read" } : m
              ));
            }
          }

          if (data.type === "participant_joined" && rideId > 0 && data.rideId === rideId) {
            loadParticipants();
          }

          if (data.type === "presence_result" && data.online) {
            setOnlineUserIds(prev => {
              const next = new Set(prev);
              for (const [uid, isOnline] of Object.entries(data.online)) {
                if (isOnline) next.add(Number(uid));
                else next.delete(Number(uid));
              }
              return next;
            });
          }

          if (data.type === "user_online" && data.userId) {
            setOnlineUserIds(prev => {
              const next = new Set(prev);
              next.add(data.userId);
              return next;
            });
          }

          if (data.type === "user_offline" && data.userId) {
            setOnlineUserIds(prev => {
              const next = new Set(prev);
              next.delete(data.userId);
              return next;
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
      typingTimers.current.forEach(t => clearTimeout(t));
      typingTimers.current.clear();
    };
  }, [token, myUserId, peerId, rideId, isOpen, loadParticipants]);

  const sendMessage = useCallback(async (text: string) => {
    if (!token || !text.trim()) return;
    setSending(true);
    try {
      const body: any = { message: text.trim() };
      if (rideId > 0) body.rideId = rideId;
      if (peerId) body.peerId = peerId;

      const res = await fetch(`${API_BASE}/chat/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const msg = await res.json();
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    } catch {
    } finally {
      setSending(false);
    }
  }, [token, peerId, rideId]);

  const sendVoice = useCallback(async (blob: Blob, duration: number) => {
    if (!token) return;
    setSending(true);
    try {
      const formData = new FormData();
      formData.append("voice", blob, "voice.webm");
      formData.append("duration", String(duration));
      if (rideId > 0) formData.append("rideId", String(rideId));
      if (peerId) formData.append("peerId", String(peerId));

      const res = await fetch(`${API_BASE}/chat/send-voice`, {
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
    } catch {
    } finally {
      setSending(false);
    }
  }, [token, peerId, rideId]);

  const sendPhoto = useCallback(async (file: File, caption?: string) => {
    if (!token) return;
    setSending(true);
    try {
      const formData = new FormData();
      formData.append("photo", file);
      if (caption) formData.append("caption", caption);
      if (rideId > 0) formData.append("rideId", String(rideId));
      if (peerId) formData.append("peerId", String(peerId));

      const res = await fetch(`${API_BASE}/chat/send-photo`, {
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
    } catch {
    } finally {
      setSending(false);
    }
  }, [token, peerId, rideId]);

  const sendTyping = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const payload: any = { type: "typing" };
    if (rideId > 0) payload.rideId = rideId;
    if (peerId) payload.peerId = peerId;
    wsRef.current.send(JSON.stringify(payload));
  }, [rideId, peerId]);

  const markAsRead = useCallback(async (messageIds: number[]) => {
    if (!token || !messageIds.length) return;
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "message_read", rideId, messageIds }));
      } else {
        await fetch(`${API_BASE}/chat/read`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ rideId, messageIds }),
        });
      }
    } catch {}
  }, [token, rideId]);

  return {
    messages, loading, sending, sendMessage, sendVoice, sendPhoto, refresh: loadHistory,
    participants, typingUsers, sendTyping, markAsRead, onlineUserIds,
  };
}
