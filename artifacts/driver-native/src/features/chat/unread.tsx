import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react";

import { useAuth } from "@/hooks/use-auth";
import { wsEvents } from "@/lib/ws-events";

// Global unread-chat counter (web use-unread-chat equivalent): counts inbound
// DM + group messages from others, drives the Чат tab badge, resets when the
// chat screen is focused.
const UnreadContext = createContext<{ count: number; reset: () => void }>({ count: 0, reset: () => {} });

export const useUnread = () => useContext(UnreadContext);

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const [count, setCount] = useState(0);
  const seen = useRef(new Set<number>());

  useEffect(() => {
    if (!token || !user) return;
    return wsEvents.on((d: any) => {
      if ((d.type === "new_chat_message" || d.type === "new_group_chat_message") && d.message) {
        const id = d.message.id;
        if (d.message.senderId !== user.id && !seen.current.has(id)) {
          seen.current.add(id);
          if (seen.current.size > 500) {
            seen.current = new Set(Array.from(seen.current).slice(-250));
          }
          setCount((c) => c + 1);
        }
      }
    });
  }, [token, user]);

  const reset = useCallback(() => setCount(0), []);

  return <UnreadContext.Provider value={{ count, reset }}>{children}</UnreadContext.Provider>;
}
