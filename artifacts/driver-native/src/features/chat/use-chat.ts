import { useState, useEffect, useRef, useCallback } from "react";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { wsEvents } from "@/lib/ws-events";
import { sendWsMessage } from "@/hooks/use-ride-websocket";

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

// Native chat — ported from web hooks/use-chat.ts, but reuses the existing
// authenticated driver WebSocket (wsEvents inbound + sendWsMessage outbound)
// instead of opening a second socket. Driver ↔ dispatcher DM (+ ride chat).
export function useChat(peerId: number | null, rideId = 0) {
  const { token, user } = useAuth();
  const myUserId = user?.id;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [peerOnline, setPeerOnline] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOpen = peerId !== null || rideId > 0;

  const loadHistory = useCallback(async () => {
    if (!token || !isOpen) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (rideId > 0) params.set("rideId", String(rideId));
      if (peerId) params.set("peerId", String(peerId));
      const res = await fetch(`${API_BASE_URL}/api/chat/messages?${params}`, {
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

  useEffect(() => {
    if (!isOpen) return;
    setMessages([]);
    setPeerTyping(false);
    loadHistory();
    if (peerId) sendWsMessage({ type: "presence_query", userIds: [peerId] });
  }, [isOpen, loadHistory, peerId]);

  // Inbound via the shared driver socket.
  useEffect(() => {
    if (!isOpen || !myUserId) return;
    return wsEvents.on((d: any) => {
      if (d.type === "new_chat_message" && d.message) {
        const msg = d.message as ChatMessage;
        const belongs =
          (rideId > 0 && msg.rideId === rideId) ||
          (!!peerId &&
            (msg.senderId === peerId || msg.recipientId === peerId) &&
            (msg.senderId === myUserId || msg.recipientId === myUserId));
        if (!belongs) return;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        setPeerTyping(false);
        if (msg.senderId !== myUserId && msg.status === "sent") {
          sendWsMessage({ type: "message_delivered", messageIds: [msg.id], rideId: rideId || 0 });
        }
      } else if (d.type === "typing") {
        const relevant = (rideId > 0 && d.rideId === rideId) || (!!peerId && d.userId === peerId);
        if (relevant && d.userId !== myUserId) {
          setPeerTyping(true);
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setPeerTyping(false), 3000);
        }
      } else if (d.type === "messages_delivered" && d.messageIds?.length) {
        setMessages((prev) =>
          prev.map((m) => (d.messageIds.includes(m.id) && m.status === "sent" ? { ...m, status: "delivered" } : m)),
        );
      } else if (d.type === "messages_read" && d.messageIds?.length) {
        setMessages((prev) => prev.map((m) => (d.messageIds.includes(m.id) ? { ...m, status: "read" } : m)));
      } else if (d.type === "presence_result" && d.online && peerId != null) {
        setPeerOnline(!!d.online[peerId] || !!d.online[String(peerId)]);
      } else if (d.type === "user_online" && d.userId === peerId) {
        setPeerOnline(true);
      } else if (d.type === "user_offline" && d.userId === peerId) {
        setPeerOnline(false);
      }
    });
  }, [isOpen, myUserId, peerId, rideId]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!token || !text.trim()) return;
      setSending(true);
      try {
        const body: any = { message: text.trim() };
        if (rideId > 0) body.rideId = rideId;
        if (peerId) body.peerId = peerId;
        const res = await fetch(`${API_BASE_URL}/api/chat/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
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
    [token, peerId, rideId],
  );

  const sendTyping = useCallback(() => {
    const payload: any = { type: "typing" };
    if (rideId > 0) payload.rideId = rideId;
    if (peerId) payload.peerId = peerId;
    sendWsMessage(payload);
  }, [rideId, peerId]);

  const markRead = useCallback(
    (messageIds: number[]) => {
      if (!messageIds.length) return;
      sendWsMessage({ type: "message_read", rideId, messageIds });
    },
    [rideId],
  );

  return { messages, loading, sending, peerTyping, peerOnline, sendMessage, sendTyping, markRead, refresh: loadHistory };
}
