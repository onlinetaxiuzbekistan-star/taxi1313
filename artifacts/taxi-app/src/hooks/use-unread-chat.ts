import { useState, useEffect, useRef, useCallback, createContext, useContext, MutableRefObject } from "react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface ChatPeer {
  id: number;
  name: string;
  role: string;
}

interface UnreadChatState {
  unreadCount: number;
  resetUnread: () => void;
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  openChatWithPeer: (peer: ChatPeer, rid?: number) => void;
  rideId: number;
  setRideId: (id: number) => void;
  dispatcherId: number;
  dispatcherName: string;
  dispatcherPhone: string;
  chatPeer: ChatPeer | null;
}

const UnreadChatContext = createContext<UnreadChatState>({
  unreadCount: 0,
  resetUnread: () => {},
  chatOpen: false,
  setChatOpen: () => {},
  openChatWithPeer: () => {},
  rideId: 0,
  setRideId: () => {},
  dispatcherId: 1,
  dispatcherName: "Диспетчер",
  dispatcherPhone: "",
  chatPeer: null,
});

export const useUnreadChat = () => useContext(UnreadChatContext);

export { UnreadChatContext };

export function useUnreadChatProvider(
  token: string | null,
  myUserId: number | undefined,
  sharedWsRef?: MutableRefObject<WebSocket | null>,
) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPeer, setChatPeer] = useState<ChatPeer | null>(null);
  const [rideId, setRideId] = useState(0);
  const [dispatcherId, setDispatcherId] = useState(1);
  const [dispatcherName, setDispatcherName] = useState("Диспетчер");
  const [dispatcherPhone, setDispatcherPhone] = useState("");
  const chatOpenRef = useRef(chatOpen);
  const seenMessageIds = useRef(new Set<number>());
  const myUserIdRef = useRef(myUserId);
  myUserIdRef.current = myUserId;

  chatOpenRef.current = chatOpen;

  useEffect(() => {
    if (!token) return;
    fetch(`${BASE_URL}/api/chat/dispatcher-info`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.id) {
          setDispatcherId(data.id);
          setDispatcherName(data.name || "Диспетчер");
          setDispatcherPhone(data.phone || "");
        }
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token || !myUserId) return;

    const handler = (e: Event) => {
      try {
        const data = (e as CustomEvent).detail;
        if (data.type === "new_chat_message" && data.message) {
          const msgId = data.message.id;
          const uid = myUserIdRef.current;
          if (
            data.message.senderId !== uid &&
            !seenMessageIds.current.has(msgId)
          ) {
            seenMessageIds.current.add(msgId);
            if (seenMessageIds.current.size > 500) {
              const arr = Array.from(seenMessageIds.current);
              seenMessageIds.current = new Set(arr.slice(-250));
            }
            if (!chatOpenRef.current) {
              setUnreadCount(prev => prev + 1);
            }
            try {
              const ws = sharedWsRef?.current;
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: "message_delivered",
                  messageIds: [msgId],
                  rideId: data.message.rideId || 0,
                }));
              }
            } catch {}
          }
        }
      } catch {}
    };

    window.addEventListener("buxtaxi:ws", handler);
    return () => {
      window.removeEventListener("buxtaxi:ws", handler);
    };
  }, [token, myUserId, sharedWsRef]);

  const resetUnread = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const handleSetChatOpen = useCallback((open: boolean) => {
    setChatOpen(open);
    if (open) setUnreadCount(0);
    if (!open) setChatPeer(null);
  }, []);

  const openChatWithPeer = useCallback((peer: ChatPeer, rid?: number) => {
    setChatPeer(peer);
    if (rid !== undefined) setRideId(rid);
    setChatOpen(true);
    setUnreadCount(0);
  }, []);

  return {
    unreadCount,
    resetUnread,
    chatOpen,
    setChatOpen: handleSetChatOpen,
    openChatWithPeer,
    rideId,
    setRideId,
    dispatcherId,
    dispatcherName,
    dispatcherPhone,
    chatPeer,
  };
}
